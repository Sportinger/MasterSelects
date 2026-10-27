import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import {
  expect, IDS, M1_IDS, importViaSheet, previewPixels, seek, tapAction, tapClip, tapOn, type M1Clip, type M1Session,
} from './m1Fixture'

/**
 * Helpers of the M2 design-sheet journeys (mask, crop & transform, overlay, format). They build on
 * the M1 world (m1Fixture.ts: a fresh empty 1080x1920 composition per test, real touch, bridge only
 * for inspection). The truth is the preview's pixels: region means and whole-frame differences of
 * the frame-code clip (360x640, fills the 9:16 canvas exactly), awaited until two reads agree.
 */

export type Pixels = Awaited<ReturnType<typeof previewPixels>>

export interface Region { x0: number; y0: number; x1: number; y1: number }

/** Mean RGB of a region given in fractions of the preview. */
export function regionMean(px: Pixels, region: Region): { r: number; g: number; b: number; luma: number } {
  const x0 = Math.floor(region.x0 * px.width), x1 = Math.max(x0 + 1, Math.floor(region.x1 * px.width))
  const y0 = Math.floor(region.y0 * px.height), y1 = Math.max(y0 + 1, Math.floor(region.y1 * px.height))
  let r = 0, g = 0, b = 0, n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * px.width + x) * 3
      r += px.data[offset]; g += px.data[offset + 1]; b += px.data[offset + 2]; n++
    }
  }
  r /= n; g /= n; b /= n
  return { r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b }
}

/** Share of pixels (whole frame) whose channels differ by more than `threshold`; 1 when the sizes differ. */
export function frameDifference(a: Pixels, b: Pixels, threshold = 40, region: Region = { x0: 0, y0: 0, x1: 1, y1: 1 }): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  const x0 = Math.floor(region.x0 * a.width), x1 = Math.floor(region.x1 * a.width)
  const y0 = Math.floor(region.y0 * a.height), y1 = Math.floor(region.y1 * a.height)
  let different = 0, total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * a.width + x) * 3
      total++
      if (Math.max(Math.abs(a.data[offset] - b.data[offset]), Math.abs(a.data[offset + 1] - b.data[offset + 1]), Math.abs(a.data[offset + 2] - b.data[offset + 2])) > threshold) different++
    }
  }
  return total === 0 ? 1 : different / total
}

/**
 * True when `after` shows the six colour bars of `before` in mirrored order: the centre strip of
 * bar i after equals the centre strip of bar 5 - i before (each channel within `tolerance`).
 * Strip centres avoid the one-pixel resampling seams at bar edges.
 */
export function barsMirrored(before: Pixels, after: Pixels, band: { y0: number; y1: number }, tolerance = 25): boolean {
  if (before.width !== after.width || before.height !== after.height) return false
  for (let bar = 0; bar < 6; bar++) {
    const strip = (index: number) => ({ x0: (index + 0.3) / 6, x1: (index + 0.7) / 6, y0: band.y0, y1: band.y1 })
    const a = regionMean(after, strip(bar))
    const b = regionMean(before, strip(5 - bar))
    if (Math.abs(a.r - b.r) > tolerance || Math.abs(a.g - b.g) > tolerance || Math.abs(a.b - b.b) > tolerance) return false
  }
  return true
}

/** Reads the preview until two consecutive reads (a few frames apart) agree; no timers. */
export async function stablePixels(m1: M1Session, timeoutMs = 15_000): Promise<Pixels> {
  const deadline = Date.now() + timeoutMs
  let previous = await previewPixels(m1.probe)
  while (Date.now() < deadline) {
    await m1.touch.nextFrame(3)
    const current = await previewPixels(m1.probe)
    if (frameDifference(previous, current, 12) < 0.001) return current
    previous = current
  }
  throw new Error(`The preview kept changing for ${timeoutMs} ms`)
}

/** Polls until `predicate` holds for a stable preview read; returns that read. */
export async function waitForPixels(m1: M1Session, predicate: (px: Pixels) => boolean, message: string, timeoutMs = 20_000): Promise<Pixels> {
  let last: Pixels | null = null
  await expect.poll(async () => {
    last = await stablePixels(m1)
    return predicate(last)
  }, { timeout: timeoutMs, message }).toBe(true)
  return last!
}

/**
 * Waits until the editor is settled: no media file still importing and every applied revision saved
 * (the phone storage status reads "saved"). Background import work commits its own revisions; an
 * undo case must start after them, or its Undo lands on that background step.
 */
export async function waitForSettledHistory(m1: M1Session): Promise<void> {
  await expect.poll(async () => {
    const items = await m1.bridge.toolData<{ files?: Array<{ isImporting?: boolean }>; folders?: unknown }>('getMediaItems')
    const files = JSON.stringify(items)
    return !files.includes('"isImporting":true')
  }, { message: 'a media file is still importing', timeout: 30_000 }).toBe(true)
  await expect(m1.page.getByTestId(M1_IDS.storageStatus), 'the project did not finish saving').toHaveAttribute('data-phase', 'saved', { timeout: 30_000 })
}

/** Imports the 4 s frame-code clip A through the media sheet; playhead 0.5 s (frame 15) on screen. */
export async function importClipA(m1: M1Session): Promise<M1Clip> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await seek(m1, 0.5)
  m1.probe.mark()
  await m1.probe.waitForFrame(15, { allowed: () => true, timeoutMs: 20_000 })
  await waitForSettledHistory(m1)
  return state.main[0]
}

/** Selects the clip by touch and opens one of its clip tools. */
export async function openClipSheet(m1: M1Session, clipId: string, actionId: string): Promise<void> {
  const selected = (await m1.timeline()).selectedIds
  if (!(selected.length === 1 && selected[0] === clipId)) await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'the clip did not get selected' }).toEqual([clipId])
  await tapAction(m1, phoneActionTestId(actionId))
  await expect(m1.sheet, `the ${actionId} sheet did not open`).toBeVisible()
  await expectPreviewAboveSheet(m1)
}

/** Opens a root tool (nothing selected). */
export async function openRootSheet(m1: M1Session, actionId: string): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => (await m1.timeline()).selectedIds.length).toBe(0)
  await tapAction(m1, phoneActionTestId(actionId))
  await expect(m1.sheet, `the ${actionId} sheet did not open`).toBeVisible()
  await expectPreviewAboveSheet(m1)
}

/** The preview stays visible above an open sheet (owner rule). */
export async function expectPreviewAboveSheet(m1: M1Session): Promise<void> {
  const canvas = m1.page.getByTestId(IDS.previewRegion).getByTestId(IDS.previewCanvas)
  await expect(canvas).toBeVisible()
  const [box, sheet] = await Promise.all([canvas.boundingBox(), m1.sheet.boundingBox()])
  expect(box && box.height > 120, `preview height with the sheet open: ${box?.height}`).toBe(true)
  expect(box && sheet && box.y + box.height <= sheet.y + 1, 'the preview sits above the sheet').toBe(true)
}

export async function tapDone(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden({ timeout: 30_000 })
}

export async function tapCancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'the sheet stayed open after Cancel').toBeHidden({ timeout: 10_000 })
}

export async function tapUndo(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

/** Taps a range slider at a fraction of its track (real touch, like a thumb landing there). */
export async function tapSlider(m1: M1Session, testId: string, fraction: number): Promise<void> {
  const input = m1.page.getByTestId(`${testId}-input`)
  await input.scrollIntoViewIfNeeded()
  const box = await input.boundingBox()
  if (!box) throw new Error(`slider ${testId} is not rendered`)
  await m1.touch.tap({ x: box.x + 12 + (box.width - 24) * fraction, y: box.y + box.height / 2 })
}

/** Durable clip state the sheets may touch (masks, transform), from the bridge. */
export async function clipSnapshot(m1: M1Session, clipId: string): Promise<string> {
  const details = await m1.bridge.toolData<Record<string, unknown>>('getClipDetails', { clipId })
  const pick = ['masks', 'transform', 'storedTransform', 'opacity', 'position', 'scale', 'rotation', 'startTime', 'duration', 'trackId', 'effects']
  return JSON.stringify(Object.fromEntries(pick.filter(key => key in details).map(key => [key, details[key]])))
}

export async function activeCompositionSize(m1: M1Session): Promise<{ width: number; height: number }> {
  const state = await m1.timeline()
  const items = await m1.bridge.toolData<{ compositions: Array<{ id: string; width: number; height: number }> }>('getMediaItems')
  const comp = items.compositions.find(item => item.id === state.activeCompositionId)
  if (!comp) throw new Error('the active composition is not listed')
  return { width: comp.width, height: comp.height }
}

/** Regions of the frame-code clip (fractions; FRAME_CODE_LAYOUT bands: bars 0.26-0.66). */
export const REGIONS = {
  centre: { x0: 0.42, y0: 0.4, x1: 0.58, y1: 0.5 },
  bars: { x0: 0.02, y0: 0.3, x1: 0.98, y1: 0.62 },
  cornerBottomLeft: { x0: 0.01, y0: 0.9, x1: 0.1, y1: 0.99 },
  cornerTopRight: { x0: 0.9, y0: 0.2, x1: 0.99, y1: 0.24 },
  topBand: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.18 },
  bottomBand: { x0: 0.05, y0: 0.86, x1: 0.95, y1: 0.98 },
  upperHalf: { x0: 0.05, y0: 0.27, x1: 0.95, y1: 0.45 },
  lowerHalf: { x0: 0.05, y0: 0.55, x1: 0.95, y1: 0.65 },
} as const
