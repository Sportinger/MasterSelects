import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_CLIPBOARD_TEST_IDS as CB } from '../../../src/components/mobileSkin/clipboard/phoneClipboardTestIds'
import { IDS, expect, importViaSheet, previewPixels, seek, tapAction, tapClip, tapOn, type M1Session, type M1Timeline } from './m1Fixture'
import { readPreviewFrame } from './phoneTouch'

/**
 * Helpers of the G2 journeys (m7-clipboard*.spec.ts): copy & paste of effects, colour and animation,
 * saved looks, styling several titles and transition compositions. They build on the M1 world
 * (m1Fixture.ts: a fresh composition per test, real touch for every action under test, the bridge
 * only to arrange and inspect). The truth is the preview's pixels and frame codes.
 *
 * Media: A = 4 s (frames 0..119), B = 3 s (0..89), short = 1 s (0..29), all 360x640 at 30 fps.
 */

export type Pixels = Awaited<ReturnType<typeof previewPixels>>

export interface ClipEffect { id: string; type: string; enabled?: boolean }
export interface BridgeKey { id: string; property: string; time: number; value: number }

/** Imports A, B and short (in that order) onto the main track: A 0..4 s, B 4..7 s, short 7..8 s. */
export async function importABShort(m1: M1Session): Promise<M1Timeline> {
  return importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path, m1.media.short.path] }, { main: 3, total: 3 })
}

export async function importAB(m1: M1Session): Promise<M1Timeline> {
  return importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
}

export async function effectsOf(m1: M1Session, clipId: string): Promise<ClipEffect[]> {
  const details = await m1.bridge.toolData<{ effects?: ClipEffect[] }>('getClipDetails', { clipId })
  return (details.effects ?? []).map(effect => ({ id: effect.id, type: effect.type, enabled: effect.enabled }))
}

export async function keysOf(m1: M1Session, clipId: string, prefix = ''): Promise<BridgeKey[]> {
  const data = await m1.bridge.toolData<{ keyframes: BridgeKey[] }>('getKeyframes', { clipId })
  return data.keyframes.filter(key => key.property.startsWith(prefix)).toSorted((a, b) => a.time - b.time || a.property.localeCompare(b.property))
}

export async function previewCode(m1: M1Session): Promise<number | null> {
  return (await readPreviewFrame(m1.probe)).frame
}

/** Seeks and waits until the preview shows `frame` (or no readable code when `frame` is null). */
export async function seekAndExpect(m1: M1Session, time: number, frame: number | null, what: string): Promise<void> {
  await seek(m1, time)
  await expect.poll(() => previewCode(m1), { message: what, timeout: 20_000 }).toBe(frame)
}

/** Share of pixels whose channels differ by more than `threshold`. */
export function differing(a: Pixels, b: Pixels, threshold = 40): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let hits = 0
  for (let i = 0; i < a.data.length; i += 3) {
    if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > threshold) hits++
  }
  return hits / (a.data.length / 3)
}

/** Bounding box (fractions) of the pixels that differ, for failure messages. */
export function differenceBox(a: Pixels, b: Pixels, threshold = 40): string {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 3
    if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > threshold) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
  }
  return x1 < 0 ? 'none' : `x ${(x0 / a.width).toFixed(2)}-${(x1 / a.width).toFixed(2)}, y ${(y0 / a.height).toFixed(2)}-${(y1 / a.height).toFixed(2)}`
}

export function luma(px: Pixels): number {
  let sum = 0
  for (let i = 0; i < px.data.length; i += 3) sum += 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2]
  return sum / (px.data.length / 3)
}

/** Polls the preview until `check` holds; returns that read. */
export async function pixelsWhen(m1: M1Session, check: (px: Pixels) => boolean, message: string, timeout = 20_000): Promise<Pixels> {
  let last: Pixels | null = null
  await expect.poll(async () => { last = await previewPixels(m1.probe); return check(last) }, { message, timeout }).toBe(true)
  return last!
}

/** Selects `clipId` by touch (unless it is the only selection) and taps a clip tool. */
export async function openClipTool(m1: M1Session, clipId: string, actionId: string): Promise<void> {
  const selected = (await m1.timeline()).selectedIds
  if (!(selected.length === 1 && selected[0] === clipId)) await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'the clip did not get selected' }).toEqual([clipId])
  await tapAction(m1, phoneActionTestId(actionId))
  await expect(m1.sheet, `the ${actionId} sheet did not open`).toBeVisible()
}

export async function tapDone(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden({ timeout: 20_000 })
}

export async function tapCancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'the sheet stayed open after Cancel').toBeHidden({ timeout: 15_000 })
}

export async function tapUndo(m1: M1Session): Promise<void> {
  await expect(m1.page.getByTestId(IDS.undo)).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

/** In the Copy & paste sheet: ticks the given target rows. */
export async function pickTargets(m1: M1Session, clipIds: string[]): Promise<void> {
  for (const id of clipIds) {
    const row = m1.sheet.locator(`[data-testid="${CB.pickRow}"][data-clip-id="${id}"]`)
    await tapOn(m1, row)
    await expect(row).toHaveAttribute('aria-checked', 'true')
  }
}

/** Sets a copy/paste group chip of the Copy & paste sheet to `on`. */
export async function setGroup(m1: M1Session, testId: string, group: string, on: boolean): Promise<void> {
  const chip = m1.sheet.getByTestId(`${testId}-${group}`)
  if ((await chip.getAttribute('aria-pressed')) !== String(on)) await tapOn(m1, chip)
  await expect(chip).toHaveAttribute('aria-pressed', String(on))
}
