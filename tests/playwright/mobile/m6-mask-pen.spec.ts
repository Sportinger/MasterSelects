import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { phoneChipTestId } from '../../../src/components/mobileSkin/crop/phoneChipTestId'
import { PHONE_MASK_TEST_IDS as MASK } from '../../../src/components/mobileSkin/mask/phoneMaskTestIds'
import { expect, tapOn, test, type M1Session } from './m1Fixture'
import {
  clipSnapshot, frameDifference, importClipA, openClipSheet, regionMean, REGIONS, stablePixels, tapCancel, tapDone, tapUndo,
  waitForPixels, waitForSettledHistory, type Pixels,
} from './m2DesignFixture'
import { m6Pen } from './m6Fixture'

/**
 * INV-3 mask-pen-path on the phone (packet N3): a Bezier mask path drawn by real touch on the phone
 * preview while the Mask sheet is open. Tap adds a point, keep the finger down and drag to pull its
 * handles, tap the first point to close, drag a point to move it, Undo point takes the last one back.
 * The path is an ordinary editor mask ('Pen Mask'); Done is one undo step, Cancel changes nothing.
 * Truth: the preview's real pixels of the frame-code clip and the clip's mask data from the bridge.
 */
test.describe.configure({ timeout: 180_000 })

const BLACK = 10
const SAME = 0.01
/** A square in the middle of the frame (fractions of the preview canvas); REGIONS.centre lies inside. */
const SQUARE = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.62], [0.3, 0.62]] as const

const overlay = (m1: M1Session) => m1.page.getByTestId(MASK.penOverlay)

async function canvasPoint(m1: M1Session, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await m1.page.getByTestId(PHONE_TEST_IDS.previewRegion).getByTestId(PHONE_TEST_IDS.previewCanvas).boundingBox()
  if (!box) throw new Error('the preview canvas is not rendered')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

async function startPen(m1: M1Session, clipId: string): Promise<void> {
  await openClipSheet(m1, clipId, 'mask')
  const pen = m1.page.getByTestId(phoneChipTestId(MASK.shapes, 'pen'))
  await expect(pen, 'the Pen chip works now').not.toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, pen)
  await expect(overlay(m1), 'pen mode lays a drawing surface over the preview').toBeVisible()
  await expect(overlay(m1)).toHaveAttribute('data-points', '0')
}

async function tapPoint(m1: M1Session, fx: number, fy: number, expectedPoints: number): Promise<void> {
  await m1.touch.tap(await canvasPoint(m1, fx, fy))
  await expect(overlay(m1)).toHaveAttribute('data-points', String(expectedPoints))
}

async function drawSquare(m1: M1Session): Promise<void> {
  for (const [index, [fx, fy]] of SQUARE.entries()) await tapPoint(m1, fx, fy, index + 1)
  // Tapping the first point closes the path.
  await m1.touch.tap(await canvasPoint(m1, SQUARE[0][0], SQUARE[0][1]))
  await expect(overlay(m1)).toHaveAttribute('data-closed', 'true')
  await expect(overlay(m1)).toHaveAttribute('data-points', '4')
}

const outside = (px: Pixels) => regionMean(px, REGIONS.cornerBottomLeft).luma < BLACK && regionMean(px, REGIONS.topBand).luma < BLACK

test('INV3/mask-pen-path: tapping four points and the first again masks the picture to the drawn square @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  expect(regionMean(before, REGIONS.cornerBottomLeft).luma, 'the corner shows the clip before').toBeGreaterThan(25)
  await startPen(m1, clip.id)
  await drawSquare(m1)
  // Live: the preview above the sheet already shows the masked picture.
  await waitForPixels(m1, outside, 'the live preview did not mask outside the drawn square')
  await tapDone(m1)
  await expect(overlay(m1), 'the drawing surface leaves with the sheet').toHaveCount(0)
  const after = await waitForPixels(m1, outside, 'the pen mask did not clear the picture outside the square')
  expect(frameDifference(before, after, 40, REGIONS.centre), 'inside the square the clip stays as it was').toBeLessThan(SAME)
  const masks = JSON.parse(await clipSnapshot(m1, clip.id)).masks as Array<{ name: string; closed: boolean; vertices: unknown[] }>
  expect(masks.map(mask => [mask.name, mask.closed, mask.vertices.length]), 'one closed editor pen mask with four vertices').toEqual([['Pen Mask', true, 4]])
})

test('INV3/mask-pen-path: Done is one undo step that restores picture and clip @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await startPen(m1, clip.id)
  await drawSquare(m1)
  await waitForPixels(m1, outside, 'the live preview did not mask outside the drawn square')
  await tapDone(m1)
  await waitForPixels(m1, outside, 'the pen mask is not in the picture after Done')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(() => clipSnapshot(m1, clip.id), { message: 'one Undo did not restore the clip state' }).toBe(snapshot)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'one Undo restored the clip state but not the picture')
})

test('INV3/mask-pen-path: Cancel after drawing leaves picture and clip unchanged @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await startPen(m1, clip.id)
  await drawSquare(m1)
  await waitForPixels(m1, outside, 'the live preview did not mask outside the drawn square')
  await tapCancel(m1)
  await waitForPixels(m1, px => frameDifference(before, px) < SAME, 'Cancel did not restore the picture')
  expect(await clipSnapshot(m1, clip.id), 'Cancel leaves the clip exactly as before').toBe(snapshot)
})

test('INV3/mask-pen-path: drag pulls curve handles, Undo point takes the last point back, dragging a point moves it @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await startPen(m1, clip.id)
  await tapPoint(m1, 0.3, 0.3, 1)
  await tapPoint(m1, 0.7, 0.3, 2)
  // Third point: finger down and dragged pulls its handles instead of placing a sharp corner.
  const third = await canvasPoint(m1, 0.5, 0.65)
  await m1.touch.pan(third, { x: 60, y: 0 })
  await expect(overlay(m1)).toHaveAttribute('data-points', '3')
  await expect.poll(async () => (await m6Pen(m1.page)).points[2]?.handleX ?? 0, { message: 'dragging from a new point did not pull its handle' }).toBeGreaterThan(0.05)
  await expect(m1.page.getByTestId(MASK.penHandle), 'the pulled point shows its two handles').toHaveCount(2)

  await tapPoint(m1, 0.2, 0.5, 4)
  await tapOn(m1, m1.page.getByTestId(MASK.penUndo))
  await expect(overlay(m1), 'Undo point removed the last point').toHaveAttribute('data-points', '3')

  // Drag the second point down: it moves, no point is added.
  const second = await canvasPoint(m1, 0.7, 0.3)
  const yBefore = (await m6Pen(m1.page)).points[1].y
  await m1.touch.pan(second, { x: 0, y: 80 })
  await expect(overlay(m1)).toHaveAttribute('data-points', '3')
  await expect.poll(async () => (await m6Pen(m1.page)).points[1].y - yBefore, { message: 'dragging a point did not move it' }).toBeGreaterThan(0.05)

  await tapOn(m1, m1.page.getByTestId(MASK.penClose))
  await expect(overlay(m1)).toHaveAttribute('data-closed', 'true')
  await tapDone(m1)
  const masks = JSON.parse(await clipSnapshot(m1, clip.id)).masks as Array<{ name: string; closed: boolean; vertices: Array<{ handleOut: { x: number }; handleMode: string }> }>
  expect(masks).toHaveLength(1)
  expect(masks[0].vertices[2].handleMode, 'the pulled point is a smooth Bezier point').toBe('mirrored')
  expect(masks[0].vertices[2].handleOut.x).toBeGreaterThan(0.05)
})

test('INV3/mask-pen-path: Done with fewer than three points explains and keeps the sheet open @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await startPen(m1, clip.id)
  await tapPoint(m1, 0.3, 0.3, 1)
  await tapPoint(m1, 0.7, 0.3, 2)
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.sheetDone))
  await expect(m1.page.getByTestId(MASK.penStatus)).toContainText(/at least 3 points/)
  await expect(m1.sheet, 'the sheet stays open').toBeVisible()
  await tapCancel(m1)
  expect(await clipSnapshot(m1, clip.id), 'nothing was written').toBe(snapshot)
})
