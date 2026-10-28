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
 * Paths of the tabs (by URL) that already show the editor's origin: the phone user's MasterSelects tabs.
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
  mainThread?: { longTaskMs?: number; longTaskMaxMs?: number; longTaskCount?: number; frameGapMaxMs?: number; pageHidden?: boolean }
}

const SAFE_DETAIL = /^[a-z0-9 _-]{0,40}$/i
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The boot marks, reduced to phase, time and a short machine detail ("not-restored"). A detail that
 * is not such a token (it might carry a project name) is dropped, so attachments never name the
 * user's projects.
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
  const first = report.firstFrameMs === undefined ? '' : ` · first frame ${report.firstFrameMs}`
  return `${report.kind} ${report.outcome} (${report.storage}): total ${report.totalMs} ms${phases ? ` · ${phases}` : ''}${first}`
}

/** Phases (and the total, and the first frame) above their budget, as readable problems. */
export function loadBudgetProblems(report: LoadReport, budget: { phaseMs: number; totalMs: number; firstFrameMs: number }): string[] {
  const problems = Object.entries(report.phases).filter(([, ms]) => ms > budget.phaseMs).map(([phase, ms]) => `phase ${phase} took ${ms} ms (budget ${budget.phaseMs})`)
  if (report.totalMs > budget.totalMs) problems.push(`total ${report.totalMs} ms (budget ${budget.totalMs})`)
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
