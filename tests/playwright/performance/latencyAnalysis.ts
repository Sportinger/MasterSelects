import type { LatencyCapture, MoveStamp, ValueStamp } from './latencyInstrumentation'
import type { PreviewFrameMatch } from './storeProbe'

/**
 * Pure analysis of one captured drag (Node side). Latencies are measured from the pointer event's
 * timestamp (when the input reached the browser) to the paint that first showed its result:
 * - control: the first paint after the dragged control's `aria-valuenow` showed the value that
 *   input produced;
 * - preview: the paint whose preview pixels match that value (reference signatures rendered for
 *   known values, see storeProbe.calibratePreview).
 */
export interface Stats { n: number; p50: number | null; p95: number | null; max: number | null }

export function stats(values: number[]): Stats {
  if (!values.length) return { n: 0, p50: null, p95: null, max: null }
  const sorted = values.toSorted((a, b) => a - b)
  const at = (q: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))])
  return { n: values.length, p50: at(0.5), p95: at(0.95), max: round(sorted[sorted.length - 1]) }
}

export const round = (value: number, digits = 1) => Number(value.toFixed(digits))

function lastAtOrBefore<T>(items: T[], time: number, key: (item: T) => number): T | null {
  let lo = 0, hi = items.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (key(items[mid]) <= time) lo = mid + 1; else hi = mid }
  return lo > 0 ? items[lo - 1] : null
}

function firstAtOrAfter(sorted: number[], time: number): number | null {
  let lo = 0, hi = sorted.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < time) lo = mid + 1; else hi = mid }
  return lo < sorted.length ? sorted[lo] : null
}

/** Each displayed value with the input that produced it (the last pointer event before the DOM change). */
export function valueInputs(values: ValueStamp[], moves: MoveStamp[]): Array<ValueStamp & { input: number }> {
  return values.flatMap(value => {
    const move = lastAtOrBefore(moves, value.t, item => item.h)
    return move ? [{ ...value, input: move.ts }] : []
  })
}

/** Input to the first paint after the control showed the value it produced. */
export function controlLatencies(values: ValueStamp[], moves: MoveStamp[], paints: number[]): number[] {
  return valueInputs(values, moves).flatMap(value => {
    const paint = firstAtOrAfter(paints, value.t)
    return paint === null || paint - value.input > 2000 ? [] : [paint - value.input]
  })
}

/** Input to the DOM change only (no paint): separates React scheduling from frame pacing. */
export function domLatencies(values: ValueStamp[], moves: MoveStamp[]): number[] {
  return valueInputs(values, moves).map(value => value.t - value.input)
}

/** Median absolute change between consecutive displayed values (the value step of one sample). */
export function valueStep(values: ValueStamp[]): number {
  const steps = values.slice(1).map((value, index) => Math.abs(value.v - values[index].v)).filter(step => step > 0)
  return stats(steps).p50 ?? 0
}

/**
 * For every paint that changed the preview: the most recent input whose value the preview now
 * shows. A triangle-wave drag passes each value twice per period, so only inputs within one
 * second before the paint count, and among values within tolerance the latest wins (a slightly
 * optimistic choice near the turning points).
 */
export function previewLatencies(matches: PreviewFrameMatch[], values: ValueStamp[], moves: MoveStamp[],
  { tolerance, maxDistance, from, until }: { tolerance: number; maxDistance: number; from: number; until: number }):
  { latencies: number[]; changedFrames: number; matched: number; unmatched: number } {
  const inputs = valueInputs(values, moves)
  const latencies: number[] = []
  let changedFrames = 0, matched = 0, unmatched = 0
  for (const frame of matches) {
    if (!frame.changed || frame.paint < from || frame.paint > until) continue
    changedFrames++
    if (frame.value === null || frame.distance > maxDistance) { unmatched++; continue }
    const window = inputs.filter(input => input.t <= frame.paint && input.t >= frame.paint - 1000)
    const within = window.filter(input => Math.abs(input.v - frame.value!) <= tolerance)
    const chosen = within.at(-1)
      ?? window.filter(input => Math.abs(input.v - frame.value!) <= tolerance * 2)
        .toSorted((a, b) => Math.abs(a.v - frame.value!) - Math.abs(b.v - frame.value!))[0]
    if (!chosen) { unmatched++; continue }
    matched++
    latencies.push(frame.paint - chosen.input)
  }
  return { latencies, changedFrames, matched, unmatched }
}

export interface DragMetrics {
  durationMs: number
  pointerEvents: number
  displayedValues: number
  fps: number
  frameInterval: Stats
  controlMs: Stats
  controlDomMs: Stats
  pairedFieldMs: Stats | null
  longTasks: number
  longTaskMs: number
  loafBlockingMs: number
  reactCommitsPerSample: number | null
  fibersPerCommit: Stats
  renderRoots: Array<[string, number]>
  samplerCostMsPerFrame: number | null
}

export function dragMetrics(capture: LatencyCapture, samples: number): DragMetrics {
  const end = capture.release || capture.t1
  const frames = capture.frames.filter(frame => frame.raf >= capture.t0 && frame.raf <= end)
  const paints = capture.frames.map(frame => frame.paint)
  const intervals = frames.slice(1).map((frame, index) => frame.raf - frames[index].raf)
  const durationMs = end - capture.t0
  const tasks = capture.longtasks.filter(task => task.start >= capture.t0 && task.start <= end)
  return {
    durationMs: Math.round(durationMs),
    pointerEvents: capture.moves.length,
    displayedValues: new Set(capture.values.map(value => value.v)).size,
    fps: round(frames.length / (durationMs / 1000)),
    frameInterval: stats(intervals),
    controlMs: stats(controlLatencies(capture.values, capture.moves, paints)),
    controlDomMs: stats(domLatencies(capture.values, capture.moves)),
    pairedFieldMs: capture.pairedValues.length ? stats(controlLatencies(capture.pairedValues, capture.moves, paints)) : null,
    longTasks: tasks.length,
    longTaskMs: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0)),
    loafBlockingMs: Math.round(capture.loafBlockingMs),
    reactCommitsPerSample: samples ? round(capture.commits / samples, 2) : null,
    fibersPerCommit: stats(capture.fibers),
    renderRoots: capture.roots,
    samplerCostMsPerFrame: capture.samples ? round(capture.sampleCostMs / capture.samples, 2) : null,
  }
}
