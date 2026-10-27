import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { phoneChipTestId } from '../../../src/components/mobileSkin/crop/phoneChipTestId'
import { PHONE_MASK_TEST_IDS as MASK } from '../../../src/components/mobileSkin/mask/phoneMaskTestIds'
import { PHONE_PREVIEW_VIEW_TEST_IDS as VIEW } from '../../../src/components/mobileSkin/preview/phonePreviewViewIds'
import { PHONE_SHAPE_PATH_TEST_IDS as PATH } from '../../../src/components/mobileSkin/animation/phoneShapePathTestIds'
import { expect, tapClip, tapOn, test, type M1Session } from './m1Fixture'
import {
  frameDifference, importClipA, openClipSheet, regionMean, REGIONS, stablePixels, tapCancel, tapDone, tapSlider, tapUndo,
  waitForPixels, waitForSettledHistory, type Pixels,
} from './m2DesignFixture'
import { entry, openAllTools } from './m3PanelsFixture'
import { canvasBox, canvasPoint, g3Clip, g3Clips, g3Guides, g3ResetView, g3View, openViewSheet, panThenCancel, twist, whiteShare } from './m7PreviewFixture'

/**
 * Packet G3: handles on the phone preview. Clip handles (move / pinch / twist with snapping, one undo
 * step per gesture), constrained mask point editing (the desktop's modifier rules as touch toggles),
 * finger-drawn shape paths with reveal and dash, rulers / guides / actual pixels, and the split
 * compare of the untreated clip against its effects. Real touch through CDP; truth is the preview's
 * pixels and the editor stores (read by an in-page probe and the bridge).
 */
test.describe.configure({ timeout: 180_000 })

const BLACK = 12
const SAME = 0.02
const LEFT_EDGE = { x0: 0.01, y0: 0.3, x1: 0.12, y1: 0.6 }

async function selectClip(m1: M1Session, clipId: string): Promise<void> {
  await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([clipId])
  await expect(m1.page.getByTestId(VIEW.gizmo), 'the selected clip shows its handles on the preview').toHaveAttribute('data-clip-id', clipId)
}

async function prepare(m1: M1Session) {
  await g3ResetView(m1.page)
  const clip = await importClipA(m1)
  return clip
}

const positionX = async (m1: M1Session, id: string) => (await g3Clip(m1.page, id))!.transform.position.x

test('INV3/transform-preview-gizmo: one finger drags the selected clip, the picture moves, one Undo puts it back @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  const before = await stablePixels(m1)
  expect(regionMean(before, LEFT_EDGE).luma, 'the left edge shows the clip before').toBeGreaterThan(25)
  await selectClip(m1, clip.id)
  const box = await canvasBox(m1)
  await m1.touch.pan(await canvasPoint(m1, 0.5, 0.45), { x: box.width * 0.25, y: 0 })
  // 25 % of the canvas width = a quarter of the frame = position.x 0.5 (half-extents).
  await expect.poll(() => positionX(m1, clip.id), { message: 'the drag did not move the clip' }).toBeCloseTo(0.5, 1)
  await waitForPixels(m1, px => regionMean(px, LEFT_EDGE).luma < BLACK, 'the moved clip did not uncover the left edge')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(() => positionX(m1, clip.id), { message: 'one Undo did not restore the position' }).toBeCloseTo(0, 5)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'one Undo restored the position but not the picture')
})

test('INV3/transform-preview-gizmo: pinch scales and a two-finger twist rotates the clip, each one undo step @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  await selectClip(m1, clip.id)
  const start = (await g3Clip(m1.page, clip.id))!.transform
  await m1.touch.pinch(await canvasPoint(m1, 0.5, 0.5), 160, 80)
  await expect.poll(async () => (await g3Clip(m1.page, clip.id))!.transform.scale.all ?? 1, { message: 'the pinch did not scale the clip' }).toBeCloseTo((start.scale.all ?? 1) * 0.5, 1)
  await waitForPixels(m1, px => regionMean(px, REGIONS.cornerBottomLeft).luma < BLACK, 'the half-size clip still covers the corner')
  await twist(m1, await canvasPoint(m1, 0.5, 0.5), 60, 0, 90)
  // A clockwise twist on screen is a negative rotation.z (the editor turns positive values counter-clockwise).
  await expect.poll(async () => (await g3Clip(m1.page, clip.id))!.transform.rotation.z, { message: 'the twist did not rotate the clip' }).toBeCloseTo(start.rotation.z - 90, 0)
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await g3Clip(m1.page, clip.id))!.transform.rotation.z, { message: 'Undo did not take the twist back alone' }).toBeCloseTo(start.rotation.z, 3)
  expect((await g3Clip(m1.page, clip.id))!.transform.scale.all ?? 1, 'the pinch stays after undoing the twist').toBeCloseTo((start.scale.all ?? 1) * 0.5, 1)
})

test('INV3/transform-preview-gizmo: a small drag snaps back to the frame centre; with Snap off it moves; a cancelled touch rolls back @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  await selectClip(m1, clip.id)
  await m1.touch.pan(await canvasPoint(m1, 0.5, 0.45), { x: 5, y: 0 })
  await waitForSettledHistory(m1)
  expect(await positionX(m1, clip.id), 'a 5 px drag snaps to the frame centre').toBe(0)
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(VIEW.snap))
  await tapDone(m1)
  expect((await g3View(m1.page)).snap).toBe(false)
  await m1.touch.pan(await canvasPoint(m1, 0.5, 0.45), { x: 5, y: 0 })
  await expect.poll(() => positionX(m1, clip.id), { message: 'without Snap the small drag moves the clip' }).toBeGreaterThan(0.005)
  const moved = await positionX(m1, clip.id)
  await panThenCancel(m1, await canvasPoint(m1, 0.5, 0.45), { x: 80, y: 0 })
  await expect.poll(() => positionX(m1, clip.id), { message: 'a cancelled touch must leave the clip where it was' }).toBeCloseTo(moved, 5)
})

test('INV3/mask-constrained-editing: Whole shape keeps a rectangle mask a rectangle while a corner is dragged @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, m1.page.getByTestId(phoneChipTestId(MASK.shapes, 'rectangle')))
  await tapOn(m1, m1.page.getByTestId(MASK.editPoints))
  const overlay = m1.page.getByTestId(MASK.penOverlay)
  await expect(overlay, 'Edit as points lays the rectangle out as four points').toHaveAttribute('data-points', '4')
  await tapOn(m1, m1.page.getByTestId(`${MASK.constraint}-wholeShape`))
  await expect(m1.page.getByTestId(`${MASK.constraint}-wholeShape`)).toHaveAttribute('aria-pressed', 'true')
  const corner = m1.page.locator(`[data-testid="${MASK.penPoint}"][data-index="2"]`)
  const cbox = (await corner.boundingBox())!
  await m1.touch.pan({ x: cbox.x + cbox.width / 2, y: cbox.y + cbox.height / 2 }, { x: 30, y: 24 })
  await expect(overlay).toHaveAttribute('data-rule', 'rectangle')
  await tapDone(m1)
  const masks = (await g3Clip(m1.page, clip.id))!.masks
  expect(masks).toHaveLength(1)
  const xs = [...new Set(masks[0].vertices.map(v => v.x.toFixed(4)))]
  const ys = [...new Set(masks[0].vertices.map(v => v.y.toFixed(4)))]
  expect([xs.length, ys.length], 'four corners on two x and two y values: still an axis-aligned rectangle').toEqual([2, 2])
})

test('INV3/mask-constrained-editing: Lock axis moves a point only along the dominant direction @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  await openClipSheet(m1, clip.id, 'mask')
  await tapOn(m1, m1.page.getByTestId(phoneChipTestId(MASK.shapes, 'rectangle')))
  await tapOn(m1, m1.page.getByTestId(MASK.editPoints))
  await tapOn(m1, m1.page.getByTestId(`${MASK.constraint}-axisLock`))
  const point = m1.page.locator(`[data-testid="${MASK.penPoint}"][data-index="1"]`)
  const pbox = (await point.boundingBox())!
  const before = (await g3Clip(m1.page, clip.id))!.masks[0].vertices[1]
  await m1.touch.pan({ x: pbox.x + pbox.width / 2, y: pbox.y + pbox.height / 2 }, { x: 40, y: 10 })
  await expect(m1.page.getByTestId(MASK.penOverlay)).toHaveAttribute('data-rule', 'axis')
  await tapDone(m1)
  const after = (await g3Clip(m1.page, clip.id))!.masks[0].vertices[1]
  expect(after.x, 'the point moved sideways').toBeGreaterThan(before.x + 0.02)
  expect(after.y, 'the vertical part of the drag was dropped').toBeCloseTo(before.y, 6)
})

/** Opens Shape path from All tools with nothing selected and starts a new path. */
async function startNewPath(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await openAllTools(m1)
  await tapOn(m1, entry(m1, 'sheet:shape-path'))
  await tapOn(m1, m1.page.getByTestId(PATH.newPath))
  const overlay = m1.page.getByTestId(PATH.overlay)
  await expect(overlay).toHaveAttribute('data-mode', 'draw')
  return overlay
}

/** A stroke from 20 % to 80 % of the width, rising from 75 % to 65 % of the height. */
async function drawStroke(m1: M1Session) {
  const box = await canvasBox(m1)
  await m1.touch.pan(await canvasPoint(m1, 0.2, 0.75), { x: box.width * 0.6, y: -box.height * 0.1 }, { steps: 16 })
}

/** Where the stroke crosses the dark band between the colour bars and the grey steps (see whiteShare). */
const STROKE_LEFT = { x0: 0.3, y0: 0.66, x1: 0.45, y1: 0.745 }
const STROKE_RIGHT = { x0: 0.56, y0: 0.64, x1: 0.72, y1: 0.715 }
const LINE = 0.01
const lineIn = (px: Pixels, region: typeof STROKE_LEFT) => whiteShare(px, region) > LINE
const lineGone = (px: Pixels, region: typeof STROKE_LEFT) => whiteShare(px, region) < LINE / 4

test('INV5/motion-freeform-path: a finger stroke becomes a path line in the picture; Cancel leaves nothing @phone', async ({ m1 }) => {
  await prepare(m1)
  const clipsBefore = (await g3Clips(m1.page)).length
  await m1.bridge.toolData('clearSelection')
  const before = await stablePixels(m1)
  const overlay = await startNewPath(m1)
  await drawStroke(m1)
  await expect(overlay, 'the stroke became a path to edit').toHaveAttribute('data-mode', 'edit')
  expect(Number(await overlay.getAttribute('data-points'))).toBeGreaterThanOrEqual(2)
  await tapCancel(m1)
  await expect.poll(async () => (await g3Clips(m1.page)).length, { message: 'Cancel must remove the drawn path clip' }).toBe(clipsBefore)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel left something in the picture')
  await startNewPath(m1)
  await drawStroke(m1)
  await tapDone(m1)
  await waitForPixels(m1, px => lineIn(px, STROKE_LEFT) && lineIn(px, STROKE_RIGHT), 'the drawn line is not in the picture after Done')
})

test('INV5/motion-freeform-path: Reveal to 50 % shows only the first half of the line (the trim that animates a line drawing itself) @phone', async ({ m1 }) => {
  await prepare(m1)
  await startNewPath(m1)
  await drawStroke(m1)
  await tapSlider(m1, PATH.trimEnd, 0.5)
  await tapDone(m1)
  const created = (await g3Clips(m1.page)).filter(c => c.source === 'motion-shape')
  expect((await g3Clip(m1.page, created[0].id))!.path?.trim?.end ?? 1).toBeCloseTo(0.5, 1)
  await waitForPixels(m1, px => lineIn(px, STROKE_LEFT) && lineGone(px, STROKE_RIGHT), 'Reveal to 50 % should keep the first half of the line and hide the second')
})

test('INV5/motion-freeform-path: the line and its Reveal show live in the picture while the Shape path sheet is open @phone', async ({ m1 }) => {
  await prepare(m1)
  await startNewPath(m1)
  expect(whiteShare(await stablePixels(m1), STROKE_LEFT), 'no white line before drawing').toBeLessThan(LINE / 4)
  await drawStroke(m1)
  await waitForPixels(m1, px => lineIn(px, STROKE_LEFT) && lineIn(px, STROKE_RIGHT), 'the live preview does not show the drawn line')
  await tapSlider(m1, PATH.trimEnd, 0)
  await waitForPixels(m1, px => lineGone(px, STROKE_LEFT) && lineGone(px, STROKE_RIGHT), 'Reveal to 0 % did not hide the line live')
  await tapCancel(m1)
})

test('INV5/motion-freeform-path: Done keeps the drawn path; tapping a segment inserts a point; one Undo removes it all @phone', async ({ m1 }) => {
  await prepare(m1)
  await m1.bridge.toolData('clearSelection')
  const clipsBefore = (await g3Clips(m1.page)).length
  await openAllTools(m1)
  await tapOn(m1, entry(m1, 'sheet:shape-path'))
  await tapOn(m1, m1.page.getByTestId(PATH.newPath))
  const overlay = m1.page.getByTestId(PATH.overlay)
  const box = await canvasBox(m1)
  await m1.touch.pan(await canvasPoint(m1, 0.2, 0.7), { x: box.width * 0.6, y: 0 }, { steps: 10 })
  await expect(overlay).toHaveAttribute('data-mode', 'edit')
  const points = Number(await overlay.getAttribute('data-points'))
  // Halfway along the straight line lies a segment, not a point: a tap there inserts one.
  await m1.touch.tap(await canvasPoint(m1, 0.5, 0.7))
  await expect(overlay).toHaveAttribute('data-points', String(points + 1))
  await tapSlider(m1, PATH.dashLength, 0.2)
  await tapDone(m1)
  const created = (await g3Clips(m1.page)).filter(c => c.source === 'motion-shape')
  expect(created).toHaveLength(1)
  const path = (await g3Clip(m1.page, created[0].id))!.path
  expect(path?.vertices.length).toBe(points + 1)
  expect(path?.dash?.length ?? 0, 'the dash length was written').toBeGreaterThan(10)
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await g3Clips(m1.page)).length, { message: 'one Undo removes the drawn path' }).toBe(clipsBefore)
})

test('INV3/preview-rulers-guides-and-actual-pixels: a guide added from Preview view lands in the composition with rulers, one Undo removes it @phone', async ({ m1 }) => {
  await prepare(m1)
  await m1.bridge.toolData('clearSelection')
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(VIEW.guideAddV))
  await expect(m1.page.getByTestId(VIEW.guideStatus)).toContainText('1 guide')
  await tapDone(m1)
  expect(await g3Guides(m1.page)).toEqual([{ orientation: 'vertical', position: 540 }])
  await expect(m1.page.getByTestId(VIEW.rulersHost), 'adding a guide shows the rulers').toBeVisible()
  const guide = m1.page.getByTestId(VIEW.rulersHost).locator('.preview-guide-vertical')
  const gbox = (await guide.boundingBox())!
  const cbox = await canvasBox(m1)
  expect(gbox.x + gbox.width / 2, 'the guide sits in the middle of the picture').toBeCloseTo(cbox.x + cbox.width / 2, 0)
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(() => g3Guides(m1.page), { message: 'one Undo removes the guide' }).toEqual([])
})

test('INV3/preview-rulers-guides-and-actual-pixels: 1:1 shows one composition pixel per CSS pixel, a finger pans it, Fit comes back @phone', async ({ m1 }) => {
  await prepare(m1)
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(phoneChipTestId(VIEW.zoom, 'actual')))
  await tapDone(m1)
  await expect.poll(async () => Math.round((await canvasBox(m1)).width), { message: '1:1 did not size the canvas to the composition' }).toBe(1080)
  await expect(m1.page.getByTestId(PHONE_TEST_IDS.previewRegion)).toHaveAttribute('data-zoom', 'actual')
  const surface = m1.page.getByTestId(VIEW.panSurface)
  const region = (await m1.page.getByTestId(PHONE_TEST_IDS.previewRegion).boundingBox())!
  const xBefore = (await canvasBox(m1)).x
  await m1.touch.pan({ x: region.x + region.width / 2, y: region.y + region.height / 2 }, { x: 80, y: 0 })
  await expect.poll(async () => (await canvasBox(m1)).x - xBefore, { message: 'the finger did not pan the 1:1 view' }).toBeCloseTo(80, -1)
  await expect(surface).toHaveAttribute('data-pan', /^8\d,0$|^7\d,0$/)
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(phoneChipTestId(VIEW.zoom, 'fit')))
  await tapDone(m1)
  await expect.poll(async () => (await canvasBox(m1)).width < region.width + 1, { message: 'Fit did not come back' }).toBe(true)
})

test('INV2/split-compare: left of the line the clip shows without its effect, right with it; the line follows the finger @phone', async ({ m1 }) => {
  const clip = await prepare(m1)
  const untreated = await stablePixels(m1)
  await m1.bridge.toolData('addEffect', { clipId: clip.id, effectType: 'invert' })
  await waitForSettledHistory(m1)
  const inverted = await waitForPixels(m1, px => frameDifference(untreated, px, 40, REGIONS.bars) > 0.3, 'the invert effect did not change the picture')
  await m1.bridge.toolData('clearSelection')
  const effects = async () => ((await m1.bridge.toolData<{ effects?: unknown[] }>('getClipDetails', { clipId: clip.id })).effects ?? []).length
  expect(await effects(), 'the invert effect is on the clip').toBe(1)
  await openViewSheet(m1)
  await expect.poll(effects, { message: 'opening Preview view must not touch the clip' }).toBe(1)
  await tapOn(m1, m1.page.getByTestId(VIEW.compare))
  await tapDone(m1)
  expect(await effects(), 'turning compare on must not touch the clip').toBe(1)
  const left = { x0: 0.05, y0: 0.3, x1: 0.4, y1: 0.6 }
  const right = { x0: 0.6, y0: 0.3, x1: 0.95, y1: 0.6 }
  const near = (a: Pixels, b: Pixels, region: typeof left) => frameDifference(a, b, 40, region) < 0.05
  await waitForPixels(m1, px => near(px, untreated, left) && near(px, inverted, right), 'compare did not show untreated left and treated right')
  const handle = m1.page.getByTestId(VIEW.compareHandle)
  const hbox = (await handle.boundingBox())!
  const box = await canvasBox(m1)
  await m1.touch.pan({ x: hbox.x + hbox.width / 2, y: hbox.y + hbox.height / 2 }, { x: box.width * 0.35, y: 0 })
  await expect.poll(async () => Number(await handle.getAttribute('data-position')), { message: 'the line did not follow the finger' }).toBeGreaterThan(0.8)
  const leftOfLine = { x0: 0.6, y0: 0.3, x1: 0.75, y1: 0.6 }
  await waitForPixels(m1, px => near(px, untreated, leftOfLine), 'after moving the line right, the picture left of it shows the untreated clip')
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(VIEW.compare))
  await tapDone(m1)
  await waitForPixels(m1, px => near(px, inverted, left) && near(px, inverted, right), 'compare off shows the fully treated picture again')
})

test('INV3/transform-preview-gizmo: Cancel in Preview view puts the view options back @phone', async ({ m1 }) => {
  await prepare(m1)
  await openViewSheet(m1)
  await tapOn(m1, m1.page.getByTestId(VIEW.handles))
  await tapOn(m1, m1.page.getByTestId(VIEW.rulers))
  await tapCancel(m1)
  expect(await g3View(m1.page)).toMatchObject({ handles: true, rulers: false })
})
