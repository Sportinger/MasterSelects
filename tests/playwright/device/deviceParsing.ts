/**
 * Pure helpers of the real-device harness: parsers for adb output and for what the phone UI shows,
 * the sanitizing of the load telemetry the page keeps, and the frame expectations of the journeys.
 * No Playwright, adb or file access here, so `deviceParsing.test.ts` covers it with vitest.
 */

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------

export interface AdbDevice { serial: string; state: string; model?: string }

/** `adb devices -l` lines after the header: "<serial>\t<state> [key:value ...]". */
export function parseAdbDevices(output: string): AdbDevice[] {
  return output.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).flatMap(line => {
    const [serial, state, ...rest] = line.split(/\s+/)
    if (!serial || !state || serial.startsWith('*')) return []
    const model = rest.find(part => part.startsWith('model:'))?.slice('model:'.length)
    return [{ serial, state, ...(model ? { model } : {}) }]
  })
}

/**
 * Whether the lock screen shows, from `dumpsys window` (Android 10-16 print `isKeyguardShowing=`,
 * older builds `mKeyguardShowing=` or `mShowingLockscreen=`). Null when no line says it.
 */
export function parseKeyguardShowing(dumpsysWindow: string): boolean | null {
  const match = /\b(?:isKeyguardShowing|mKeyguardShowing|mShowingLockscreen)=(true|false)\b/.exec(dumpsysWindow)
  return match ? match[1] === 'true' : null
}

/** `dumpsys power`: mWakefulness=Awake|Asleep|Dozing|Dreaming. Null when absent. */
export function parseWakefulness(dumpsysPower: string): string | null {
  return /\bmWakefulness=(\w+)/.exec(dumpsysPower)?.[1] ?? null
}

/** `adb forward --list` / `adb reverse --list` lines: "<serial> <local> <remote>" (reverse omits the serial on some builds). */
export function parsePortMappings(output: string): Array<{ serial?: string; local: string; remote: string }> {
  return output.split(/\r?\n/).map(line => line.trim().split(/\s+/)).flatMap(parts => {
    if (parts.length === 3) return [{ serial: parts[0], local: parts[1], remote: parts[2] }]
    if (parts.length === 2 && parts[0].includes(':')) return [{ local: parts[0], remote: parts[1] }]
    return []
  })
}

/**
 * Paths of the tabs (by URL) that already show the editor's origin: the owner's MasterSelects tabs.
 * Only the pathname is returned, never a query or fragment.
 */
export function editorTabPaths(urls: readonly string[], baseURL: string): string[] {
  const origin = new URL(baseURL).origin
  return urls.flatMap(url => {
    try {
      const parsed = new URL(url)
      return parsed.origin === origin ? [parsed.pathname] : []
    } catch { return [] }
  })
}

/**
 * The harness marks the one tab it works in and reuses that tab on the next run instead of opening
 * another. The marker is the URL fragment (`/m#masterselects-device-test`, `about:blank#…` for a
 * parked tab): Android Chrome discards background tabs and reloads them later, which kept the URL
 * but dropped window.name and sessionStorage on the Pixel (2026-10-28), and the fragment can be read
 * from the tab list without running script in a frozen tab. The editor never reads or rewrites the
 * fragment. window.name is set as well, as a second marker.
 */
export const DEVICE_TAB_MARKER = 'masterselects-device-test'

/** Whether a tab URL carries the harness marker fragment. */
export function hasDeviceTabMarker(url: string): boolean {
  try { return new URL(url).hash === `#${DEVICE_TAB_MARKER}` } catch { return false }
}

/** The URL the test tab boots: `${baseURL}/m#masterselects-device-test`. */
export function deviceTabURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/m#${DEVICE_TAB_MARKER}`
}

/** Where a further harness tab is parked: blank, but still recognisable as the harness's. */
export const PARKED_DEVICE_TAB_URL = `about:blank#${DEVICE_TAB_MARKER}`

export interface DeviceTabInfo {
  url: string
  /** The tab carries DEVICE_TAB_MARKER: the harness opened it in an earlier run. */
  marked: boolean
}

export interface DeviceTabPlan {
  /** Index of the marked tab the run works in; null: open one new tab. */
  reuse: number | null
  /**
   * Further marked tabs on the editor origin (two marked tabs exist only after a manual mix-up). They
   * are parked on PARKED_DEVICE_TAB_URL, never closed, so no second harness tab holds the project storage.
   */
  park: number[]
  /** Paths of unmarked tabs on the editor origin: the owner's MasterSelects tabs (the run refuses to start). */
  ownerEditorPaths: string[]
}

/** Which tab the run uses: its own marked tab if there is one; owner tabs are only counted, never touched. */
export function planDeviceTabs(tabs: readonly DeviceTabInfo[], baseURL: string): DeviceTabPlan {
  const marked = tabs.flatMap((tab, index) => tab.marked ? [index] : [])
  // Prefer a marked tab that already shows the editor's origin (the live test tab) over a parked one.
  const onEditor = marked.filter(index => editorTabPaths([tabs[index].url], baseURL).length > 0)
  const reuse = onEditor[0] ?? marked[0] ?? null
  return {
    reuse,
    park: marked.filter(index => index !== reuse && editorTabPaths([tabs[index].url], baseURL).length > 0),
    ownerEditorPaths: editorTabPaths(tabs.filter(tab => !tab.marked).map(tab => tab.url), baseURL),
  }
}

// ---------------------------------------------------------------------------
// Phone UI
// ---------------------------------------------------------------------------

/**
 * The transport time "mm:ss.ff" (PhoneTransport.formatPhoneTime: frames, not hundredths) as a frame
 * number at `fps`. Null when the text is not such a time.
 */
export function parsePhoneTimeFrames(text: string, fps: number): number | null {
  const match = /(\d+):(\d{2})\.(\d{2,3})/.exec(text)
  if (!match) return null
  const [, minutes, seconds, frames] = match
  return (Number(minutes) * 60 + Number(seconds)) * Math.round(fps) + Number(frames)
}

export interface ClipLabel { name: string; start: number; duration: number }

/** Seconds of phoneTimelineGeometry.formatSpokenSeconds: "1.50 s" or "1 min 2.00 s". */
function spokenSeconds(text: string): number | null {
  const match = /^(?:(\d+) min )?(\d+(?:\.\d+)?) s$/.exec(text.trim())
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : null
}

/** The clip tile's accessible name: "<name>, starts at <spoken>, <spoken> long" (phoneClipAccessibleName). */
export function parseClipLabel(label: string): ClipLabel | null {
  const match = /^(.*), starts at (.+?), (.+?) long$/.exec(label.trim())
  if (!match) return null
  const start = spokenSeconds(match[2]), duration = spokenSeconds(match[3])
  return start === null || duration === null ? null : { name: match[1], start, duration }
}

/** "1080 × 1920 · …" in the export summary: the output size, or null. */
export function parseExportSize(summary: string): { width: number; height: number } | null {
  const match = /(\d{2,5})\s*[×x]\s*(\d{2,5})/.exec(summary)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

// ---------------------------------------------------------------------------
// Telemetry the page keeps (window.__MS_PHONE_BOOT__, window.__MS_PROJECT_LOAD__)
// ---------------------------------------------------------------------------

export interface BootMark { phase: string; atMs: number; detail?: string }

export interface LoadReport {
  kind: string
  outcome: string
  storage: string
  totalMs: number
  phases: Record<string, number>
  firstFrameMs?: number
  /** Part of storage_open until the storage worker answered: fetching its script, which on the device comes over the adb link. */
  workerStartMs?: number
  mainThread?: { longTaskMs?: number; longTaskMaxMs?: number; longTaskCount?: number; frameGapMaxMs?: number; pageHidden?: boolean }
}

const SAFE_DETAIL = /^[a-z0-9 _-]{0,40}$/i
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The boot marks, reduced to phase, time and a short machine detail ("not-restored"). A detail that
 * is not such a token (it might carry a project name) is dropped, so attachments never name the
 * owner's projects.
 */
export function sanitizeBootMarks(raw: unknown): BootMark[] {
  const marks = (raw as { marks?: unknown } | null)?.marks
  if (!Array.isArray(marks)) return []
  return marks.flatMap((mark: unknown) => {
    const item = mark as { phase?: unknown; at?: unknown; detail?: unknown }
    const at = finite(item.at)
    if (typeof item.phase !== 'string' || at === null) return []
    const detail = typeof item.detail === 'string' && SAFE_DETAIL.test(item.detail) ? item.detail : undefined
    return [{ phase: item.phase, atMs: Math.round(at), ...(detail ? { detail } : {}) }]
  })
}

/** The load reports, reduced to the documented sanitized fields (projectLoadTelemetry.ts); anything else is dropped. */
export function sanitizeLoadReports(raw: unknown): LoadReport[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry: unknown) => {
    const item = entry as Record<string, unknown>
    const totalMs = finite(item.totalMs)
    if (typeof item.kind !== 'string' || typeof item.outcome !== 'string' || totalMs === null) return []
    const phases: Record<string, number> = {}
    for (const [phase, ms] of Object.entries((item.phases ?? {}) as Record<string, unknown>)) {
      const value = finite(ms)
      if (value !== null && /^[a-z_]{1,40}$/.test(phase)) phases[phase] = Math.round(value)
    }
    const report: LoadReport = { kind: item.kind, outcome: item.outcome, storage: typeof item.storage === 'string' ? item.storage : 'unknown', totalMs: Math.round(totalMs), phases }
    const firstFrame = finite(item.firstFrameMs)
    if (firstFrame !== null) report.firstFrameMs = Math.round(firstFrame)
    const workerStart = finite(item.workerStartMs)
    if (workerStart !== null) report.workerStartMs = Math.round(workerStart)
    const main = item.mainThread as Record<string, unknown> | undefined
    if (main && typeof main === 'object') {
      report.mainThread = {
        longTaskMs: finite(main.longTaskMs) ?? undefined, longTaskMaxMs: finite(main.longTaskMaxMs) ?? undefined,
        longTaskCount: finite(main.longTaskCount) ?? undefined, frameGapMaxMs: finite(main.frameGapMaxMs) ?? undefined,
        pageHidden: typeof main.pageHidden === 'boolean' ? main.pageHidden : undefined,
      }
    }
    return [report]
  })
}

/** One line: "open ready (opfs): total 820 ms · storage_open 120 · session_read 400 · first frame 90". */
export function describeLoadReport(report: LoadReport): string {
  const phases = Object.entries(report.phases).map(([phase, ms]) => `${phase} ${ms}`).join(' · ')
  const worker = report.workerStartMs === undefined ? '' : ` · storage worker start ${report.workerStartMs}`
  const first = report.firstFrameMs === undefined ? '' : ` · first frame ${report.firstFrameMs}`
  const thread = report.mainThread?.longTaskMs === undefined ? '' : ` · long tasks ${Math.round(report.mainThread.longTaskMs)}`
  return `${report.kind} ${report.outcome} (${report.storage}): total ${report.totalMs} ms${phases ? ` · ${phases}` : ''}${worker}${first}${thread}`
}

/**
 * Time of the load that went to fetching the storage worker's script. On the device that fetch crosses
 * the wireless adb link (adb reverse to the PC's preview server, which asks for revalidation on every
 * request), whose stalls of about 14 s once landed whole in storage_open (Pixel runs 9, 13, 14 of
 * 2026-10-28; reproduced on the desktop by holding back the worker script). Like a DevTools transport
 * stall it is reported, not judged.
 */
export function transportMs(report: LoadReport): number {
  return Math.max(0, Math.min(report.workerStartMs ?? 0, report.phases.storage_open ?? 0))
}

/** Phases (and the total, and the first frame) above their budget, as readable problems. */
export function loadBudgetProblems(report: LoadReport, budget: { phaseMs: number; totalMs: number; firstFrameMs: number }): string[] {
  const transport = transportMs(report)
  const judged = (phase: string, ms: number) => phase === 'storage_open' ? ms - transport : ms
  const problems = Object.entries(report.phases).filter(([phase, ms]) => judged(phase, ms) > budget.phaseMs)
    .map(([phase, ms]) => `phase ${phase} took ${judged(phase, ms)} ms${transport && phase === 'storage_open' ? ` after the worker start` : ''} (budget ${budget.phaseMs})`)
  if (report.totalMs - transport > budget.totalMs) problems.push(`total ${report.totalMs - transport} ms${transport ? ' without the worker start' : ''} (budget ${budget.totalMs})`)
  if (report.firstFrameMs !== undefined && report.firstFrameMs > budget.firstFrameMs) problems.push(`first frame after ${report.firstFrameMs} ms (budget ${budget.firstFrameMs})`)
  return problems
}

// ---------------------------------------------------------------------------
// Frame expectations
// ---------------------------------------------------------------------------

/** A piece of the edited timeline: timeline frames [start, end) show the clip from source time `sourceStartSeconds`. */
export interface TimelineSegment { startFrame: number; endFrame: number; sourceStartSeconds: number }

/**
 * The frame code every timeline frame of `[0, totalFrames)` must show (null: nothing, a gap), at
 * timeline rate `fps`, for a clip cut into `segments`. `frameAt` maps a source time to the frame a
 * correct player shows there (fixtures/phoneFootageProfiles.ts frameIndexAt for phone footage).
 */
export function expectedTimelineFrames(segments: readonly TimelineSegment[], totalFrames: number, fps: number,
  frameAt: (sourceSeconds: number) => number | null): Array<number | null> {
  return Array.from({ length: totalFrames }, (_, frame) => {
    const segment = segments.find(item => frame >= item.startFrame && frame < item.endFrame)
    return segment ? frameAt(segment.sourceStartSeconds + (frame - segment.startFrame) / fps) : null
  })
}

/**
 * Pictures a keyboard seek from timeline frame `start` to `target` may still show on its way: the expected
 * picture (`pictureAt`) of every timeline frame strictly between the two. Frames on a cut (the first or last
 * frame of a segment) never count, and no neighbouring picture is added: a wrong picture at a cut boundary
 * (the typical off-by-one of a split or trim) must fail even while it only flickers on the way.
 * `pictureAt` may name several pictures for one step: at a source time a presentation timestamp of jittered
 * footage nearly touches, the player's rounding policy decides between two frames (isClearSource), and the
 * seek may show either while it passes (Pixel run 2026-10-28: frame 152 at timeline frame 152 on the way to 153).
 */
export function seekPathPictures(segments: readonly TimelineSegment[], start: number, target: number,
  pictureAt: (frame: number) => number | null | readonly number[]): Set<number> {
  const onCut = (frame: number) => segments.some(item => frame === item.startFrame || frame === item.endFrame - 1)
  const passed = new Set<number>(), excluded = new Set<number>()
  for (let step = Math.min(start, target) + 1; step < Math.max(start, target); step++) {
    const pictures = pictureAt(step)
    if (pictures === null) continue
    for (const picture of typeof pictures === 'number' ? [pictures] : pictures) {
      if (onCut(step)) excluded.add(picture); else passed.add(picture)
    }
  }
  for (const picture of excluded) passed.delete(picture)
  return passed
}

/** The source time timeline frame `frame` shows, or null in a gap. */
export function sourceSecondsAt(segments: readonly TimelineSegment[], frame: number, fps: number): number | null {
  const segment = segments.find(item => frame >= item.startFrame && frame < item.endFrame)
  return segment ? segment.sourceStartSeconds + (frame - segment.startFrame) / fps : null
}

/**
 * Splits frame differences into hard failures and rounding-policy cases: at a `fuzzy` frame (a
 * source time within a couple of ms of a presentation time of jittered footage) the neighbour of the
 * expected frame is a policy difference, reported but not failed; anything else is a failure.
 */
export function judgeFrames(expected: ReadonlyArray<number | null>, actual: ReadonlyArray<number | null>, fuzzy: (index: number) => boolean,
  limit = 20): { failures: string[]; policy: string[] } {
  const failures: string[] = [], policy: string[] = []
  if (expected.length !== actual.length) failures.push(`expected ${expected.length} frames, got ${actual.length}`)
  for (let index = 0; index < Math.min(expected.length, actual.length); index++) {
    const want = expected[index], got = actual[index]
    if (want === got) continue
    const line = `#${index}: got ${got ?? 'none'}, expected ${want ?? 'none (gap)'}`
    if (want !== null && got !== null && Math.abs(want - got) === 1 && fuzzy(index)) policy.push(line)
    else if (failures.length < limit) failures.push(line)
  }
  return { failures, policy }
}

/** Differences between expected and decoded frames, as "#i: got x, expected y" (first `limit`). */
export function frameMismatches(expected: ReadonlyArray<number | null>, actual: ReadonlyArray<number | null>, limit = 20): string[] {
  const problems: string[] = []
  if (expected.length !== actual.length) problems.push(`expected ${expected.length} frames, got ${actual.length}`)
  for (let index = 0; index < Math.min(expected.length, actual.length) && problems.length < limit; index++) {
    if (expected[index] !== actual[index]) problems.push(`#${index}: got ${actual[index] ?? 'none'}, expected ${expected[index] ?? 'none (gap)'}`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// Page-side action timeline (deviceTelemetry.installActionTimeline)
// ---------------------------------------------------------------------------

/**
 * What the page itself saw, with performance.now() times: a touch (`down`) or `click` on an element
 * with a data-testid, and a watched test id that appears (`show`) or disappears (`hide`).
 */
export interface ActionEvent { atMs: number; kind: 'down' | 'click' | 'show' | 'hide'; id: string }

/** First event of `kind` on `id` at or after `fromMs`, or null. */
export function firstAction(events: readonly ActionEvent[], kind: ActionEvent['kind'], id: string, fromMs = 0): ActionEvent | null {
  return events.find(event => event.atMs >= fromMs && event.kind === kind && event.id === id) ?? null
}

export interface ActionPhases {
  /** Phase name → ms, measured in the page (no DevTools transport in it). Missing ends are left out. */
  phases: Record<string, number>
  /** Page time from the finger on the button to the end state; null when an end was not seen. */
  pageMs: number | null
  /**
   * PC wall time minus pageMs: time the action spent in the DevTools transport (wireless adb), not in
   * the product. A large value is a harness stall, never a product regression.
   */
  transportMs: number | null
}

/**
 * Splits one tapped action into page-side phases: `tap` (touch down to click on `target`), then each
 * named end (a `show`/`hide` of a test id) measured from the click. `pageMs` runs from the touch to the
 * latest end. Only events after `sinceMs` count (the action's own events).
 */
export function actionPhases(events: readonly ActionEvent[], target: string, ends: Record<string, { kind: 'show' | 'hide'; id: string }>,
  wallMs: number, sinceMs = 0): ActionPhases {
  const down = firstAction(events, 'down', target, sinceMs)
  const click = firstAction(events, 'click', target, down?.atMs ?? sinceMs)
  const phases: Record<string, number> = {}
  if (!click) return { phases, pageMs: null, transportMs: null }
  if (down) phases.tap = Math.round(click.atMs - down.atMs)
  let latest: number | null = click.atMs
  for (const [name, end] of Object.entries(ends)) {
    const hit = firstAction(events, end.kind, end.id, click.atMs)
    if (!hit) { latest = null; continue }
    phases[name] = Math.round(hit.atMs - click.atMs)
    if (latest !== null) latest = Math.max(latest, hit.atMs)
  }
  const pageMs = latest === null ? null : Math.round(latest - (down ?? click).atMs)
  return { phases, pageMs, transportMs: pageMs === null ? null : Math.max(0, Math.round(wallMs - pageMs)) }
}

export function describeActionPhases(result: ActionPhases): string {
  const phases = Object.entries(result.phases).map(([phase, ms]) => `${phase} ${ms}`).join(' · ')
  return `page ${result.pageMs ?? '?'} ms (${phases || 'no phases'}) · DevTools transport ${result.transportMs ?? '?'} ms`
}

/** A media import report of window.__MS_MEDIA_IMPORT__, machine fields only. */
export interface MediaImportReport { kind: string; mediaType: string; bytes: number; totalMs: number; outcome: string; phases: Array<{ phase: string; ms: number }> }

const SAFE_TOKEN = /^[a-z0-9_./+-]{1,40}$/i

/** Sanitizes window.__MS_MEDIA_IMPORT__ (only machine tokens and numbers pass; no names or paths exist there). */
export function sanitizeMediaImportReports(raw: unknown): MediaImportReport[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown) => {
    const report = item as Record<string, unknown>
    const totalMs = finite(report.totalMs), bytes = finite(report.bytes)
    if (typeof report.kind !== 'string' || !SAFE_TOKEN.test(report.kind) || totalMs === null || bytes === null) return []
    const mediaType = typeof report.mediaType === 'string' && SAFE_TOKEN.test(report.mediaType) ? report.mediaType : 'unknown'
    const outcome = typeof report.outcome === 'string' && SAFE_TOKEN.test(report.outcome) ? report.outcome : 'unknown'
    const phases = Array.isArray(report.phases) ? report.phases.flatMap((phase: unknown) => {
      const entry = phase as { phase?: unknown; ms?: unknown }
      const ms = finite(entry.ms)
      return typeof entry.phase === 'string' && SAFE_TOKEN.test(entry.phase) && ms !== null ? [{ phase: entry.phase, ms: Math.round(ms) }] : []
    }) : []
    return [{ kind: report.kind, mediaType, bytes, totalMs: Math.round(totalMs), outcome, phases }]
  })
}

export function describeMediaImport(report: MediaImportReport): string {
  return `${report.kind} ${report.outcome}: total ${report.totalMs} ms${report.phases.length ? ` · ${report.phases.map(entry => `${entry.phase} ${entry.ms}`).join(' · ')}` : ''}`
}
