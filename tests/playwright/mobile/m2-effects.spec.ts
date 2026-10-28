import type { Locator, TestInfo } from '@playwright/test'
import sharp from 'sharp'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { readPreviewFrame } from './phoneTouch'
import {
  IDS, differingShare, expect, importViaSheet, seek, settled, tapAction, tapClip, tapOn, test,
  type M1Session,
} from './m1Fixture'

/**
 * M2 "Gestalten", packet P1: the Effects, Filters and Adjust sheets of the phone skin, one catalog
 * case per test, in the M1 phone world (m1Fixture.ts: one UI-built project, a fresh composition per
 * test). The truth is the preview's real pixels (frame-code clip A, 360x640 in 1080x1920): every
 * sheet proves (a) Done changes the rendered picture, (b) ONE Undo returns to the exact before
 * pixels, (c) Cancel leaves pixels and timeline unchanged. Every action under test is real touch;
 * the bridge only arranges (import is UI, playhead and the stack-case effect are arrangement) and
 * inspects (clip details). No fixed sleeps: changes are polled on the pixels.
 */
test.describe.configure({ timeout: 180_000 })

interface Pixels { width: number; height: number; data: Buffer }

/**
 * The preview canvas as the compositor shows it, scaled to one fixed size. The preview shrinks while a
 * sheet is open and grows back after Done/Cancel, so pictures are compared at a common resolution.
 */
const SHOT = { width: 108, height: 192 }
async function previewPixels(probe: M1Session['probe']): Promise<Pixels> {
  const png = await probe.canvas.screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().resize(SHOT.width, SHOT.height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Mean channel value below the frame-code band (rows 20 %..100 %): brightness of the picture. */
function luma(pixels: Pixels): number {
  const first = Math.floor(pixels.height * 0.2) * pixels.width
  let sum = 0
  for (let pixel = first; pixel < pixels.width * pixels.height; pixel++) {
    const offset = pixel * 3
    sum += pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]
  }
  return sum / ((pixels.width * pixels.height - first) * 3)
}

/** Mean absolute channel difference below the frame-code band. */
function meanDiff(a: Pixels, b: Pixels): number {
  const first = Math.floor(a.height * 0.2) * a.width * 3
  let sum = 0
  for (let index = first; index < a.data.length; index++) sum += Math.abs(a.data[index] - b.data[index])
  return sum / (a.data.length - first)
}

const SAME = 0.01
/**
 * Same picture in the same layout (both with the sheet closed, or both with the same sheet open).
 * Pictures from different layouts are never compared with this: while a sheet is open the preview
 * shows at a different display size (fitted into the space above the sheet, so the picture resamples
 * differently, sub-pixel offsets included) and the sheet's shadow (PhoneSheet.css) falls over its
 * bottom edge. On a 390x844 viewport that alone differs in 5 % of the pixels of the untouched picture
 * (measured), so a case takes its own "before" picture with the sheet open (`openPicture`).
 */
const sameAs = (a: Pixels, b: Pixels) => differingShare(a, b, 20) < SAME

/** 4x4 block means: the picture without its finest detail (edges a pixel apart, dither grain). */
function coarse(pixels: Pixels, block = 4): Pixels {
  const width = Math.floor(pixels.width / block)
  const height = Math.floor(pixels.height / block)
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0
        for (let dy = 0; dy < block; dy++) {
          for (let dx = 0; dx < block; dx++) sum += pixels.data[((y * block + dy) * pixels.width + x * block + dx) * 3 + channel]
        }
        data[(y * width + x) * 3 + channel] = Math.round(sum / (block * block))
      }
    }
  }
  return { width, height, data }
}

/** Mean absolute channel difference of the coarse pictures between the frame-code band (top 20 %) and the sheet shadow (bottom 10 %). */
function coarseDiff(a: Pixels, b: Pixels): number {
  const ca = coarse(a)
  const cb = coarse(b)
  const first = Math.floor(ca.height * 0.2) * ca.width * 3
  const end = Math.floor(ca.height * 0.9) * ca.width * 3
  let sum = 0
  for (let index = first; index < end; index++) sum += Math.abs(ca.data[index] - cb.data[index])
  return sum / (end - first)
}

/**
 * Same picture across a layout change (sheet open versus closed): compared coarsely, so resampling
 * and the sheet shadow do not count while a different picture does (measured: the untouched picture
 * differs by under 2 of 255 between the layouts on 390x844; a filter at another strength by far more).
 */
const looksLike = (a: Pixels, b: Pixels) => coarseDiff(a, b) < 4

/** Waits until the preview pixels satisfy `check` (read twice in a row), and returns them. */
async function pixelsWhere(m1: M1Session, check: (pixels: Pixels) => boolean, message: string, timeout = 15_000, reference?: Pixels): Promise<Pixels> {
  let last: Pixels | null = null
  let streak = 0
  const describe = () => last ? `${message} (last luma ${luma(last).toFixed(1)}${reference ? `, reference luma ${luma(reference).toFixed(1)}, share ${differingShare(reference, last, 20).toFixed(4)}, mean diff ${meanDiff(reference, last).toFixed(2)}, coarse diff ${coarseDiff(reference, last).toFixed(2)}` : ''})` : message
  try {
    await expect.poll(async () => {
      last = await previewPixels(m1.probe)
      streak = check(last) ? streak + 1 : 0
      return streak >= 2
    }, { timeout, message }).toBe(true)
  } catch {
    // The pictures behind the numbers, for the report: the last read and the reference.
    const pictures: Array<[string, Pixels | null]> = [['last', last], ['reference', reference ?? null]]
    for (const [name, pixels] of pictures) {
      if (!pixels) continue
      const body = await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 3 } }).png().toBuffer()
      await test.info().attach(`pixels-${name}.png`, { body, contentType: 'image/png' })
    }
    throw new Error(describe())
  }
  return last!
}

/**
 * The picture once the layout has settled (two reads in a row show the same picture): with a sheet
 * just opened, the reference every later picture in that sheet is compared with.
 */
async function openPicture(m1: M1Session, message = 'the preview did not settle after the sheet opened'): Promise<Pixels> {
  let previous: Pixels | null = null
  return pixelsWhere(m1, (pixels) => {
    const settled = previous !== null && previous.width === pixels.width && sameAs(previous, pixels)
    previous = pixels
    return settled
  }, message)
}

interface Arranged { clipId: string; before: Pixels }

/**
 * All phone spec files of a project share one worker-scoped phone world, and the fixture's reset only
 * closes sheets. A greyed tool's reason notice left open by an earlier file (m1-edit case 11 ends with
 * it showing) is modal: the next tap outside it only dismisses it, so the Media tap of the arrangement
 * would be swallowed. Close it the way a person does (OK) before arranging.
 */
async function closeLeftoverNotice(m1: M1Session): Promise<void> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  if (!await notice.isVisible()) return
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice, 'the leftover notice did not close').toBeHidden()
}

/** Clip A through the media sheet, playhead at 1 s (frame 30), A selected by touch; the before picture. */
async function arrangeClip(m1: M1Session, { select = true }: { select?: boolean } = {}): Promise<Arranged> {
  await closeLeftoverNotice(m1)
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  const clipId = state.main[0].id
  await seek(m1, 1)
  await settled(m1)
  if (select) {
    await tapClip(m1, clipId)
    await expect(m1.clip(clipId)).toHaveAttribute('aria-selected', 'true')
  }
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { allowed: () => true, timeoutMs: 15_000 })
  const before = await pixelsWhere(m1, () => true, 'the preview did not render')
  expect((await readPreviewFrame(m1.probe)).frame, 'frame code at 1 s').toBe(30)
  return { clipId, before }
}

interface ClipEffect { id: string; type: string; enabled: boolean; params: Record<string, unknown> }
async function clipEffects(m1: M1Session, clipId: string): Promise<ClipEffect[]> {
  const details = await m1.bridge.toolData<{ effects: ClipEffect[] }>('getClipDetails', { clipId })
  return details.effects
}

/** Screenshot of the phone with the open sheet, attached to the report (and saved to MS_PHONE_SHOTS when set, for review). */
async function shot(m1: M1Session, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.MS_PHONE_SHOTS
  const body = await m1.page.screenshot(dir ? { path: `${dir}/${name}.png` } : {})
  await testInfo.attach(`${name}.png`, { body, contentType: 'image/png' })
}

async function openSheet(m1: M1Session, actionId: string): Promise<void> {
  await tapAction(m1, phoneActionTestId(actionId))
  await expect(m1.sheet, `the ${actionId} sheet did not open`).toBeVisible()
}

async function done(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden({ timeout: 15_000 })
}

async function cancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'the sheet stayed open after Cancel').toBeHidden({ timeout: 15_000 })
}

async function undoOnce(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

/** Drags the thumb of the visible slider by `fraction` of its width (real touch from the thumb). */
async function dragSlider(m1: M1Session, fraction: number): Promise<void> {
  const range = m1.sheet.getByTestId(FX.slider).locator('.handle-only-range').first()
  await range.scrollIntoViewIfNeeded()
  const box = (await range.boundingBox())!
  const [now, min, max] = await Promise.all(['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map(async name => Number(await range.getAttribute(name))))
  const ratio = (now - min) / (max - min)
  const start = { x: box.x + 3.5 + ratio * (box.width - 7), y: box.y + box.height / 2 }
  await m1.touch.pan(start, { x: fraction * (box.width - 7), y: 0 }, { steps: 10 })
}

async function sliderValue(m1: M1Session): Promise<number> {
  return Number(await m1.sheet.getByTestId(FX.slider).locator('.handle-only-range').first().getAttribute('aria-valuenow'))
}

async function expectExplains(m1: M1Session, target: Locator, text: RegExp): Promise<void> {
  await expect(target).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, target)
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice, 'a greyed option explains itself on tap').toBeVisible()
  await expect(notice).toContainText(text)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

// ---------------------------------------------------------------------------

test('effect-catalog: a card adds the effect, its main slider changes the picture, Done is one undo step @phone', async ({ m1 }, testInfo) => {
  const { clipId, before } = await arrangeClip(m1)
  await openSheet(m1, 'effects')
  // The preview stays visible above the open sheet.
  const [preview, sheet] = await Promise.all([m1.page.getByTestId(IDS.previewRegion).boundingBox(), m1.sheet.boundingBox()])
  expect(preview!.height, 'preview height above the sheet').toBeGreaterThan(96)
  expect(preview!.y + preview!.height, 'the preview ends above the sheet').toBeLessThanOrEqual(sheet!.y + 1)
  const openBefore = await openPicture(m1)

  const chip = m1.sheet.locator(`[data-testid="${FX.effectsCategory}"][data-group="color"]`)
  await tapOn(m1, chip)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="brightness"]`))
  await expect(m1.sheet.locator(`[data-testid="${FX.effectsStackRow}"][data-effect-type="brightness"]`)).toHaveCount(1)
  expect(await sliderValue(m1), 'Brightness starts neutral').toBeCloseTo(0, 5)
  await dragSlider(m1, 0.35)
  await expect.poll(() => sliderValue(m1), { message: 'the slider moved' }).toBeGreaterThan(0.4)
  const brighter = await pixelsWhere(m1, pixels => luma(pixels) > luma(openBefore) + 8, 'the main slider brightened the preview', 15_000, openBefore)
  await shot(m1, testInfo, 'effects-sheet')
  await done(m1)
  const effects = await clipEffects(m1, clipId)
  expect(effects.map(effect => effect.type), 'one Brightness on the clip').toEqual(['brightness'])
  expect(Number(effects[0].params.amount)).toBeGreaterThan(0.4)
  await pixelsWhere(m1, pixels => looksLike(pixels, brighter), 'Done keeps the brightened picture', 15_000, brighter)

  await undoOnce(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'one Undo returns to the exact before picture', 15_000, before)
  expect(await clipEffects(m1, clipId), 'one Undo removes the effect').toEqual([])
})

test('effect-catalog: Cancel leaves pixels and timeline exactly unchanged @phone', async ({ m1 }) => {
  const { clipId, before } = await arrangeClip(m1)
  await openSheet(m1, 'effects')
  await m1.page.getByTestId(FX.effectsSearch).fill('invert')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="invert"]`))
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { inverted: true, allowed: () => true, timeoutMs: 15_000 })
  await cancel(m1)
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { inverted: false, allowed: () => true, timeoutMs: 15_000 })
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'Cancel restores the exact before picture', 15_000, before)
  expect(await clipEffects(m1, clipId), 'Cancel leaves no effect behind').toEqual([])
  const state = await m1.timeline()
  expect(state.all.map(clip => clip.id), 'Cancel adds no clip').toEqual([clipId])
})

test('effect-stack: switching an effect off, moving and removing it change the picture; Done and one Undo @phone', async ({ m1 }) => {
  const { clipId, before } = await arrangeClip(m1)
  await m1.bridge.toolData('addEffect', { clipId, effectType: 'brightness', params: { amount: 0.6 } })
  await m1.bridge.toolData('addEffect', { clipId, effectType: 'invert' })
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { inverted: true, allowed: () => true, timeoutMs: 15_000 })
  const arranged = await pixelsWhere(m1, () => true, 'arranged stack renders')
  if (await m1.clip(clipId).getAttribute('aria-selected') !== 'true') await tapClip(m1, clipId)
  await expect(m1.clip(clipId)).toHaveAttribute('aria-selected', 'true')
  await openSheet(m1, 'effects')
  const rows = m1.sheet.getByTestId(FX.effectsStackRow)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-effect-type', 'brightness')
  const openArranged = await openPicture(m1)

  // Off: the inverted picture becomes upright again (Brightness only).
  await tapOn(m1, rows.nth(1).getByTestId(FX.effectsToggle))
  await expect(rows.nth(1)).toHaveAttribute('data-enabled', 'false')
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { inverted: false, allowed: () => true, timeoutMs: 15_000 })
  const brightOnly = await pixelsWhere(m1, pixels => luma(pixels) > luma(before) + 8, 'Brightness alone renders brighter')
  // Move Invert above Brightness and switch it back on: invert, then brighten differs from the arranged order.
  await tapOn(m1, rows.nth(1).getByTestId(FX.effectsMoveUp))
  await expect(rows.nth(0)).toHaveAttribute('data-effect-type', 'invert')
  await tapOn(m1, rows.nth(0).getByTestId(FX.effectsToggle))
  const reordered = await pixelsWhere(m1, pixels => !sameAs(pixels, openArranged) && !sameAs(pixels, brightOnly), 'the order changes the picture', 15_000, openArranged)
  // Remove Brightness: only Invert is left.
  await tapOn(m1, rows.nth(1).getByTestId(FX.effectsRemove))
  await expect(rows).toHaveCount(1)
  await done(m1)
  const after = await clipEffects(m1, clipId)
  expect(after.map(effect => [effect.type, effect.enabled]), 'Invert left, on').toEqual([['invert', true]])
  expect(sameAs(reordered, openArranged)).toBe(false)

  await undoOnce(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, arranged), 'one Undo restores the arranged stack picture', 15_000, arranged)
  expect((await clipEffects(m1, clipId)).map(effect => [effect.type, effect.enabled]), 'one Undo restores both effects').toEqual([['brightness', true], ['invert', true]])
})

test('adjustment-layer-effects: with nothing selected the first effect adds an adjustment layer at the playhead @phone', async ({ m1 }) => {
  const { clipId, before } = await arrangeClip(m1, { select: false })
  expect((await m1.timeline()).selectedIds).toEqual([])
  await openSheet(m1, 'effects-root')
  await expect(m1.page.getByTestId(FX.effectsTarget)).toContainText('adjustment layer')
  await m1.page.getByTestId(FX.effectsSearch).fill('slit')
  await expectExplains(m1, m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="slit-scan"]`), /adjustment layer/)
  await m1.page.getByTestId(FX.effectsSearch).fill('invert')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="invert"]`))
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { inverted: true, allowed: () => true, timeoutMs: 15_000 })
  await done(m1)
  const state = await m1.timeline()
  const layer = state.all.find(clip => clip.sourceType === 'motion-adjustment')
  expect(layer, `an adjustment layer among ${state.all.map(clip => clip.sourceType).join(', ')}`).toBeTruthy()
  expect(layer!.start, 'it starts at the playhead').toBeCloseTo(1, 3)
  expect(layer!.duration).toBeCloseTo(5, 3)
  expect((await clipEffects(m1, layer!.id)).map(effect => effect.type)).toEqual(['invert'])
  expect(await clipEffects(m1, clipId), 'the clip itself is untouched').toEqual([])
  expect(state.selectedIds, 'Done selects the new layer').toEqual([layer!.id])

  await undoOnce(m1)
  await expect.poll(async () => (await m1.timeline()).all.map(clip => clip.id), { message: 'one Undo removes the layer' }).toEqual([clipId])
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'one Undo returns to the exact before picture', 15_000, before)
})

test('curated-look-stacks: a filter applies its Look, Strength scales it, Done and one Undo @phone', async ({ m1 }, testInfo) => {
  const { clipId, before } = await arrangeClip(m1)
  await openSheet(m1, 'filters')
  await expect(m1.page.getByTestId(FX.filtersNone)).toHaveAttribute('aria-pressed', 'true')
  const openBefore = await openPicture(m1)
  const card = m1.sheet.locator(`[data-testid="${FX.filtersCard}"][data-look-id="digital-noir"]`)
  await tapOn(m1, card)
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  const full = await pixelsWhere(m1, pixels => differingShare(openBefore, pixels) > 0.05, 'the filter changes the picture', 15_000, openBefore)
  const fullDiff = meanDiff(openBefore, full)
  await expect(m1.sheet.getByTestId(FX.slider)).toBeVisible()
  expect(await sliderValue(m1), 'a new filter starts at full strength').toBe(1)
  await dragSlider(m1, -0.75)
  await expect.poll(() => sliderValue(m1), { message: 'Strength moved down' }).toBeLessThan(0.35)
  const weak = await pixelsWhere(m1, pixels => meanDiff(openBefore, pixels) < fullDiff * 0.6, 'a lower strength is closer to the original', 15_000, openBefore)
  await shot(m1, testInfo, 'filters-sheet')
  await done(m1)
  const effects = await clipEffects(m1, clipId)
  expect(effects.map(effect => effect.type), 'the Look is the clip stack').toEqual(['dither-studio', 'vignette'])
  expect(Number(effects[0].params.amount)).toBeLessThan(0.82 * 0.35 + 1e-6)
  // Done keeps the weakened filter: the same picture as in the sheet, and still not the original.
  const kept = await pixelsWhere(m1, pixels => looksLike(pixels, weak), 'Done keeps the weakened filter', 15_000, weak)
  expect(sameAs(kept, before), 'the weakened filter still shows after Done').toBe(false)
  expect(looksLike(full, weak), 'the weakened filter differs from the full one also in the coarse comparison').toBe(false)

  await undoOnce(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'one Undo returns to the exact before picture', 15_000, before)
  expect(await clipEffects(m1, clipId)).toEqual([])
})

test('curated-look-stacks: an applied filter is found again; None and Cancel restore it exactly @phone', async ({ m1 }) => {
  const { clipId, before } = await arrangeClip(m1)
  await openSheet(m1, 'filters')
  const openBefore = await openPicture(m1)
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.filtersCard}"][data-look-id="digital-noir"]`))
  await pixelsWhere(m1, pixels => differingShare(openBefore, pixels) > 0.05, 'the filter changes the picture', 15_000, openBefore)
  await done(m1)
  const filtered = await pixelsWhere(m1, pixels => differingShare(before, pixels) > 0.05, 'the filter stays after Done')

  await openSheet(m1, 'filters')
  await expect(m1.page.getByTestId(FX.filtersStatus)).toContainText('Digital Noir')
  await expect(m1.sheet.locator(`[data-testid="${FX.filtersCard}"][data-look-id="digital-noir"]`)).toHaveAttribute('aria-pressed', 'true')
  const openFiltered = await openPicture(m1)
  expect(sameAs(openFiltered, openBefore), 'the reopened sheet shows the filtered picture').toBe(false)
  await tapOn(m1, m1.page.getByTestId(FX.filtersNone))
  // Same sheet, same layout as the first opening: None is exactly the original picture.
  await pixelsWhere(m1, pixels => sameAs(pixels, openBefore), 'None shows the original picture', 15_000, openBefore)
  await cancel(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, filtered), 'Cancel restores the filtered picture exactly', 15_000, filtered)
  expect((await clipEffects(m1, clipId)).map(effect => effect.type)).toEqual(['dither-studio', 'vignette'])

  await openSheet(m1, 'filters')
  await tapOn(m1, m1.page.getByTestId(FX.filtersNone))
  await done(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'None + Done removes the filter', 15_000, before)
  expect(await clipEffects(m1, clipId)).toEqual([])
  await undoOnce(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, filtered), 'one Undo brings the filter back', 15_000, filtered)
})

test('colour-basic-adjustments: Brightness and Exposure change the picture; Reset, Done, one Undo, Cancel @phone', async ({ m1 }, testInfo) => {
  const { before } = await arrangeClip(m1)
  await openSheet(m1, 'adjust')
  const tile = (key: string) => m1.sheet.locator(`[data-testid="${FX.adjustTile}"][data-adjust-key="${key}"]`)
  for (const key of ['offset', 'exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows']) {
    await expect(tile(key), `tile ${key}`).toHaveCount(1)
  }
  await expect(tile('offset')).toHaveAttribute('aria-pressed', 'true')
  const openBefore = await openPicture(m1)
  await dragSlider(m1, 0.3)
  await expect.poll(() => sliderValue(m1), { message: 'Brightness moved' }).toBeGreaterThan(0.2)
  const brightened = await pixelsWhere(m1, pixels => luma(pixels) > luma(openBefore) + 8, 'Brightness brightens the preview', 15_000, openBefore)
  // The docked Undo waits for Done or Cancel while the sheet holds its changes: greyed, and a tap says why.
  const undo = m1.page.getByTestId(IDS.undo)
  await expect(undo, 'Undo looks disabled while the sheet holds its changes').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, undo)
  await expect(m1.page.getByTestId(IDS.toast), 'a tap on Undo explains why it waits').toContainText('Done')
  await expect(m1.sheet, 'the sheet stays open').toBeVisible()
  await pixelsWhere(m1, pixels => looksLike(pixels, brightened), 'the live change stays after the tap on Undo', 15_000, brightened)
  // Reset of the value returns the picture.
  await tapOn(m1, m1.sheet.getByTestId(FX.sliderReset))
  await pixelsWhere(m1, pixels => sameAs(pixels, openBefore), 'Reset returns to the original picture', 15_000, openBefore)
  // Exposure up, then Done.
  await tapOn(m1, tile('exposure'))
  await expect(tile('exposure')).toHaveAttribute('aria-pressed', 'true')
  await dragSlider(m1, 0.2)
  await expect.poll(() => sliderValue(m1), { message: 'Exposure moved' }).toBeGreaterThan(0.8)
  const exposed = await pixelsWhere(m1, pixels => luma(pixels) > luma(openBefore) + 8, 'Exposure brightens the preview', 15_000, openBefore)
  await shot(m1, testInfo, 'adjust-sheet')
  await done(m1)
  await pixelsWhere(m1, pixels => looksLike(pixels, exposed), 'Done keeps the adjusted picture', 15_000, exposed)
  await expect(m1.page.getByTestId(IDS.undo), 'Done gives Undo back').not.toHaveAttribute('aria-disabled', 'true')
  await undoOnce(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'one Undo returns to the exact before picture', 15_000, before)

  // Cancel: Reset all inside a session that changed things, then Cancel, leaves the picture as it was.
  await openSheet(m1, 'adjust')
  const reopened = await openPicture(m1)
  await tapOn(m1, tile('contrast'))
  await dragSlider(m1, 0.3)
  await pixelsWhere(m1, pixels => !sameAs(pixels, reopened), 'Contrast changes the preview', 15_000, reopened)
  await cancel(m1)
  await pixelsWhere(m1, pixels => sameAs(pixels, before), 'Cancel restores the exact before picture', 15_000, before)
})

test('grey-outs: options that need a clip stay visible and explain themselves on tap @phone', async ({ m1 }) => {
  const { clipId } = await arrangeClip(m1)
  await m1.bridge.toolData('addEffect', { clipId, effectType: 'glow' })
  // The former M3 rows work now (m3-panels.spec.ts covers what they open).
  await openSheet(m1, 'effects')
  await expect(m1.page.getByTestId(FX.effectsAllParameters)).not.toHaveAttribute('aria-disabled', 'true')
  await cancel(m1)
  await openSheet(m1, 'adjust')
  await expect(m1.page.getByTestId(FX.adjustWheels)).not.toHaveAttribute('aria-disabled', 'true')
  await cancel(m1)
  await m1.bridge.toolData('clearSelection')
  await expect(m1.clip(clipId)).toHaveAttribute('aria-selected', 'false')
  await openSheet(m1, 'filters-root')
  await expectExplains(m1, m1.sheet.locator(`[data-testid="${FX.filtersCard}"][data-look-id="digital-noir"]`), /Select a clip/)
  await cancel(m1)
  await openSheet(m1, 'adjust-root')
  await expectExplains(m1, m1.sheet.locator(`[data-testid="${FX.adjustTile}"][data-adjust-key="exposure"]`), /Select a clip/)
  await cancel(m1)
})
