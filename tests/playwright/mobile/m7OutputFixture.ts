import { access, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import { PHONE_OUTPUT_TEST_IDS as OUT } from '../../../src/components/mobileSkin/output/phoneOutputTestIds'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { expect, importViaSheet, tapOn, waitForIdle, type M1Session } from './m1Fixture'
import { openEditor, turnLandscape, WS } from './m4R4Fixture'
import type { Point } from './phoneTouch'

/**
 * Helpers of packet G5 (Output Manager on the phone). The source is a four-colour calibration image
 * (red top left, green top right, blue bottom right, yellow bottom left) filling the composition, so
 * every slice, corner pin and mask has an exact expected colour at known output positions. Truth is
 * the output preview's real pixels (the engine draws the target with its slices and masks into the
 * Output Manager's own preview canvas) plus the saved mapping in browser storage.
 */
export { OUT }

export const PALETTE = {
  red: [230, 40, 40],
  green: [40, 200, 60],
  blue: [40, 60, 230],
  yellow: [230, 220, 40],
  black: [0, 0, 0],
  orange: [230, 120, 30],
} as const
export type Colour = keyof typeof PALETTE

const MEDIA_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

/** 360x640 quadrant image (the M1 composition is 1080x1920, so it fills the frame). */
export async function quadrantImage(): Promise<string> {
  const file = path.join(MEDIA_DIR, 'm7-output-quadrants-v1.png')
  if (await access(file).then(() => true, () => false)) return file
  await mkdir(MEDIA_DIR, { recursive: true })
  const width = 360
  const height = 640
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = y < height / 2 ? (x < width / 2 ? PALETTE.red : PALETTE.green) : (x < width / 2 ? PALETTE.yellow : PALETTE.blue)
      data.set(colour, (y * width + x) * 3)
    }
  }
  const temporary = `${file}.${process.pid}.tmp.png`
  await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(temporary)
  await rename(temporary, file)
  return file
}

/** Imports the calibration image into the case's composition through the media sheet. */
export async function importQuadrants(m1: M1Session): Promise<void> {
  await importViaSheet(m1, { visual: [await quadrantImage()] }, { total: 1 })
  await waitForIdle(m1)
}

const sel = (testId: string, attrs: Record<string, string | number> = {}) =>
  `[data-testid="${testId}"]${Object.entries(attrs).map(([key, value]) => `[data-${key}="${value}"]`).join('')}`

export const cards = (page: Page) => page.locator(sel(OUT.targetCard))
export const items = (page: Page) => page.locator(sel(OUT.item))
export const handle = (page: Page, corner: number) => page.locator(sel(OUT.handle, { corner }))
export const cornerField = (page: Page, corner: number, axis: 'x' | 'y') => page.locator(sel(OUT.cornerField, { corner, axis }))

/** Opens the Output editor in landscape with both side panels open, from the Editors sheet. */
export async function openOutputEditor(m1: M1Session): Promise<void> {
  await turnLandscape(m1)
  await openEditor(m1, 'output')
  for (const side of ['left', 'right'] as const) {
    const panel = m1.page.getByTestId(side === 'left' ? WS.sideLeft : WS.sideRight)
    if (await panel.count() === 0) await tapOn(m1, m1.page.getByTestId(side === 'left' ? WS.toggleLeft : WS.toggleRight))
    await expect(panel).toBeVisible()
  }
  await expect(m1.page.getByTestId(OUT.stage)).toBeVisible()
}

/** Removes every output target by touch (inside the open editor session), leaving an empty mapping. */
export async function removeAllTargets(m1: M1Session): Promise<void> {
  const page = m1.page
  for (let guard = 0; guard < 20 && await cards(page).count() > 0; guard++) {
    const before = await cards(page).count()
    const first = cards(page).first()
    if (await first.getAttribute('data-selected') !== 'true') await tapOn(m1, first.locator('.phone-output__card-head'))
    await tapOn(m1, page.getByTestId(OUT.targetRemove))
    await expect(cards(page)).toHaveCount(before - 1)
  }
  await expect(cards(page)).toHaveCount(0)
}

/** Fresh editor: opened, leftovers of earlier cases removed and saved away, then opened again. */
export async function freshOutputEditor(m1: M1Session): Promise<void> {
  await openOutputEditor(m1)
  if (await cards(m1.page).count() > 0) {
    await removeAllTargets(m1)
    await tapOn(m1, m1.page.getByTestId(OUT.done))
    await expect(m1.page.getByTestId(WS.root)).toHaveCount(0)
    await openOutputEditor(m1)
  }
  await expect(cards(m1.page)).toHaveCount(0)
}

export async function addTarget(m1: M1Session): Promise<string> {
  const before = await cards(m1.page).count()
  await tapOn(m1, m1.page.getByTestId(OUT.addTarget))
  await expect(cards(m1.page)).toHaveCount(before + 1)
  const id = await cards(m1.page).last().getAttribute('data-target-id')
  if (!id) throw new Error('the new output card has no target id')
  await expect(cards(m1.page).last()).toHaveAttribute('data-selected', 'true')
  return id
}

export async function addItem(m1: M1Session, kind: 'slice' | 'mask'): Promise<string> {
  const before = await items(m1.page).count()
  await tapOn(m1, m1.page.getByTestId(kind === 'slice' ? OUT.addSlice : OUT.addMask))
  await expect(items(m1.page)).toHaveCount(before + 1)
  const row = items(m1.page).last()
  await expect(row).toHaveAttribute('data-kind', kind)
  await expect(row).toHaveAttribute('data-selected', 'true')
  return (await row.getAttribute('data-item-id'))!
}

export async function selectTab(m1: M1Session, tab: 'input' | 'output'): Promise<void> {
  const button = m1.page.getByTestId(tab === 'input' ? OUT.tabInput : OUT.tabOutput)
  await tapOn(m1, button)
  await expect(button).toHaveAttribute('aria-selected', 'true')
}

/** Types percent corner values of the selected item on the active tab: {corner: [x, y]}. */
export async function typeCorners(m1: M1Session, corners: Record<number, [number, number]>): Promise<void> {
  for (const [corner, [x, y]] of Object.entries(corners)) {
    for (const [axis, value] of [['x', x], ['y', y]] as const) {
      const field = cornerField(m1.page, Number(corner), axis)
      await tapOn(m1, field)
      await field.fill(String(value))
      await field.press('Enter')
      await expect(field).toHaveValue(String(value))
    }
  }
}

/** Row action of the item at `index` in the stack. */
export async function itemAction(m1: M1Session, index: number, testId: string): Promise<void> {
  await tapOn(m1, items(m1.page).nth(index).getByTestId(testId))
}

// ---------------------------------------------------------------------------
// Output pixels
// ---------------------------------------------------------------------------

export interface Pixels { width: number; height: number; data: Buffer }

export function outputCanvas(page: Page): Locator {
  return page.getByTestId(OUT.box).locator('canvas.om-preview-canvas')
}

export async function outputPixels(page: Page): Promise<Pixels> {
  const png = await outputCanvas(page).screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Nearest palette colour of the median of a 5x5 patch at normalized (nx, ny). */
export function colourAt(pixels: Pixels, nx: number, ny: number): Colour {
  const cx = Math.round(nx * (pixels.width - 1))
  const cy = Math.round(ny * (pixels.height - 1))
  const channels: number[][] = [[], [], []]
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.min(pixels.width - 1, Math.max(0, cx + dx))
      const y = Math.min(pixels.height - 1, Math.max(0, cy + dy))
      const offset = (y * pixels.width + x) * 3
      for (let channel = 0; channel < 3; channel++) channels[channel].push(pixels.data[offset + channel])
    }
  }
  const median = channels.map(values => values.toSorted((a, b) => a - b)[12])
  let best: Colour = 'black'
  let bestDistance = Infinity
  for (const [name, colour] of Object.entries(PALETTE) as Array<[Colour, readonly number[]]>) {
    const distance = Math.hypot(median[0] - colour[0], median[1] - colour[1], median[2] - colour[2])
    if (distance < bestDistance) { best = name; bestDistance = distance }
  }
  return best
}

/** Polls the output preview until every sample shows its expected colour (no fixed waits). */
export async function expectOutput(m1: M1Session, expected: Array<[number, number, Colour]>, message: string): Promise<void> {
  await expect.poll(async () => {
    const pixels = await outputPixels(m1.page)
    return expected.map(([nx, ny]) => colourAt(pixels, nx, ny))
  }, { message, timeout: 20_000 }).toEqual(expected.map(([, , colour]) => colour))
}

/** The four quadrants of the calibration image, sampled away from edges and handles. */
export const FULL_FRAME: Array<[number, number, Colour]> = [
  [0.3, 0.3, 'red'], [0.7, 0.3, 'green'], [0.7, 0.7, 'blue'], [0.3, 0.7, 'yellow'],
]

/** Screen position of normalized (nx, ny) inside the drawn output box (zoom and pan included). */
export async function boxPoint(page: Page, nx: number, ny: number): Promise<Point> {
  const box = await page.getByTestId(OUT.box).boundingBox()
  if (!box) throw new Error('the output box is not rendered')
  return { x: box.x + nx * box.width, y: box.y + ny * box.height }
}

/** Drags corner handle `corner` of the selected item by touch to normalized (nx, ny). */
export async function dragHandle(m1: M1Session, corner: number, nx: number, ny: number, grabInset: Point = { x: 0, y: 0 }): Promise<void> {
  const target = handle(m1.page, corner)
  const hb = await target.boundingBox()
  if (!hb) throw new Error(`corner handle ${corner} is not rendered`)
  const from = { x: hb.x + hb.width / 2 + grabInset.x, y: hb.y + hb.height / 2 + grabInset.y }
  const to = await boxPoint(m1.page, nx, ny)
  await m1.touch.pan(from, { x: to.x + grabInset.x - from.x, y: to.y + grabInset.y - from.y }, { steps: 14 })
}

/** The project's saved Output Manager mapping in browser storage (what Done writes). */
export async function savedMapping(m1: M1Session): Promise<{ configs: Record<string, { slices: Array<{ type: string; enabled: boolean; inverted: boolean; name: string }> }>; targets: Array<{ id: string; name: string; source: { type: string; compositionId?: string } }> }> {
  const name = m1.projectName ?? 'Untitled Project'
  const key = `Outputmanager_${name.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()}`
  return m1.page.evaluate((storageKey) => ({
    configs: JSON.parse(window.localStorage.getItem(storageKey) ?? '{}'),
    targets: JSON.parse(window.localStorage.getItem(`${storageKey}_targets`) ?? '[]'),
  }), key)
}
