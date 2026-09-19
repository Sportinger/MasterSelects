import { randomUUID } from 'node:crypto'
import type { Page, JSHandle } from '@playwright/test'
import { assertOwner } from './existingGuards.mjs'
import { cleanupOnExistingPage, originalObject } from './existingActionBoundary.ts'
const existingPages = new WeakSet<Page>()
export const markExistingPage = (page: Page) => { existingPages.add(page) }
export const isExistingPage = (page: Page) => existingPages.has(page)

type Entry = { owner: string; handle?: JSHandle<HTMLDivElement>; disposed: boolean; browserCleaned?: boolean }
type CaseResources = { caseId: string; entries: Entry[]; reports: unknown[]; publish?: (value: unknown) => Promise<void> }
const cases = new WeakMap<Page, CaseResources>()
// Call before preparation/use; retain reports until the fixture has written them.
export function beginExistingResources(page: Page, caseId: string, publish?: (value: unknown) => Promise<void>) {
  if (cases.has(page)) throw Error('Previous existing resource case not finalized')
  cases.set(page, { caseId, entries: [], reports: [], publish })
}
export function bindExistingResourceAlias(alias: Page, source: Page) {
  const scope = cases.get(source)
  if (!scope || cases.has(alias)) throw Error('Invalid resource alias binding')
  cases.set(alias, scope)
}

// DOM state, including disconnected roots, remains reachable until cleanup completes.
// This function is serialized by Playwright; do not reference module-level values.
async function releaseInPage({ owner, verifyUrls = true }: { owner: string; verifyUrls?: boolean }) {
  const state = window as unknown as { __betaOwnedPlayers?: Map<string, HTMLDivElement> }
  const root = state.__betaOwnedPlayers?.get(owner) as (HTMLDivElement & {
    __ownedUrls: string[]; __frameCallback: number
  }) | undefined
  if (!root) return { owner, missing: true, errors: ['Owned browser registry missing; release unproven'] }
  const video = root.querySelector('video')!
  const inventory = () => ({ connected: root.isConnected, urls: [...root.__ownedUrls],
    callback: root.__frameCallback, src: video?.getAttribute('src'), paused: video?.paused,
    inputs: root.querySelectorAll('input').length })
  const before = inventory(), errors: string[] = [], revoked: string[] = []
  const attempt = (operation: string, action: () => void) => {
    try { action() } catch (error) { errors.push(operation + ': ' + String(error)) }
  }
  attempt('pause', () => video.pause())
  attempt('cancelVideoFrameCallback', () => {
    if (root.__frameCallback) video.cancelVideoFrameCallback(root.__frameCallback)
    root.__frameCallback = 0
  })
  attempt('detach source', () => { video.removeAttribute('src'); video.load() })
  for (const url of [...root.__ownedUrls]) attempt('revoke URL', () => {
    URL.revokeObjectURL(url); revoked.push(url)
    root.__ownedUrls.splice(root.__ownedUrls.indexOf(url), 1)
  })
  attempt('clear input', () => { const input = root.querySelector('input')!; input.onchange = null; input.value = '' })
  attempt('clear button', () => { root.querySelector('button')!.onclick = null })
  attempt('remove DOM', () => root.remove())
  const after = inventory()
  const urlChecks = verifyUrls ? await Promise.all(revoked.map(async url => ({ url, inaccessible: await fetch(url).then(() => false, () => true) }))) : []
  if (urlChecks.some(check => !check.inaccessible)) errors.push('Revoked URL remains accessible')
  if (!errors.length) { root.replaceChildren(); state.__betaOwnedPlayers!.delete(owner) }
  return { owner, before, after, connected: after.connected, remainingUrls: after.urls.length, revoked, urlChecks,
    verificationDeferred: !verifyUrls && revoked.length > 0, canceledCallback: before.callback, errors }
}

async function release(page: Page, entry: Entry, verifyUrls = true) {
  const scope = cases.get(page)!
  const errors: string[] = []
  let browser: Awaited<ReturnType<typeof releaseInPage>> | undefined
  // Disposed handles do not prevent retrying DOM cleanup through the owner registry.
  try {
    if (!entry.browserCleaned) {
      browser = await cleanupOnExistingPage(page, raw => raw.evaluate(releaseInPage, { owner: entry.owner, verifyUrls }))
      entry.browserCleaned = browser.errors.length === 0
    }
  }
  catch (error) { errors.push('browser cleanup: ' + String(error)) }
  if (entry.handle && !entry.disposed) {
    try { await cleanupOnExistingPage(page, async () => originalObject(entry.handle!).dispose()); entry.disposed = true }
    catch (error) { errors.push('handle dispose: ' + String(error)) }
  }
  errors.push(...(browser?.errors ?? []))
  const report = { ...browser, owner: entry.owner, handleDisposed: entry.disposed,
    pageClosed: page.isClosed(), errors }
  scope.reports.push(report)
  if (!errors.length) scope.entries.splice(scope.entries.indexOf(entry), 1)
  try { await scope.publish?.({ caseId: scope.caseId, owners: scope.entries.map(item => item.owner), reports: scope.reports }) }
  catch (error) { errors.push('resource journal: ' + String(error)) }
  return report
}

export async function cleanupExistingResources(page: Page) {
  const scope = cases.get(page)
  if (!scope) return { caseId: '', reports: [], remainingOwners: [], errors: [] }
  for (const entry of [...scope.entries].reverse()) await release(page, entry)
  // Playback verifies product console first. Probe its already-revoked URLs here,
  // after collection ends; intentional failed fetches must not masquerade as app errors.
  for (const report of scope.reports as Array<{ verificationDeferred?: boolean; revoked?: string[]; urlChecks?: unknown[]; errors: string[] }>) {
    if (!report.verificationDeferred) continue
    try {
      const checks = await cleanupOnExistingPage(page, raw => raw.evaluate(async urls =>
        Promise.all(urls.map(async url => ({ url, inaccessible: await fetch(url).then(() => false, () => true) }))), report.revoked ?? []))
      report.urlChecks = checks
      if (checks.some(check => !check.inaccessible)) report.errors.push('Revoked URL remains accessible')
      report.verificationDeferred = false
    } catch (error) { report.errors.push('Deferred URL proof: ' + String(error)) }
  }
  return { caseId: scope.caseId, reports: [...scope.reports],
    remainingOwners: scope.entries.map(entry => entry.owner),
    errors: scope.reports.flatMap(report => (report as { errors: string[] }).errors) }
}
export function forgetExistingResources(page: Page) {
  if (cases.get(page)?.entries.length) throw Error('Unreleased existing resources')
  cases.delete(page)
}

export async function createOwnedPlayer(page: Page, options: { testOnlyFailAfterAllocation?: boolean } = {}) {
  if (!cases.has(page)) beginExistingResources(page, 'unbound-requires-fixture-integration')
  const owner = randomUUID()
  const entry: Entry = { owner, disposed: false }
  cases.get(page)!.entries.push(entry) // Before the first browser allocation/await.
  try {
    const scope = cases.get(page)!
    await scope.publish?.({ caseId: scope.caseId, owners: scope.entries.map(item => item.owner), reports: scope.reports })
    entry.handle = await page.evaluateHandle(owner => {
      const state = window as unknown as { __betaOwnedPlayers?: Map<string, HTMLDivElement> }
      state.__betaOwnedPlayers ??= new Map()
      const root = document.createElement('div')
      Object.assign(root, { __ownedUrls: [] as string[], __frameCallback: 0 })
      state.__betaOwnedPlayers.set(owner, root) // Before append or handle publication.
      root.id = 'beta-owned-' + owner
      root.style.cssText = 'position:fixed;inset:20px;z-index:2147483647;background:#111;color:white;padding:20px'
      root.innerHTML = '<input type="file" aria-label="Exported video"><video width="640" height="360" preload="auto"></video><button>Play exported video</button>'
      document.body.append(root)
      return root
    }, owner)
    if (options.testOnlyFailAfterAllocation) throw Error('AQ104 partial allocation failure')
  } catch (original) {
    await release(page, entry) // Reports cleanup errors; never replaces allocation exception.
    throw original
  }
  let cleaned = false
  return {
    owner, handle: entry.handle!, locator: page.locator('[id="beta-owned-' + owner + '"]'),
    async cleanup(requestedOwner: string, options: { deferUrlProof?: boolean } = {}) {
      assertOwner(requestedOwner, owner)
      if (cleaned) return { alreadyCleaned: true }
      const report = await release(page, entry, !options.deferUrlProof)
      cleaned = report.errors.length === 0
      // Nonthrowing so legacy finally blocks cannot replace the original assertion.
      // Fixture must fail a successful case if report.errors/remainingOwners is nonempty.
      return report
    },
  }
}

// Controller recovery after worker death: only pass owners from the durable case
// journal and a freshly validated, pinned retained target. JSHandles belonged to
// the dead worker; this only proves browser resource release, not handle disposal.
export async function cleanupRetainedOwners(page: Page, owners: string[]) {
  const reports = []
  for (const owner of owners) {
    if (!/^[0-9a-f-]{36}$/.test(owner)) throw Error('Invalid recorded resource owner')
    reports.push(await page.evaluate(releaseInPage, { owner }))
  }
  return reports
}
