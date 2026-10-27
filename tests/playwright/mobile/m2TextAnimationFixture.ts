import type { Locator } from '@playwright/test'
import { PHONE_TEXT_TEST_IDS, phoneTextTabTestId, type PhoneTextStyleTab } from '../../../src/components/mobileSkin/text/phoneTextTestIds'
import {
  ACTION_TEXT, IDS, M1_IDS, expect, importViaSheet, previewPixels, seek, settled, tapAction, tapOn,
  type M1Session, type M1Timeline,
} from './m1Fixture'
import { readPreviewFrame } from './phoneTouch'

/**
 * Helpers of the M2 text / animation / keyframe journeys (m2-text-animation-keyframe.spec.ts).
 * They build on the M1 world (m1Fixture.ts): a fresh empty 1080x1920 composition per test, clips
 * imported through the media sheet, every action under test a real touch. The frame-code clips are
 * black with a white code band at the top, so coloured title pixels are easy to count.
 */

export type Pixels = Awaited<ReturnType<typeof previewPixels>>

/** Share of pixels below the code band (top 20 %) that satisfy `test`. */
export function shareWhere(image: Pixels, test: (r: number, g: number, b: number) => boolean): number {
  const first = Math.floor(image.height * 0.2) * image.width
  const total = image.width * image.height - first
  let hits = 0
  for (let pixel = first; pixel < image.width * image.height; pixel++) {
    const offset = pixel * 3
    if (test(image.data[offset], image.data[offset + 1], image.data[offset + 2])) hits++
  }
  return hits / total
}

/** Bright, roughly neutral pixels: white title fill. */
export const isWhite = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200

/**
 * Pixel indices (below the code band) where `image` differs from `base`: the glyphs of a title when
 * `base` is the same picture without it. The frame-code clip is a colour-bar chart, so colours are
 * judged on this mask against a reference title, never as absolute colour counts.
 */
export function differenceMask(base: Pixels, image: Pixels, threshold = 60): Set<number> {
  const mask = new Set<number>()
  for (let pixel = Math.floor(image.height * 0.2) * image.width; pixel < image.width * image.height; pixel++) {
    const offset = pixel * 3
    if (Math.max(Math.abs(base.data[offset] - image.data[offset]), Math.abs(base.data[offset + 1] - image.data[offset + 1]),
      Math.abs(base.data[offset + 2] - image.data[offset + 2])) > threshold) mask.add(pixel)
  }
  return mask
}

/** Mean redness (r minus the larger of g and b) of `image` over the `mask` pixels. */
export function rednessOver(image: Pixels, mask: Set<number>): number {
  let sum = 0
  for (const pixel of mask) {
    const offset = pixel * 3
    sum += image.data[offset] - Math.max(image.data[offset + 1], image.data[offset + 2])
  }
  return mask.size > 0 ? sum / mask.size : 0
}

/** Share of pixels outside `mask` (below the code band) where `a` and `b` differ: outline and shadow around glyphs. */
export function differingOutside(a: Pixels, b: Pixels, mask: Set<number>, threshold = 60): number {
  const first = Math.floor(a.height * 0.2) * a.width
  let hits = 0
  for (let pixel = first; pixel < a.width * a.height; pixel++) {
    if (mask.has(pixel)) continue
    const offset = pixel * 3
    if (Math.max(Math.abs(a.data[offset] - b.data[offset]), Math.abs(a.data[offset + 1] - b.data[offset + 1]),
      Math.abs(a.data[offset + 2] - b.data[offset + 2])) > threshold) hits++
  }
  return hits / (a.width * a.height - first)
}

/** Mean x (0..1 of the width) of the pixels below the code band that differ from `base`. */
export function differenceCentroidX(base: Pixels, image: Pixels, threshold = 60): number | null {
  const first = Math.floor(image.height * 0.2)
  let sum = 0
  let count = 0
  for (let y = first; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 3
      const delta = Math.max(Math.abs(base.data[offset] - image.data[offset]), Math.abs(base.data[offset + 1] - image.data[offset + 1]),
        Math.abs(base.data[offset + 2] - image.data[offset + 2]))
      if (delta > threshold) { sum += x; count++ }
    }
  }
  return count > 20 ? sum / count / image.width : null
}

/** One frame-code clip (A, 4 s) on the main track, playhead at `time`, the preview showing it. */
export async function importA(m1: M1Session, time = 1): Promise<M1Timeline> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await seek(m1, time)
  await settled(m1)
  m1.probe.mark()
  await m1.probe.waitForFrame(Math.floor(time * 30 + 1e-6), { allowed: () => true, timeoutMs: 15_000 })
  return state
}

export async function textClips(m1: M1Session) {
  return (await m1.timeline()).all.filter(clip => clip.sourceType === 'text')
}

export function tab(m1: M1Session, id: PhoneTextStyleTab): Locator {
  return m1.page.getByTestId(phoneTextTabTestId(id))
}

/** Opens the Text tool (nothing selected) and types `text` into the title row. */
export async function openTitleSheet(m1: M1Session, text: string): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  await expect(m1.page.getByTestId(ACTION_TEXT), 'the root toolbar (Text) is not showing').toBeVisible()
  await tapAction(m1, ACTION_TEXT)
  await expect(m1.sheet, 'the title sheet did not open').toBeVisible()
  const input = m1.page.getByTestId(M1_IDS.titleInput)
  await input.fill(text)
  await expect(input).toHaveValue(text)
}

/** Taps a tab of the title sheet and waits for its panel. */
export async function openTextTab(m1: M1Session, id: PhoneTextStyleTab): Promise<void> {
  await tapOn(m1, tab(m1, id))
  await expect(m1.page.getByTestId(`${PHONE_TEXT_TEST_IDS.panel}-${id}`), `the ${id} panel did not open`).toBeVisible()
}

/** Real touch: drags the thumb of a phone slider (role=slider) to `fraction` of its range, one finger, frame-paced. */
export async function tapSliderAt(m1: M1Session, slider: Locator, fraction: number): Promise<void> {
  // Centre it in the scrolling sheet body: the text row is sticky at the sheet bottom and may cover it.
  await slider.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
  const box = await slider.boundingBox()
  if (!box) throw new Error('slider is not rendered')
  const hit = await slider.evaluate((element, point) => {
    const top = document.elementFromPoint(point.x, point.y)
    return top === element || element.contains(top) ? null : (top?.className || top?.tagName || 'nothing')
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  if (hit) throw new Error(`the slider is covered by ${String(hit)}`)
  const [min, max, value] = await Promise.all(['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map(async name => Number(await slider.getAttribute(name))))
  const xAt = (f: number) => box.x + box.width * f
  const from = { x: xAt((value - min) / (max - min)), y: box.y + box.height / 2 }
  await m1.touch.pan(from, { x: xAt(fraction) - from.x, y: 0 }, { steps: 16 })
}

export async function tapDone(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden({ timeout: 15_000 })
}

export async function tapCancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'the sheet stayed open after Cancel').toBeHidden({ timeout: 15_000 })
}

export async function tapUndo(m1: M1Session): Promise<void> {
  await expect(m1.page.getByTestId(IDS.undo)).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

/** Waits until the preview pixels satisfy `check` (re-reading the canvas), returns the last read. */
export async function pixelsWhen(m1: M1Session, check: (image: Pixels) => boolean, message: string, timeout = 15_000): Promise<Pixels> {
  let last: Pixels | null = null
  await expect.poll(async () => { last = await previewPixels(m1.probe); return check(last) }, { message, timeout }).toBe(true)
  return last!
}

export async function previewCode(m1: M1Session): Promise<number | null> {
  return (await readPreviewFrame(m1.probe)).frame
}

export interface BridgeKeyframe { id: string; property: string; time: number; value: number }
export async function readKeyframes(m1: M1Session, clipId: string): Promise<BridgeKeyframe[]> {
  const data = await m1.bridge.toolData<{ keyframes: BridgeKeyframe[] }>('getKeyframes', { clipId })
  return data.keyframes.toSorted((a, b) => a.time - b.time || a.property.localeCompare(b.property))
}

export const keySignature = (keys: BridgeKeyframe[]) => keys.map(key => `${key.property}@${key.time.toFixed(3)}=${key.value.toFixed(3)}`)
