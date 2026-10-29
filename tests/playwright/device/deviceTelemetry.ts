import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PROJECT_LOADING_TEST_ID } from '../../../src/components/mobileSkin/runtime/phoneProjectLoadingTestIds'
import { sanitizeBootMarks, sanitizeLoadReports, sanitizeMediaImportReports, type ActionEvent, type BootMark, type LoadReport, type MediaImportReport } from './deviceParsing'

/**
 * Load-time evidence from the phone: the boot marks (window.__MS_PHONE_BOOT__), the sanitized
 * project-load reports (window.__MS_PROJECT_LOAD__) and what the progress UI showed when. Only
 * machine fields leave the page (phase names, steps, milliseconds): never a project name, path or
 * text the owner typed, because the same origin holds the owner's real projects.
 */

export async function readBootMarks(page: Page): Promise<BootMark[]> {
  return sanitizeBootMarks(await page.evaluate(() => (globalThis as { __MS_PHONE_BOOT__?: unknown }).__MS_PHONE_BOOT__ ?? null).catch(() => null))
}

export async function readLoadReports(page: Page): Promise<LoadReport[]> {
  return sanitizeLoadReports(await page.evaluate(() => (globalThis as { __MS_PROJECT_LOAD__?: unknown }).__MS_PROJECT_LOAD__ ?? []).catch(() => []))
}

type LoadWindow = typeof globalThis & { __MS_PROJECT_LOAD__?: Array<Record<string, unknown>> }

/**
 * Marks the reports the page holds now as seen (a property the sanitizer drops). The page keeps only
 * the last 12 reports, so counting them would stop working once the list is full; a mark does not.
 */
export async function markLoadReportsSeen(page: Page): Promise<void> {
  await page.evaluate(() => { for (const item of (globalThis as LoadWindow).__MS_PROJECT_LOAD__ ?? []) item.__msDeviceSeen = true }).catch(() => undefined)
}

/** Waits for the first unseen report of `kind` (see markLoadReportsSeen) and returns it, whatever its outcome. */
export async function waitForLoadReport(page: Page, kind: string, timeoutMs = 300_000): Promise<LoadReport> {
  const unseen = () => page.evaluate((kind) => ((globalThis as LoadWindow).__MS_PROJECT_LOAD__ ?? [])
    .filter(item => item.kind === kind && item.__msDeviceSeen !== true), kind)
  await page.waitForFunction((kind) => ((globalThis as LoadWindow).__MS_PROJECT_LOAD__ ?? [])
    .some(item => item.kind === kind && item.__msDeviceSeen !== true), kind, { timeout: timeoutMs, polling: 250 })
    .catch(() => { throw new Error(`No new ${kind} load report appeared within ${timeoutMs} ms (window.__MS_PROJECT_LOAD__)`) })
  const [report] = sanitizeLoadReports(await unseen())
  if (!report) throw new Error(`The ${kind} load report could not be read back sanitized`)
  return report
}

export interface ProgressSample { atMs: number; view: string; kind?: string; step?: string; percent?: number }

type ProgressWindow = Window & { __msDeviceProgress?: { samples: ProgressSample[]; last: string } }

/**
 * Records every change of the boot/loading view (data-state, data-kind, data-step, progress value)
 * with performance.now(), from the first script of the page on: installed for this tab only, also
 * across its reloads. Samples a few times per animation frame budget (50 ms timer), cheap enough.
 */
export async function installProgressRecorder(page: Page): Promise<void> {
  const recorder = ({ boot, loading }: { boot: string; loading: string }) => {
    const holder = window as ProgressWindow
    if (holder.__msDeviceProgress) return
    const record = { samples: [] as ProgressSample[], last: '' }
    holder.__msDeviceProgress = record
    const tick = () => {
      const view = document.querySelector<HTMLElement>(`[data-testid="${loading}"], [data-testid="${boot}"]`)
      const bar = view?.querySelector<HTMLElement>('[role="progressbar"]')
      const value = bar?.getAttribute('aria-valuenow')
      const sample: ProgressSample = view
        ? { atMs: Math.round(performance.now()), view: view.dataset.state ?? view.dataset.testid ?? 'view', kind: view.dataset.kind, step: view.dataset.step,
            percent: value === null || value === undefined ? undefined : Number(value) }
        : { atMs: Math.round(performance.now()), view: 'none' }
      const key = `${sample.view}|${sample.kind}|${sample.step}|${sample.percent}`
      if (key !== record.last) { record.last = key; record.samples.push(sample) }
      setTimeout(tick, 50)
    }
    tick()
  }
  const args = { boot: PHONE_TEST_IDS.bootStatus, loading: PHONE_PROJECT_LOADING_TEST_ID }
  await page.addInitScript(recorder, args)
  await page.evaluate(recorder, args).catch(() => undefined)
}

/** Takes the recorded samples (and starts a new list). */
export async function takeProgress(page: Page): Promise<ProgressSample[]> {
  return page.evaluate(() => {
    const record = (window as ProgressWindow).__msDeviceProgress
    if (!record) return []
    const samples = record.samples
    record.samples = []
    record.last = ''
    return samples
  }).catch(() => [])
}

/** "0-412 ms none · 412-3100 ms loading open/session_read 40 % · …" */
export function describeProgress(samples: ProgressSample[]): string {
  return samples.map((sample, index) => {
    const end = samples[index + 1]?.atMs
    const what = sample.view === 'none' ? 'nothing' : `${sample.view}${sample.kind ? ` ${sample.kind}` : ''}${sample.step ? `/${sample.step}` : ''}${sample.percent !== undefined ? ` ${sample.percent} %` : ''}`
    return `${sample.atMs}${end !== undefined ? `-${end}` : '+'} ms ${what}`
  }).join(' · ')
}

// ---------------------------------------------------------------------------
// Page-side action timeline
// ---------------------------------------------------------------------------

type ActionWindow = Window & { __msDeviceActions?: ActionEvent[] }

/**
 * Records, with the page's own clock, every touch down and click on an element with a data-testid
 * and every appearance/disappearance of the watched test ids. The PC's wall clock includes the
 * DevTools transport over wireless adb, which stalled for 12-15 s in Pixel runs (2026-10-28) while
 * the page was idle; only page times tell the product's share. Test ids only, never texts.
 */
export async function installActionTimeline(page: Page, watched: readonly string[]): Promise<void> {
  const recorder = (ids: readonly string[]) => {
    const holder = window as ActionWindow
    if (holder.__msDeviceActions) return
    const events: ActionEvent[] = []
    holder.__msDeviceActions = events
    const push = (kind: ActionEvent['kind'], id: string) => {
      events.push({ atMs: Math.round(performance.now()), kind, id })
      if (events.length > 2000) events.splice(0, events.length - 2000)
    }
    const testIdOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-testid]')?.dataset.testid : undefined)
    window.addEventListener('pointerdown', (event) => { const id = testIdOf(event.target); if (id) push('down', id) }, true)
    window.addEventListener('click', (event) => { const id = testIdOf(event.target); if (id) push('click', id) }, true)
    const shown = new Set<string>()
    const scan = () => {
      for (const id of ids) {
        const present = document.querySelector(`[data-testid="${id}"]`) !== null
        if (present && !shown.has(id)) { shown.add(id); push('show', id) } else if (!present && shown.has(id)) { shown.delete(id); push('hide', id) }
      }
    }
    const start = () => { scan(); new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true }) }
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true })
  }
  await page.addInitScript(recorder, watched)
  await page.evaluate(recorder, watched).catch(() => undefined)
}

/** The page-side events recorded since `sinceMs` (page clock). */
export async function readActions(page: Page, sinceMs = 0): Promise<ActionEvent[]> {
  return page.evaluate((since) => ((window as ActionWindow).__msDeviceActions ?? []).filter(event => event.atMs >= since), sinceMs).catch(() => [])
}

/** The page clock now (performance.now()), to mark where an action starts. */
export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(performance.now()))
}

/**
 * Waits until every background copy into the project that started at or after `sinceMs` settled (its
 * 'background-copy' report is no longer 'running'); returns false when one was still running at the timeout.
 * Builds without background copies have no such report and return at once.
 */
export async function waitForBackgroundCopies(page: Page, sinceMs: number, timeoutMs: number): Promise<boolean> {
  return page.waitForFunction((since) => !((globalThis as { __MS_MEDIA_IMPORT__?: Array<{ kind?: string; startedAt?: number; outcome?: string }> }).__MS_MEDIA_IMPORT__ ?? [])
    .some(item => item.kind === 'background-copy' && (item.startedAt ?? 0) >= since && item.outcome === 'running'), sinceMs, { timeout: timeoutMs, polling: 250 })
    .then(() => true, () => false)
}

/** Media import reports (window.__MS_MEDIA_IMPORT__) that started at or after `sinceMs` (page clock). Empty on builds without them. */
export async function readMediaImports(page: Page, sinceMs = 0): Promise<MediaImportReport[]> {
  const raw = await page.evaluate((since) => ((globalThis as { __MS_MEDIA_IMPORT__?: Array<{ startedAt?: number }> }).__MS_MEDIA_IMPORT__ ?? [])
    .filter(item => (item.startedAt ?? 0) >= since), sinceMs).catch(() => [])
  return sanitizeMediaImportReports(raw)
}
