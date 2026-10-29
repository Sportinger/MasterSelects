import path from 'node:path'
import { test as base, expect, type ElementHandle, type Page, type TestInfo } from '@playwright/test'
import { openFrameCodeProject, type FrameCodeProject } from '../fixtures/frameCodeProject'
import { frameCodeClip, type FrameCodeClip } from '../fixtures/frameCodeMedia'
import { readFrameCode } from '../assertions/frameCodeOracle'

/**
 * Playback across a gap (owner report, production 3.3.7, 2026-10-29): two retimed clips on one
 * video track with a black gap between them. Played through, the preview stayed black after the
 * playhead entered the second clip and its picture came only later; parked on the same spot,
 * the frame showed at once.
 *
 * Cause found with this journey: while the playhead crossed a gap the render loop had no visual
 * demand, went idle and stopped calling the render callback. Nothing woke it when the playhead
 * entered the next clip (that took 100-800 ms), and the video sync, which warms and positions
 * upcoming clips, did not run in the gap either, so the clip entered cold and had to seek first.
 *
 * Each case builds its own composition: clip A (codes 0…) from 0 s, clip B (codes 500…) after
 * the gap, both with linked audio, each at its case speed. Playback starts through the UI Play
 * button. An in-page recorder copies the preview canvas and notes the playhead on every animation
 * frame (a screenshot per read takes 100-300 ms, far too slow to time an entry), and the copies
 * are decoded in Node with the frame-code oracle; the recorder is checked against a screenshot read
 * of the same paused frame first. The oracle: B's correct frame shows within ENTRY_BUDGET_MS after
 * the playhead enters B, nothing black or wrong follows inside B, and B keeps advancing.
 */
type Shared = FrameCodeProject

const FPS = 30
const GAP_SECONDS = 0.4
const SOURCE_SECONDS = 2
const LEAD_IN_SECONDS = 0.6
const B_FIRST_CODE = 500
/** From the playhead entering B to B's frame on screen (three frames at 30 fps). */
const ENTRY_BUDGET_MS = 100
const RECORD_WIDTH = 128
const RECORD_HEIGHT = 72

const test = base.extend<object, { gap: Shared }>({
  gap: [async ({ browser }, provide, workerInfo) => {
    const project = await openFrameCodeProject(browser, workerInfo.project.use.baseURL, {
      composition: 'Gap playback setup', placeClip: false, clip: { seconds: 4, audioHz: 440 },
      prepareContext: async context => { await context.addInitScript(installMediaLog) },
    })
    await provide(project)
    await project.context.close()
  }, { scope: 'worker', timeout: 180_000 }],
})

test.describe.configure({ timeout: 120_000 })

interface ClipInfo { id: string; name: string; startTime: number; endTime: number; duration: number; linkedClipId?: string }
interface TrackInfo { id: string; clips: ClipInfo[] }
interface TimelineState { playheadPosition: number; videoTracks: TrackInfo[]; audioTracks: TrackInfo[] }

interface GapCase {
  name: string
  speedA: number
  speedB: number
  /** Source clips (both alike); default 640x360, 30 fps, 4 s, one keyframe per second. */
  source?: { keyframeSeconds?: number; seconds?: number }
  /** Source in-point of clip B in seconds (default 0). */
  inB?: number
  /** Seconds of source used from clip A and clip B (default 2 each). */
  sourceSecondsA?: number
  sourceSecondsB?: number
  /** Splits clip A at this timeline time, leaving a short first piece (the owner's layout). */
  splitA?: number
  /** Gap between A and B in seconds (default 0.4). */
  gap?: number
  /** Playback starts at timeline 0 instead of in A's last 0.6 s. */
  fromStart?: boolean
  /** Playback starts this many seconds before B, inside the gap. */
  leadIn?: number
}

async function sourcesFor(gapCase: GapCase) {
  const { keyframeSeconds, seconds = 4 } = gapCase.source ?? {}
  const common = { width: 640, height: 360, fps: FPS, seconds, ...(keyframeSeconds ? { keyframeSeconds } : {}) }
  return {
    a: await frameCodeClip({ ...common, audioHz: 440 }),
    b: await frameCodeClip({ ...common, firstCode: B_FIRST_CODE, audioHz: 660 }),
  }
}

/**
 * Inspection only: notes seeks (currentTime writes), their completion, source loads, play and pause
 * of the editor's video elements with the wall clock, so a failure shows what the elements did.
 */
function installMediaLog(): void {
  type Entry = { wall: number; kind: string; el: number; at: number; to?: number; rate?: number }
  const log: Entry[] = []
  const ids = new WeakMap<HTMLMediaElement, number>()
  let counter = 0
  ;(window as unknown as { __gapMediaLog?: Entry[] }).__gapMediaLog = log
  const id = (element: HTMLMediaElement) => {
    let value = ids.get(element)
    if (value === undefined) {
      const assigned = ++counter
      value = assigned
      ids.set(element, assigned)
      for (const kind of ['seeked', 'loadeddata', 'emptied']) {
        element.addEventListener(kind, () => log.push({ wall: Date.now(), kind, el: assigned, at: element.currentTime }))
      }
    }
    return value
  }
  const proto = HTMLMediaElement.prototype
  const time = Object.getOwnPropertyDescriptor(proto, 'currentTime')!
  Object.defineProperty(proto, 'currentTime', {
    configurable: true, get: time.get,
    set(this: HTMLMediaElement, value: number) {
      if (this instanceof HTMLVideoElement) log.push({ wall: Date.now(), kind: 'seek', el: id(this), at: time.get!.call(this), to: value, rate: this.playbackRate })
      time.set!.call(this, value)
    },
  })
  const source = Object.getOwnPropertyDescriptor(proto, 'src')!
  Object.defineProperty(proto, 'src', {
    configurable: true, get: source.get,
    set(this: HTMLMediaElement, value: string) {
      if (this instanceof HTMLVideoElement && value) log.push({ wall: Date.now(), kind: 'src', el: id(this), at: 0 })
      source.set!.call(this, value)
    },
  })
  const play = proto.play, pause = proto.pause
  proto.play = function (this: HTMLMediaElement) {
    if (this instanceof HTMLVideoElement && this.paused) log.push({ wall: Date.now(), kind: 'play', el: id(this), at: this.currentTime, rate: this.playbackRate })
    return play.call(this)
  }
  proto.pause = function (this: HTMLMediaElement) {
    if (this instanceof HTMLVideoElement && !this.paused) log.push({ wall: Date.now(), kind: 'pause', el: id(this), at: this.currentTime })
    return pause.call(this)
  }
}

async function buildCase({ bridge, editor }: Shared, gapCase: GapCase, a: FrameCodeClip, b: FrameCodeClip) {
  const { name, speedA, speedB, inB = 0, sourceSecondsA = SOURCE_SECONDS, sourceSecondsB = SOURCE_SECONDS, gap = GAP_SECONDS } = gapCase
  await bridge.toolData('createComposition', { name, width: a.width, height: a.height, frameRate: FPS, duration: 10, open: true })
  await bridge.toolData('importLocalFiles', { paths: [a.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 0 }, { timeoutMs: 60_000 })
  await bridge.toolData('importLocalFiles', { paths: [b.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 6 }, { timeoutMs: 60_000 })
  await editor.waitForProjectIdle(30_000)
  const videoClips = async () => (await bridge.toolData<TimelineState>('getTimelineState')).videoTracks.flatMap(track => track.clips)
  const named = (clips: ClipInfo[], file: FrameCodeClip) => clips.filter(item => item.name === path.basename(file.path))
  const clipA = named(await videoClips(), a)[0], clipB = named(await videoClips(), b)[0]
  if (!clipA || !clipB) throw new Error('the frame-code clips are not on the timeline')
  // A clip that keeps its whole source is not trimmed (the tool reports an unchanged trim as an error).
  const sourceSeconds = a.frames / a.fps
  if (sourceSecondsA < sourceSeconds) await bridge.toolData('trimClip', { clipId: clipA.id, inPoint: 0, outPoint: sourceSecondsA })
  if (inB > 0 || sourceSecondsB < sourceSeconds) await bridge.toolData('trimClip', { clipId: clipB.id, inPoint: inB, outPoint: inB + sourceSecondsB })
  if (speedA !== 1) await bridge.toolData('setClipSpeed', { clipId: clipA.id, speed: speedA })
  if (speedB !== 1) await bridge.toolData('setClipSpeed', { clipId: clipB.id, speed: speedB })
  const wholeA = named(await videoClips(), a)[0]
  expect(wholeA.startTime, 'clip A starts at 0').toBeCloseTo(0, 3)
  expect(wholeA.duration, 'clip A duration').toBeCloseTo(sourceSecondsA / speedA, 2)
  if (gapCase.splitA) await bridge.toolData('splitClip', { clipId: wholeA.id, splitTime: gapCase.splitA })
  await bridge.toolData('moveClip', { clipId: clipB.id, newStartTime: wholeA.endTime + gap })
  const state = await bridge.toolData<TimelineState>('getTimelineState')
  const clips = state.videoTracks.flatMap(track => track.clips)
  const placedB = clips.find(item => item.id === clipB.id)!
  const piecesA = named(clips, a)
  const placedA = piecesA.reduce((last, item) => item.endTime > last.endTime ? item : last)
  // The arrangement is checked, not assumed: pieces, speeds, the gap and the linked audio.
  expect(piecesA.length, 'pieces of clip A').toBe(gapCase.splitA ? 2 : 1)
  expect(placedB.duration, 'clip B duration').toBeCloseTo(sourceSecondsB / speedB, 2)
  expect(placedB.startTime - placedA.endTime, 'gap between A and B').toBeCloseTo(gap, 2)
  const audio = state.audioTracks.flatMap(track => track.clips)
  const linked = (clip: ClipInfo) => audio.some(item => item.linkedClipId === clip.id || clip.linkedClipId === item.id)
  expect(linked(placedA), 'clip A has linked audio').toBe(true)
  expect(linked(placedB), 'clip B has linked audio').toBe(true)
  await editor.waitForProjectIdle(30_000)
  return { a: placedA, b: placedB }
}

/**
 * Per animation frame: the playhead from the timeline store and a small copy of the preview canvas
 * (drawn into a 2D canvas, read back as RGB), both with the wall clock.
 */
async function startFrameRecorder(page: Page, canvas: ElementHandle<Element>): Promise<void> {
  await page.evaluate(async ({ canvas: preview, width, height }) => {
    const { useTimelineStore } = await import(/* @vite-ignore */ String('/src/stores/timeline/index.ts')) as {
      useTimelineStore: { getState(): { playheadPosition: number } }
    }
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const context = copy.getContext('2d', { willReadFrequently: true })!
    const recorder = { samples: [] as Array<{ wall: number; position: number; pixels: string }>, stop: false }
    ;(window as unknown as { __gapRecorder?: typeof recorder }).__gapRecorder = recorder
    const tick = () => {
      if (recorder.stop) return
      context.clearRect(0, 0, width, height)
      context.drawImage(preview as HTMLCanvasElement, 0, 0, width, height)
      const data = context.getImageData(0, 0, width, height).data
      let binary = ''
      for (let index = 0; index < data.length; index += 4) binary += String.fromCharCode(data[index], data[index + 1], data[index + 2])
      recorder.samples.push({ wall: Date.now(), position: useTimelineStore.getState().playheadPosition, pixels: btoa(binary) })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, { canvas, width: RECORD_WIDTH, height: RECORD_HEIGHT })
}

interface RecordedFrame { wall: number; position: number; frame: number | null; reason?: string }

async function recordedCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gapRecorder?: { samples: unknown[] } }).__gapRecorder?.samples.length ?? 0)
}

async function lastRecordedPosition(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gapRecorder?: { samples: Array<{ position: number }> } }).__gapRecorder?.samples.at(-1)?.position ?? 0)
}

async function stopFrameRecorder(page: Page): Promise<RecordedFrame[]> {
  const samples = await page.evaluate(() => {
    const recorder = (window as unknown as { __gapRecorder?: { samples: Array<{ wall: number; position: number; pixels: string }>; stop: boolean } }).__gapRecorder
    if (!recorder) return []
    recorder.stop = true
    return recorder.samples
  })
  return samples.map(({ pixels, ...sample }) => {
    const reading = readFrameCode({ width: RECORD_WIDTH, height: RECORD_HEIGHT, channels: 3, data: Buffer.from(pixels, 'base64') })
    return { ...sample, frame: reading.valid && !reading.inverted ? reading.frame : null, ...(reading.reason ? { reason: reading.reason } : {}) }
  })
}

interface Judged extends RecordedFrame { expected?: number }

async function playAcrossGap(shared: Shared, testInfo: TestInfo, gapCase: GapCase) {
  const { page, bridge, probe } = shared
  const { name, speedA, speedB, inB = 0 } = gapCase
  const sources = await sourcesFor(gapCase)
  const { a, b } = await buildCase(shared, gapCase, sources.a, sources.b)
  const start = gapCase.fromStart ? 0 : gapCase.leadIn !== undefined ? b.startTime - gapCase.leadIn : a.endTime - LEAD_IN_SECONDS
  const bCode = (seconds: number) => B_FIRST_CODE + Math.floor((inB + seconds * speedB) * FPS + 1e-6)

  // The start state through pixels: A's frame, or black in the gap.
  await bridge.toolData('setPlayhead', { time: start })
  const startFrame = start < a.endTime ? Math.floor(start * speedA * FPS + 1e-6) : null
  probe.mark()
  if (startFrame !== null) await probe.waitForFrame(startFrame, { allowed: () => true, timeoutMs: 10_000 })
  const canvas = await probe.canvas.elementHandle()
  if (!canvas) throw new Error('the preview canvas is gone')
  if (startFrame !== null) {
    // The recorder's copy must read what the screenshot read before it is trusted.
    await startFrameRecorder(page, canvas)
    await expect.poll(() => recordedCount(page), { timeout: 5_000 }).toBeGreaterThan(3)
    const paused = await stopFrameRecorder(page)
    expect(paused.at(-1)?.frame, `the in-page preview copy does not read the paused frame ${startFrame} (${paused.at(-1)?.reason})`).toBe(startFrame)
  }

  await page.evaluate(() => { const log = (window as unknown as { __gapMediaLog?: unknown[] }).__gapMediaLog; if (log) log.length = 0 })
  await startFrameRecorder(page, canvas)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  // Record until the playhead is one second into B (or near its end).
  await expect.poll(() => lastRecordedPosition(page), { timeout: (b.startTime + 1 - start) * 1000 + 15_000, intervals: [100] })
    .toBeGreaterThan(Math.min(b.endTime - 0.05, b.startTime + 1))
  await bridge.toolData('pause')
  const samples = await stopFrameRecorder(page)
  const media = await page.evaluate(() => (window as unknown as { __gapMediaLog?: Array<{ wall: number; kind: string; el: number; at: number; to?: number; rate?: number }> }).__gapMediaLog ?? [])

  const entryWall = samples.find(sample => sample.position >= b.startTime)?.wall
  expect(entryWall, `the playhead never reached clip B at ${b.startTime.toFixed(3)} s`).toBeDefined()
  // B's last 50 ms are not judged: a copy runs a frame or two behind the store's playhead.
  const judged: Judged[] = samples.map(item => {
    const inClipB = item.position >= b.startTime && item.position < b.endTime - 0.05
    return { ...item, ...(inClipB ? { expected: bCode(item.position - b.startTime) } : {}) }
  })
  // Copy, render and paint run behind the store: allow 100 ms of B's frames plus two.
  const tolerance = Math.ceil(speedB * FPS * 0.1) + 2
  const correct = (item: Judged) => item.frame !== null && item.expected !== undefined && Math.abs(item.frame - item.expected) <= tolerance
  const firstCorrect = judged.find(item => item.wall >= entryWall! && correct(item))
  const entryDelayMs = firstCorrect ? firstCorrect.wall - entryWall! : Number.POSITIVE_INFINITY
  const afterFirst = firstCorrect ? judged.filter(item => item.wall > firstCorrect.wall && item.expected !== undefined) : []
  const wrongInB = afterFirst.filter(item => !correct(item))
  const at = (wall: number) => `${wall - entryWall!}ms`
  const frames = judged.filter(item => item.wall >= entryWall! - 200 && item.wall <= entryWall! + 1000)
    .map(item => `${at(item.wall)}:${item.frame ?? item.reason}${item.expected !== undefined ? `/${item.expected}` : ''}`)
  const timeline = compressBlack(frames)
  const mediaLine = media.map(entry => `${at(entry.wall)}:${entry.kind}#${entry.el}@${entry.at.toFixed(3)}${entry.to !== undefined ? `->${entry.to.toFixed(3)}` : ''}${entry.rate !== undefined && entry.rate !== 1 ? `x${entry.rate}` : ''}`).join(' ')
  await testInfo.attach('gap-playback.json', {
    body: JSON.stringify({
      case: gapCase, clipA: [a.startTime, a.endTime], clipB: [b.startTime, b.endTime], playbackStart: start, entryDelayMs,
      firstCorrect: firstCorrect && { frame: firstCorrect.frame, expected: firstCorrect.expected }, wrongAfterFirst: wrongInB.length,
      frames: judged.map(item => ({ at: item.wall - entryWall!, frame: item.frame, reason: item.reason, playhead: Number(item.position.toFixed(3)), expected: item.expected })),
      media: media.map(entry => ({ ...entry, atMs: entry.wall - entryWall! })),
    }, null, 1),
    contentType: 'application/json',
  })
  console.log(`[gap-playback] ${name}: B's frame ${entryDelayMs} ms after the playhead entered it`)
  const evidence = `Frames (ms from entering B: shown/expected): ${timeline}\nVideo elements: ${mediaLine}`
  expect(entryDelayMs, `clip B's frame needed ${entryDelayMs} ms after the playhead entered it (budget ${ENTRY_BUDGET_MS} ms).\n${evidence}`).toBeLessThanOrEqual(ENTRY_BUDGET_MS)
  expect(wrongInB.map(item => `${at(item.wall)}:${item.frame ?? item.reason}/${item.expected}`), `after its first frame, clip B showed black or wrong frames.\n${evidence}`).toEqual([])
  const shown = afterFirst.map(item => item.frame!)
  expect(Math.max(firstCorrect!.frame!, ...shown) - firstCorrect!.frame!, `clip B did not keep advancing.\n${evidence}`).toBeGreaterThan(speedB * FPS * 0.5)
}

// Runs of black frames are shortened to their first and last entry.
function compressBlack(entries: string[]): string {
  const black = (entry: string) => /:(flat|blend|checksum)/.test(entry)
  return entries.filter((entry, index) => !(black(entry) && index > 0 && black(entries[index - 1]) && index + 1 < entries.length && black(entries[index + 1])))
    .join(' ')
}

const CASES: GapCase[] = [
  // The owner's layout: a split 2.5x clip that uses its whole source from 0, a short gap, then a 1.5x clip.
  { name: 'short gap after a split 2.5x clip into a 1.5x clip', speedA: 2.5, speedB: 1.5, sourceSecondsA: 4, sourceSecondsB: 3, splitA: 0.15, gap: 0.3, fromStart: true },
  { name: 'short gap after a clip that ends with its source, at normal speed', speedA: 1, speedB: 1, sourceSecondsA: 4 },
  { name: 'short gap from 1.5x into 0.75x', speedA: 1.5, speedB: 0.75 },
  // Longer than the 1 s idle timeout of the render loop and the 1.5 s warmup look-ahead.
  { name: 'two-second gap at normal speed', speedA: 1, speedB: 1, gap: 2 },
  { name: 'two-second gap from 1.5x into 0.75x', speedA: 1.5, speedB: 0.75, gap: 2 },
  { name: 'playback started inside the gap, into a 1.5x clip', speedA: 1, speedB: 1.5, gap: 2, leadIn: 0.3 },
  // A cold entry must seek from the only keyframe at 0 to 5 s: slow, so a missing warmup shows.
  { name: 'two-second gap into a 2x clip whose in-point is 5 s into one long GOP', speedA: 1.5, speedB: 2, gap: 2, inB: 5, sourceSecondsB: 2.5, source: { keyframeSeconds: 8, seconds: 8 } },
]

for (const gapCase of CASES) {
  test(`playing across a gap shows the next clip's frame at once: ${gapCase.name} @module:transport`, async ({ gap }, testInfo) => {
    await playAcrossGap(gap, testInfo, gapCase)
  })
}
