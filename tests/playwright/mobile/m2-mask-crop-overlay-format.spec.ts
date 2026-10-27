import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_CROP_TEST_IDS as CROP } from '../../../src/components/mobileSkin/crop/phoneCropTestIds'
import { phoneChipTestId } from '../../../src/components/mobileSkin/crop/phoneChipTestId'
import { PHONE_FORMAT_TEST_IDS as FORMAT } from '../../../src/components/mobileSkin/format/phoneFormatTestIds'
import { PHONE_MASK_TEST_IDS as MASK } from '../../../src/components/mobileSkin/mask/phoneMaskTestIds'
import { PHONE_OVERLAY_TEST_IDS as OVERLAY } from '../../../src/components/mobileSkin/overlay/phoneOverlayTestIds'
import { expect, tapOn, test, type M1Session } from './m1Fixture'
import {
  activeCompositionSize, barsMirrored, clipSnapshot, frameDifference, importClipA, openClipSheet, openRootSheet, regionMean,
  REGIONS, stablePixels, tapCancel, tapDone, tapSlider, tapUndo, waitForPixels, waitForSettledHistory, type Pixels,
} from './m2DesignFixture'
import { openTitleSheet } from './m2TextAnimationFixture'

/**
 * M2 "Gestalten" acceptance for the mask, crop & transform, overlay and format sheets (PLAN.md
 * section 5), one catalog case per test, in the shared M1 phone world (fresh empty 1080x1920
 * composition per test). Every action under test is real touch on the phone UI; the truth is the
 * preview's pixels of the frame-code clip (360x640, fills the 9:16 canvas), awaited until two reads
 * agree, never slept on. Each sheet proves (a) Done changes the picture as expected, (b) one Undo
 * returns exactly to the picture and clip state before, (c) Cancel leaves both untouched.
 */
test.describe.configure({ timeout: 180_000 })

const BLACK = 10
const SAME = 0.01

const chip = (m1: M1Session, prefix: string, value: string) => m1.page.getByTestId(phoneChipTestId(prefix, value))

async function dismissNotice(m1: M1Session): Promise<void> {
  const notice = m1.page.getByTestId(PHONE_TEST_IDS.unavailableNotice)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

async function undoBackTo(m1: M1Session, before: Pixels, snapshot: string, clipId: string): Promise<void> {
  await expect(m1.page.getByTestId(PHONE_TEST_IDS.undo), 'Undo is available after Done').not.toHaveAttribute('aria-disabled', 'true')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(() => clipSnapshot(m1, clipId), { message: 'one Undo did not restore the clip state' }).toBe(snapshot)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'one Undo restored the clip state but not the picture')
}

// ---------------------------------------------------------------------------
// Mask
// ---------------------------------------------------------------------------

test('mask-shapes: a circle mask keeps the middle and clears the corners @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  expect(regionMean(before, REGIONS.cornerBottomLeft).luma, 'the corner shows the clip before').toBeGreaterThan(25)

  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, chip(m1, MASK.shapes, 'circle'))
  await expect(chip(m1, MASK.shapes, 'circle')).toHaveAttribute('aria-checked', 'true')
  // Live: the preview above the sheet already shows the mask.
  await waitForPixels(m1, px => regionMean(px, REGIONS.cornerBottomLeft).luma < BLACK, 'the live preview did not show the circle mask')
  await tapDone(m1)

  const after = await waitForPixels(m1, px => regionMean(px, REGIONS.cornerBottomLeft).luma < BLACK, 'the circle mask did not clear the corner')
  expect(frameDifference(before, after, 40, REGIONS.centre), 'the middle stays as it was').toBeLessThan(SAME)
  const masks = JSON.parse(await clipSnapshot(m1, clip.id)).masks as Array<{ name: string }>
  expect(masks.map(mask => mask.name), 'one editor mask, the ellipse the desktop panel knows').toEqual(['Ellipse Mask'])
})

test('mask-shapes: one Undo after Done restores picture and clip @phone', async ({ m1 }) => {
  // Regression guard: a background revision (media verification) landing after Done used to make this
  // Undo restore a serialized copy of the mask; Undo now skips system revisions (historyNavigationPlan.ts).
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, chip(m1, MASK.shapes, 'circle'))
  await waitForPixels(m1, px => regionMean(px, REGIONS.cornerBottomLeft).luma < BLACK, 'the live preview did not show the circle mask')
  await tapDone(m1)
  await undoBackTo(m1, before, snapshot, clip.id)
})

test('mask-shapes: linear keeps one side of the edge, Invert keeps the other @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, chip(m1, MASK.shapes, 'linear'))
  await waitForPixels(m1, px => regionMean(px, REGIONS.upperHalf).luma < BLACK, 'linear did not clear the part above the edge')
  await tapOn(m1, m1.page.getByTestId(MASK.invert))
  await expect(m1.page.getByTestId(MASK.invert)).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)
  const after = await waitForPixels(m1, px => regionMean(px, REGIONS.lowerHalf).luma < BLACK, 'inverted linear did not clear the part below the edge')
  expect(frameDifference(before, after, 40, REGIONS.upperHalf), 'the part above the edge is the clip again').toBeLessThan(SAME)
})

test('mask-feather-profile: Cancel after shape, soft edge and invert leaves picture and clip unchanged @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, chip(m1, MASK.shapes, 'rectangle'))
  await tapOn(m1, m1.page.getByTestId(MASK.invert))
  await tapSlider(m1, MASK.feather, 0.5)
  await expect.poll(async () => Number.parseFloat(await m1.page.getByTestId(`${MASK.feather}-value`).innerText()), { message: 'the soft-edge slider did not move' }).toBeGreaterThan(50)
  await waitForPixels(m1, px => regionMean(px, REGIONS.centre).luma < BLACK, 'the live inverted rectangle did not clear the middle')
  await tapCancel(m1)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel did not restore the picture')
  expect(await clipSnapshot(m1, clip.id), 'Cancel leaves the clip exactly as before').toBe(snapshot)
})

// The Pen shape works now: drawing by touch is covered in m6-mask-pen.spec.ts (INV3/mask-pen-path).

// ---------------------------------------------------------------------------
// Crop & transform
// ---------------------------------------------------------------------------

test('transform-cropping: the 1:1 preset crops top and bottom; Undo restores @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'crop')
  await tapOn(m1, chip(m1, CROP.ratios, '1:1'))
  await expect(chip(m1, CROP.ratios, '1:1')).toHaveAttribute('aria-checked', 'true')
  await tapDone(m1)
  const after = await waitForPixels(m1, px => regionMean(px, REGIONS.topBand).luma < BLACK && regionMean(px, REGIONS.bottomBand).luma < BLACK,
    'the 1:1 crop did not clear the top and bottom bands')
  expect(frameDifference(before, after, 40, REGIONS.bars), 'the square middle stays as it was').toBeLessThan(SAME)
  const masks = JSON.parse(await clipSnapshot(m1, clip.id)).masks as Array<{ purpose?: string }>
  expect(masks.map(mask => mask.purpose), 'the desktop inspector crop mask').toEqual(['crop'])
  await undoBackTo(m1, before, snapshot, clip.id)
})

test('transform-flip-fit: Flip H mirrors the picture; Undo restores @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'crop')
  await tapOn(m1, chip(m1, CROP.tabs, 'transform'))
  await tapOn(m1, m1.page.getByTestId(CROP.flipH))
  await expect(m1.page.getByTestId(CROP.flipH)).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)
  const after = await waitForPixels(m1, px => barsMirrored(before, px, REGIONS.bars), 'the colour bars are not in mirrored order after Flip H')
  expect(frameDifference(before, after, 40, REGIONS.bars), 'the bars really moved').toBeGreaterThan(0.2)
  await undoBackTo(m1, before, snapshot, clip.id)
})

test('clip-opacity: the opacity slider at 0 % hides the clip; Undo restores @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'crop')
  await tapOn(m1, chip(m1, CROP.tabs, 'transform'))
  await tapSlider(m1, CROP.opacity, 0)
  await expect(m1.page.getByTestId(`${CROP.opacity}-value`)).toHaveText('0%')
  await tapDone(m1)
  await waitForPixels(m1, px => regionMean(px, REGIONS.bars).luma < BLACK, 'opacity 0 % did not hide the clip')
  await undoBackTo(m1, before, snapshot, clip.id)
})

test('transform-cropping: Cancel after crop and flip leaves picture and clip unchanged @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipSheet(m1, clip.id, 'crop')
  await tapOn(m1, chip(m1, CROP.ratios, '16:9'))
  await waitForPixels(m1, px => regionMean(px, REGIONS.topBand).luma < BLACK, 'the live 16:9 crop did not show')
  await tapOn(m1, chip(m1, CROP.tabs, 'transform'))
  await tapOn(m1, m1.page.getByTestId(CROP.flipV))
  await tapCancel(m1)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel did not restore the picture')
  expect(await clipSnapshot(m1, clip.id), 'Cancel leaves the clip exactly as before').toBe(snapshot)
})

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

async function addPhotoOverlay(m1: M1Session, clipId: string): Promise<{ overlayId: string; before: Pixels; after: Pixels }> {
  const before = await stablePixels(m1)
  await openRootSheet(m1, 'overlay')
  await m1.page.getByTestId(OVERLAY.input).setInputFiles(m1.media.image)
  await expect(m1.page.getByTestId(OVERLAY.picked)).toContainText('m1-image')
  await expect(chip(m1, OVERLAY.size, 'medium')).toHaveAttribute('aria-checked', 'true')
  await tapDone(m1)
  let state = await m1.timeline()
  await expect.poll(async () => { state = await m1.timeline(); return state.all.length }, { message: 'the overlay clip did not arrive', timeout: 60_000 }).toBe(2)
  const overlay = state.all.find(item => item.id !== clipId)!
  expect(overlay.trackId, 'the overlay sits on its own track').not.toBe(state.all.find(item => item.id === clipId)!.trackId)
  expect(overlay.start, 'the overlay starts at the playhead').toBeCloseTo(0.5, 2)
  expect(state.selectedIds, 'the overlay is selected afterwards').toEqual([overlay.id])
  // The orange photo covers the middle at half size; the corner still shows the main clip.
  const after = await waitForPixels(m1, px => {
    const centre = regionMean(px, REGIONS.centre)
    return centre.r > 180 && centre.g > 80 && centre.g < 160 && centre.b < 70
  }, 'the orange overlay does not show in the middle')
  expect(frameDifference(before, after, 40, REGIONS.cornerBottomLeft), 'the corner still shows the main clip').toBeLessThan(SAME)
  return { overlayId: overlay.id, before, after }
}

test('overlay: a photo lands at the playhead as a selected picture in picture @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await addPhotoOverlay(m1, clip.id)
})

test('overlay: one Undo removes the added overlay @phone', async ({ m1 }) => {
  // Regression guard: background import work (verification, late source jobs) used to commit trailing
  // revisions that Undo took back first; Undo now skips system revisions (historyNavigationPlan.ts).
  const clip = await importClipA(m1)
  const { before } = await addPhotoOverlay(m1, clip.id)
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'one Undo did not remove the overlay', timeout: 15_000 }).toBe(1)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'one Undo did not restore the picture')
})

test('overlay: Cancel after picking adds nothing; existing overlays are listed and selectable @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  await openRootSheet(m1, 'overlay')
  await expect(m1.page.getByTestId(OVERLAY.existing), 'no overlay at the playhead yet').toHaveCount(0)
  await m1.page.getByTestId(OVERLAY.input).setInputFiles(m1.media.image)
  await tapCancel(m1)
  expect((await m1.timeline()).all.map(item => item.id), 'Cancel adds nothing').toEqual([clip.id])
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel changed the picture')

  // Arrange an overlay (Done), then find it in the list.
  await openRootSheet(m1, 'overlay')
  await m1.page.getByTestId(OVERLAY.input).setInputFiles(m1.media.image)
  await tapOn(m1, chip(m1, OVERLAY.place, 'top-right'))
  await tapDone(m1)
  await expect.poll(async () => (await m1.timeline()).all.length, { timeout: 60_000 }).toBe(2)
  const overlayId = (await m1.timeline()).all.find(item => item.id !== clip.id)!.id
  await openRootSheet(m1, 'overlay')
  const row = m1.page.locator(`[data-testid="${OVERLAY.existing}"][data-clip-id="${overlayId}"]`)
  await expect(row).toBeVisible()
  await tapOn(m1, row)
  await expect(m1.sheet).toBeHidden()
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([overlayId])
})

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

test('format: 16:9 turns the canvas landscape, keeps the clip fitted with bars at the sides; Undo restores @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const timelineBefore = JSON.stringify((await m1.timeline()).all)
  await openRootSheet(m1, 'format')
  await expect(chip(m1, FORMAT.presets, '9:16')).toHaveAttribute('aria-checked', 'true')
  await tapOn(m1, chip(m1, FORMAT.presets, '16:9'))
  await expect(m1.page.getByTestId(FORMAT.size)).toContainText('1920 × 1080')
  await tapDone(m1)

  await expect.poll(() => activeCompositionSize(m1), { message: 'the composition did not become 1920x1080' }).toEqual({ width: 1920, height: 1080 })
  expect(JSON.stringify((await m1.timeline()).all), 'clips, times and tracks stay the same').toBe(timelineBefore)
  await waitForPixels(m1, px => {
    if (px.width <= px.height) return false
    const left = regionMean(px, { x0: 0.02, y0: 0.3, x1: 0.25, y1: 0.7 }).luma
    const right = regionMean(px, { x0: 0.75, y0: 0.3, x1: 0.98, y1: 0.7 }).luma
    const middle = regionMean(px, { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }).luma
    return left < BLACK && right < BLACK && middle > 25
  }, 'the landscape canvas does not show the fitted clip with black sides')
  const snapshot = await clipSnapshot(m1, clip.id)
  expect(snapshot.length).toBeGreaterThan(2)

  await tapUndo(m1)
  await expect.poll(() => activeCompositionSize(m1), { message: 'one Undo did not restore 1080x1920' }).toEqual({ width: 1080, height: 1920 })
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'one Undo did not restore the picture')
})

test('format: Cancel after choosing 1:1 leaves canvas, clips and picture unchanged; background options explain themselves @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openRootSheet(m1, 'format')
  await tapOn(m1, chip(m1, FORMAT.presets, '1:1'))
  await waitForPixels(m1, px => Math.abs(px.width - px.height) <= 2, 'the live preview did not turn square')
  const colour = chip(m1, FORMAT.background, 'colour')
  await expect(colour).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, colour)
  await expect(m1.page.getByTestId(PHONE_TEST_IDS.unavailableNotice)).toContainText(/background/i)
  await dismissNotice(m1)
  await tapCancel(m1)
  await expect.poll(() => activeCompositionSize(m1)).toEqual({ width: 1080, height: 1920 })
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel did not restore the picture')
  expect(await clipSnapshot(m1, clip.id), 'Cancel leaves the clip exactly as before').toBe(snapshot)
})

test('format: stepping through 16:9, 1:1 and both layouts back to 9:16 leaves the clip and a title exactly as they were @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await openTitleSheet(m1, 'Format title')
  await tapDone(m1)
  await expect.poll(async () => (await m1.timeline()).all.filter(item => item.sourceType === 'text').length, { message: 'the title was not added' }).toBe(1)
  const title = (await m1.timeline()).all.find(item => item.sourceType === 'text')!
  await waitForSettledHistory(m1)
  const before = await stablePixels(m1)
  const clipBefore = await clipSnapshot(m1, clip.id)
  const titleBefore = await clipSnapshot(m1, title.id)

  await openRootSheet(m1, 'format')
  await tapOn(m1, chip(m1, FORMAT.presets, '16:9'))
  await expect(m1.page.getByTestId(FORMAT.size)).toContainText('1920 × 1080')
  await tapOn(m1, chip(m1, FORMAT.presets, '1:1'))
  await expect(m1.page.getByTestId(FORMAT.size)).toContainText('1080 × 1080')
  await tapOn(m1, chip(m1, FORMAT.layout, 'pixels'))
  await expect(chip(m1, FORMAT.layout, 'pixels')).toHaveAttribute('aria-checked', 'true')
  await tapOn(m1, chip(m1, FORMAT.layout, 'relative'))
  await expect(chip(m1, FORMAT.layout, 'relative')).toHaveAttribute('aria-checked', 'true')
  await tapOn(m1, chip(m1, FORMAT.presets, '9:16'))
  await expect(m1.page.getByTestId(FORMAT.size)).toContainText('1080 × 1920')
  await tapDone(m1)

  await expect.poll(() => activeCompositionSize(m1)).toEqual({ width: 1080, height: 1920 })
  expect(await clipSnapshot(m1, clip.id), 'the clip is exactly as before').toBe(clipBefore)
  expect(await clipSnapshot(m1, title.id), 'the title did not shrink or move').toBe(titleBefore)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'the picture changed after stepping back to 9:16')
})
