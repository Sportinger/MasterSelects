import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PROJECT_LOADING_TEST_ID } from '../../../src/components/mobileSkin/runtime/phoneProjectLoadingTestIds'
import { sanitizeBootMarks, sanitizeLoadReports, type BootMark, type LoadReport } from './deviceParsing'

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
