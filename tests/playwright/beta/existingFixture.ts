import { chromium, test as base, expect, type Page } from '@playwright/test'
import { open, mkdir, readFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { BridgeClient, type BridgeToolResult } from '../fixtures/bridgeClient'
import { EditorPage } from '../fixtures/editorPage'
import { FailureEvidenceCollector } from '../fixtures/failureEvidence'
import { origin, endpoint, modulePath, moduleSha256, assertTarget, assertTool } from './existingGuards.mjs'
import { markExistingPage, beginExistingResources, bindExistingResourceAlias, cleanupExistingResources, forgetExistingResources } from './existingPlayer'
import { finishExistingCase, registerGeneratedMedia, cleanupGeneratedMedia } from './existingResourceCleanup.mjs'
import { prepareExistingProject } from './existingPreparation'
import { protectExistingPage, actionGateFor, unguardedPage, withinDeadline } from './existingActionBoundary'
import { observeServing } from './existingServingEvidence.mjs'
import { bindExistingConsoleOrigin } from './existingConsoleOrigin'

type Fixtures = { bridge: BridgeClient; editorPage: EditorPage; failureEvidence: FailureEvidenceCollector }
const collectors = new WeakMap<Page, FailureEvidenceCollector>()
export const existingTest = base.extend<Fixtures>({
  // This override does not request any Playwright-owned browser/context/page.
  page: [async ({}, provide, testInfo) => {
    if (process.env.MS_BETA_EXISTING !== '1') throw new Error('Explicit existing mode required')
    const manifest = process.env.MS_BETA_PACKAGE_MANIFEST!, pin = process.env.MS_BETA_PACKAGE_SHA256!
    const localRoot = process.env.MS_BETA_LOCAL_ARTIFACTS
    if (!localRoot || !path.isAbsolute(localRoot) || !/^[a-f0-9-]+$/.test(testInfo.testId)) throw Error('Reserved local artifact root required')
    const localArtifacts = path.join(localRoot, testInfo.testId)
    await mkdir(localArtifacts)
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 5_000, artifactsDir: localArtifacts })
    const pages = browser.contexts().flatMap(context => context.pages())
    const targets = await Promise.all(pages.map(async page => {
      const cdp = await page.context().newCDPSession(page)
      try { return (await cdp.send('Target.getTargetInfo')).targetInfo }
      finally { await cdp.detach() }
    }))
    assertTarget(targets, process.env.MS_BETA_TARGET_ID)
    const raw = pages[0]
    const collector = new FailureEvidenceCollector(raw, testInfo)
    await mkdir(testInfo.outputDir, { recursive: true })
    let journalIndex = 0
    const publishOwners = async (record: unknown) => {
      const file = testInfo.outputPath(`owned-resource-registry-${String(journalIndex++).padStart(3, '0')}.json`)
      const handle = await open(file, 'wx')
      try {
        await handle.writeFile(JSON.stringify({ targetId: process.env.MS_BETA_TARGET_ID,
          reservationSha256: process.env.MS_BETA_RESERVATION_SHA256, loaderId: protectedPage?.loaderId,
          at: new Date().toISOString(), record }))
        await handle.sync()
      } finally { await handle.close() }
    }
    beginExistingResources(raw, testInfo.testId, publishOwners)
    let protectedPage: Awaited<ReturnType<typeof protectExistingPage>> | undefined
    let serving: Awaited<ReturnType<typeof observeServing>> | undefined
    let sourceError: string | undefined, primary: unknown, traced = false
    const cleanupErrors: string[] = []
    const cleanup = async (label: string, action: () => Promise<unknown>) => {
      try { await withinDeadline(label, action, 10_000) } catch (error) { cleanupErrors.push(`${label}: ${error}`) }
    }
    try {
      await publishOwners({ caseId: testInfo.testId, owners: [], reports: [] })
      protectedPage = await withinDeadline('Adopt preparation target',
        () => protectExistingPage(raw, process.env.MS_BETA_TARGET_ID!, true), 10_000)
      const page = protectedPage.page
      bindExistingResourceAlias(page, raw)
      serving = await withinDeadline('Observe serving artifact', () => observeServing(raw, manifest, pin,
        reason => { sourceError = reason; protectedPage?.gate.stop(reason) }), 20_000)
      await withinDeadline('Start action trace', () => raw.context().tracing.start({ screenshots: true, snapshots: true, sources: true }), 5000); traced = true
      await prepareExistingProject(page, testInfo)
      await withinDeadline('Complete declared preparation', () => protectedPage!.finishPreparation(), 5_000)
      const loadedResources = await withinDeadline('Loaded artifact evidence', () => serving!.checkLoaded(), 10_000)
      bindExistingConsoleOrigin(page, loadedResources)
      if (sourceError) throw Error(sourceError)
      markExistingPage(page); collectors.set(page, collector)
      await testInfo.attach('existing-admission', { body: JSON.stringify({ target: targets[0], loaderId: protectedPage.loaderId,
        manifestSha256: pin, projectSetup: 'Pinned project restore in same target before each case',
        diagnostics: 'Pre-navigation URL/GPU audit, full action trace and startup console collection' }), contentType: 'application/json' })
      await provide(page)
    } catch (error) { primary = error }
    finally {
      // Attempt all evidence/cleanup even if another operation fails; preserve the primary failure.
      await cleanup('failure evidence', () => collector.finish(Boolean(primary || sourceError || protectedPage?.gate.reason)))
      await cleanup('owned resources', async () => {
        const result = await finishExistingCase({ original: primary ?? testInfo.errors[0], failed: Boolean(primary) || testInfo.status !== testInfo.expectedStatus,
          cleanup: () => cleanupExistingResources(protectedPage?.page ?? raw),
          persist: async (report: unknown) => {
            const body = JSON.stringify(report)
            const file = testInfo.outputPath('owned-resource-cleanup.json'), handle = await open(file, 'wx')
            try { await handle.writeFile(body); await handle.sync() } finally { await handle.close() }
            await testInfo.attach('owned-resource-cleanup', { path: file, contentType: 'application/json' })
          } })
        cleanupErrors.push(...(result.report.errors ?? []).map((error: string) => `owned resources: ${error}`))
        if (protectedPage) forgetExistingResources(protectedPage.page)
        forgetExistingResources(raw)
      })
      await cleanup('generated media', async () => {
        let intent
        try { intent = JSON.parse(await readFile(testInfo.outputPath('generated-media-intent.json'), 'utf8')) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
        const mediaRoot = path.resolve(testInfo.outputPath('media'))
        if (intent.owner !== testInfo.testId || path.resolve(intent.root) !== mediaRoot || !Array.isArray(intent.files)) throw Error('Generated media ownership mismatch')
        const reports = [], errors = []
        for (const file of intent.files) {
          try {
            const record = await registerGeneratedMedia(mediaRoot, testInfo.testId, file)
            reports.push(await cleanupGeneratedMedia(record, testInfo.testId))
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') reports.push({ file, allocated: false })
            else errors.push(String(error))
          }
        }
        await testInfo.attach('generated-media-cleanup', { body: JSON.stringify({ reports, errors }), contentType: 'application/json' })
        if (errors.length) throw Error(errors.join('; '))
      })
      await cleanup('resource evidence', async () => {
        await testInfo.attach('resource-lifetimes', { body: JSON.stringify(await raw.evaluate(() => {
          const state = window as unknown as { __betaObjectUrlAudit: unknown; __betaGpuImportFailures: unknown }
          if (!Array.isArray(state.__betaObjectUrlAudit) || !Array.isArray(state.__betaGpuImportFailures)) throw Error('Resource audit missing')
          return { urls: state.__betaObjectUrlAudit, gpuImportFailures: state.__betaGpuImportFailures }
        })), contentType: 'application/json' })
      })
      if (protectedPage) await cleanup('action boundary', async () => {
        const boundary = await protectedPage!.dispose()
        await testInfo.attach('existing-action-boundary', { body: JSON.stringify(boundary), contentType: 'application/json' })
        if (boundary.outstanding || boundary.finalTargetError || boundary.stopped) throw Error(JSON.stringify(boundary))
      })
      if (serving) await cleanup('serving evidence', async () => {
        const report = await serving!.finish(protectedPage?.loaderId)
        await testInfo.attach('existing-serving-interval', { body: JSON.stringify(report), contentType: 'application/json' })
        if (!report.passed) throw Error(report.errors.join('; '))
      })
      if (traced) await cleanup('trace', async () => {
        const trace = testInfo.outputPath('trace.zip')
        const localTrace = path.join(localArtifacts, 'completed-trace.zip')
        const startedAt = Date.now()
        await raw.context().tracing.stop({ path: localTrace })
        const packedAt = Date.now()
        await copyFile(localTrace, trace)
        const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
        const localBytes = await readFile(localTrace), copiedBytes = await readFile(trace)
        if (digest(localBytes) !== digest(copiedBytes)) throw Error('Final trace copy differs')
        await testInfo.attach('trace-finalization', { body: JSON.stringify({ localArtifacts, localTrace, trace,
          bytes: copiedBytes.length, sha256: digest(copiedBytes), packMs: packedAt - startedAt,
          copyAndVerifyMs: Date.now() - packedAt }), contentType: 'application/json' })
        await testInfo.attach('trace', { path: trace, contentType: 'application/zip' })
      })
      await cleanup('teardown evidence', () => testInfo.attach('existing-teardown', { body: JSON.stringify({ primary: primary ? String(primary) : null,
        testStatus: testInfo.status, cleanupErrors, targetOpen: !raw.isClosed() }), contentType: 'application/json' }))
    }
    if (primary) throw primary
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Existing-target cleanup/evidence incomplete')
    // No browser/context/page close. The runner releases its CDP transport at exit.
  }, { scope: 'test', timeout: 90_000 }],
  failureEvidence: async ({ page }, provide) => {
    const collector = collectors.get(page)
    if (!collector) throw Error('Startup evidence collector missing')
    await provide(collector)
  },
  editorPage: [async ({ page, failureEvidence }, provide, testInfo) => {
    const gate = actionGateFor(page), raw = unguardedPage(page)
    const bridge = new BridgeClient({ baseURL: origin, targetTabId: process.env.MS_BETA_TARGET_ID!, transport: {
      async tool(name, args, timeoutMs, fetchTimeoutMs) {
        assertTool(name)
        return gate.run(`tool ${name}`, () => raw.evaluate(async ({ name, args, modulePath, moduleSha256 }) => {
          const bytes = await fetch(modulePath, { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(r => {
            if (!r.ok || r.redirected) throw Error('Tool module fetch failed')
            return r.arrayBuffer()
          })
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
          if (digest !== moduleSha256) throw Error('Tool module hash changed')
          const api = await import(/* @vite-ignore */ modulePath)
          return api.e(name, args, 'console')
        }, { name, args, modulePath, moduleSha256 }) as Promise<BridgeToolResult>, Math.min(timeoutMs, fetchTimeoutMs))
      },
    } })
    failureEvidence.setBridge(bridge)
    const editor = await EditorPage.adoptExistingReady(page, bridge)
    const inventory = await bridge.toolData<{ files: Array<{ id: string; name: string; fileSize: number | null }> }>('getMediaItems')
    await testInfo.attach('existing-before-case-media', { body: JSON.stringify(inventory), contentType: 'application/json' })
    expect(inventory.files.filter(file => ['beta-background.mp4', 'beta-foreground.mp4'].includes(file.name))).toEqual([])
    await provide(editor)
  }, { auto: true }],
  bridge: async ({ editorPage }, provide) => { await provide(editorPage.bridge) },
})
export { expect }
