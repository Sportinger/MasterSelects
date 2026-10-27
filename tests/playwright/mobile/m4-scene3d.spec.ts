import type { Locator } from '@playwright/test'
import sharp from 'sharp'
import { expect, tapOn, test, type M1Session } from './m1Fixture'
import { importClipA, waitForSettledHistory } from './m2DesignFixture'
import { centreOf, closeEditorIfOpen, openEditor, proveSidesRemembered, turnLandscape, turnPortrait, twoFingers, undoInEditor, WS } from './m4R4Fixture'
import type { Point } from './phoneTouch'

/**
 * M4 packet R4, the 3D scene editor (catalog INV-5/three-d-object-gizmos, INV-5/scene-camera-navigation,
 * INV-5/temporary-edit-camera, INV-3/transform-3d-layer): the desktop Preview as a 3D edit view
 * (the same edit camera as the desktop 3D workspace previews) with the Layers panel beside it.
 * Real touch (CDP) only; the bridge makes the clip a 3D plane (arrangement) and reads its transform.
 * Truth: the clip transform in the store, the selection in the store, and the preview's real pixels
 * for camera moves (the edit camera is a view, not a project edit).
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => {
  await closeEditorIfOpen(m1)
  await turnPortrait(m1)
})

interface Transform3D { position?: Record<string, number>; rotation?: Record<string, number> | number; scale?: Record<string, number> }

async function transformOf(m1: M1Session, clipId: string): Promise<string> {
  const details = await m1.bridge.toolData<{ transform?: Transform3D; clip?: { transform?: Transform3D } }>('getClipDetails', { clipId })
  const transform = details.transform ?? details.clip?.transform ?? {}
  return JSON.stringify({ position: transform.position, rotation: transform.rotation, scale: transform.scale })
}

async function regionPixels(region: Locator): Promise<{ width: number; height: number; data: Buffer }> {
  const png = await region.screenshot({ animations: 'allow', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

function changedShare(a: { width: number; height: number; data: Buffer }, b: { width: number; height: number; data: Buffer }): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let offset = 0; offset < a.data.length; offset += 3) {
    if (Math.max(Math.abs(a.data[offset] - b.data[offset]), Math.abs(a.data[offset + 1] - b.data[offset + 1]), Math.abs(a.data[offset + 2] - b.data[offset + 2])) > 30) changed++
  }
  return changed / (a.data.length / 3)
}

/** Clip A as a 3D plane, nothing selected, the 3D scene editor open in landscape. */
async function openScene(m1: M1Session): Promise<{ clipId: string; preview: Locator; handle: Locator }> {
  const clip = await importClipA(m1)
  await m1.bridge.toolData('setTransform', { clipId: clip.id, is3D: true })
  await waitForSettledHistory(m1)
  await turnLandscape(m1)
  await openEditor(m1, 'scene3d')
  const preview = m1.page.getByTestId(WS.main).getByRole('region', { name: 'Preview' })
  await expect(preview, 'the scene editor opens the preview as a 3D edit view').toHaveAttribute('data-preview-edit-mode', 'true')
  const handle = preview.locator('.preview-scene-object-handle').first()
  await expect(handle, 'the 3D plane has no scene handle').toBeVisible({ timeout: 20_000 })
  return { clipId: clip.id, preview, handle }
}

/** A point inside the preview canvas that is far from every scene handle and gizmo. */
async function emptyScenePoint(preview: Locator, fx: number, fy: number): Promise<Point> {
  const canvas = preview.locator('canvas').first()
  const box = (await canvas.boundingBox()) ?? (await preview.boundingBox())
  if (!box) throw new Error('preview is not rendered')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

async function stableRegion(m1: M1Session, region: Locator): Promise<{ width: number; height: number; data: Buffer }> {
  let previous = await regionPixels(region)
  for (let attempt = 0; attempt < 30; attempt++) {
    await m1.touch.nextFrame(3)
    const current = await regionPixels(region)
    if (changedShare(previous, current) < 0.001) return current
    previous = current
  }
  throw new Error('the preview kept changing')
}

test('three-d-object-gizmos: the 3D scene opens from Editors; Layers and Properties collapse, expand and survive a reload @phone', async ({ m1 }) => {
  await turnLandscape(m1)
  await openEditor(m1, 'scene3d')
  await expect(m1.page.getByTestId(WS.main).getByRole('region', { name: 'Preview' })).toBeVisible()
  await proveSidesRemembered(m1, 'scene3d', ['left', 'right'])
})

test('three-d-object-gizmos: tapping the plane or its layer selects it @phone', async ({ m1 }) => {
  const { clipId, handle } = await openScene(m1)
  await tapOn(m1, handle)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'tapping the scene handle did not select the clip' }).toEqual([clipId])
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([])
  const row = m1.page.getByTestId(WS.sideLeft).locator('.layers-row').first()
  await expect(row, 'the Layers panel lists the plane').toBeVisible()
  await tapOn(m1, row)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'tapping the layer did not select the clip' }).toEqual([clipId])
})

test('three-d-object-gizmos: a finger on the move gizmo moves the plane; one Undo restores it @phone', async ({ m1 }) => {
  const { clipId, preview, handle } = await openScene(m1)
  await tapOn(m1, handle)
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([clipId])
  const axis = preview.locator('.preview-scene-gizmo-axis.axis-x')
  await expect(axis, 'the selected plane shows no move gizmo').toBeVisible()
  const before = await transformOf(m1, clipId)
  // The arrow's shaft: on a short landscape phone the arrow tip can sit under the preview's control bar.
  const shaft = await centreOf(axis.locator('.preview-scene-gizmo-axis-line'))
  await m1.touch.pan(shaft, { x: 50, y: 0 })
  await expect.poll(() => transformOf(m1, clipId), { message: 'dragging the X arrow did not move the plane' }).not.toBe(before)
  const moved = JSON.parse(await transformOf(m1, clipId)) as Transform3D
  expect(moved.position?.x, 'the X arrow moves along X').not.toBe((JSON.parse(before) as Transform3D).position?.x)

  await waitForSettledHistory(m1)
  await undoInEditor(m1)
  await expect.poll(() => transformOf(m1, clipId), { message: 'one Undo did not restore the plane' }).toBe(before)
})

test('three-d-object-gizmos: rotate and scale gizmos work by touch @phone', async ({ m1 }) => {
  const { clipId, preview, handle } = await openScene(m1)
  await tapOn(m1, handle)
  const toolbar = m1.page.getByTestId(WS.main).locator('.preview-scene-gizmo-toolbar')
  await expect(toolbar).toBeVisible()

  await tapOn(m1, toolbar.getByRole('button', { name: 'Rotate' }))
  const ring = preview.locator('.preview-scene-gizmo-rotate-ring').first()
  await expect(ring, 'no rotate ring').toBeVisible()
  const beforeRotate = await transformOf(m1, clipId)
  // A point exactly on the ring's hit path (the rings are tilted ellipses, their box corners are off the ring).
  const onRing = await ring.locator('.preview-scene-gizmo-rotate-hit').evaluate((node) => {
    const path = node as SVGPathElement
    const local = path.getPointAtLength(path.getTotalLength() * 0.1)
    const matrix = path.getScreenCTM()!
    return { x: local.x * matrix.a + local.y * matrix.c + matrix.e, y: local.x * matrix.b + local.y * matrix.d + matrix.f }
  })
  await m1.touch.pan(onRing, { x: 40, y: 30 })
  await expect.poll(() => transformOf(m1, clipId), { message: 'dragging a rotate ring did not rotate the plane' }).not.toBe(beforeRotate)

  await tapOn(m1, toolbar.getByRole('button', { name: 'Scale' }))
  const scaleAxis = preview.locator('.preview-scene-gizmo-axis.axis-y')
  await expect(scaleAxis).toBeVisible()
  const beforeScale = await transformOf(m1, clipId)
  await m1.touch.pan(await centreOf(scaleAxis.locator('.preview-scene-gizmo-axis-line')), { x: 0, y: -40 })
  await expect.poll(() => transformOf(m1, clipId), { message: 'dragging a scale arrow did not scale the plane' }).not.toBe(beforeScale)
})

test('scene-camera-navigation: one finger orbits, two fingers zoom and pan the edit camera @phone', async ({ m1 }) => {
  const { clipId, preview } = await openScene(m1)
  const before = await transformOf(m1, clipId)
  const canvas = preview.locator('canvas').first()

  let reference = await stableRegion(m1, canvas)
  await m1.touch.pan(await emptyScenePoint(preview, 0.12, 0.2), { x: 80, y: 0 })
  let after = await stableRegion(m1, canvas)
  expect(changedShare(reference, after), 'a one-finger drag did not orbit the scene').toBeGreaterThan(0.02)

  reference = after
  const centre = await emptyScenePoint(preview, 0.5, 0.5)
  await twoFingers(m1, [{ x: centre.x - 40, y: centre.y - 30 }, { x: centre.x + 40, y: centre.y - 30 }], [{ x: centre.x + 20, y: centre.y + 40 }, { x: centre.x + 100, y: centre.y + 40 }])
  after = await stableRegion(m1, canvas)
  expect(changedShare(reference, after), 'a two-finger drag did not pan the scene camera').toBeGreaterThan(0.02)

  reference = after
  await twoFingers(m1, [{ x: centre.x - 30, y: centre.y }, { x: centre.x + 30, y: centre.y }], [{ x: centre.x - 90, y: centre.y }, { x: centre.x + 90, y: centre.y }])
  after = await stableRegion(m1, canvas)
  expect(changedShare(reference, after), 'a pinch did not zoom the scene camera').toBeGreaterThan(0.02)

  // The edit camera is a view: the plane itself is untouched.
  expect(await transformOf(m1, clipId)).toBe(before)
})
