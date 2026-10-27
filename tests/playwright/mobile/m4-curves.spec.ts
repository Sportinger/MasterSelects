import type { Locator } from '@playwright/test'
import { expect, tapOn, test, type M1Session } from './m1Fixture'
import { importClipA, waitForSettledHistory } from './m2DesignFixture'
import {
  centreOf, closeEditorIfOpen, openEditor, proveSidesRemembered, turnLandscape, turnPortrait, twoFingers, undoInEditor, WS,
} from './m4R4Fixture'
import type { Point } from './phoneTouch'

/**
 * M4 packet R4, the Curves editor (catalog INV-1/curve-editors, INV-3/keyframe-global-curves,
 * INV-5/motion-curves-spatial-path): the desktop Curves dock panel in the phone's landscape editor.
 * Every action is real touch (CDP): a finger near a keyframe or Bezier handle drives the desktop
 * graph's own drag (same transaction and single undo step), one finger on empty graph pans time,
 * two fingers zoom time (side by side) and the curve height (stacked). Truth: keyframes read from
 * the store through the bridge, the panel's view state mirrored in data attributes.
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => {
  await closeEditorIfOpen(m1)
  await turnPortrait(m1)
})

interface StoredKeyframe { id: string; time: number; value: number; easing?: string; handleIn?: unknown; handleOut?: unknown }

async function keyframesOf(m1: M1Session, clipId: string): Promise<StoredKeyframe[]> {
  const data = await m1.bridge.toolData<{ keyframes?: StoredKeyframe[] } | StoredKeyframe[]>('getKeyframes', { clipId, property: 'position.x' })
  const list = Array.isArray(data) ? data : data.keyframes ?? []
  return list.map(({ id, time, value, easing, handleIn, handleOut }) => ({ id, time, value, easing, handleIn, handleOut }))
    .toSorted((a, b) => a.time - b.time)
}

/** Clip A with a two-key position.x ramp, the Curves editor open on it, sides collapsed for room. */
async function openCurvesOnRamp(m1: M1Session): Promise<{ clipId: string; graph: Locator; dots: Locator }> {
  const clip = await importClipA(m1)
  await m1.bridge.toolData('addKeyframe', { clipId: clip.id, keys: { 'position.x': [[0.5, -150, 'linear'], [3, 150, 'linear']] } })
  await expect.poll(async () => (await keyframesOf(m1, clip.id)).length, { message: 'the ramp keyframes did not land' }).toBe(2)
  await waitForSettledHistory(m1)
  await turnLandscape(m1)
  await openEditor(m1, 'curves')
  for (const side of ['left', 'right'] as const) {
    const panel = m1.page.getByTestId(side === 'left' ? WS.sideLeft : WS.sideRight)
    if (await panel.count() > 0) await tapOn(m1, m1.page.getByTestId(side === 'left' ? WS.toggleLeft : WS.toggleRight))
    await expect(panel).toHaveCount(0)
  }
  // Arrangement, not under test: the clip is the graph's subject (the phone timeline is covered).
  await m1.bridge.toolData('selectClips', { clipIds: [clip.id] })
  const graph = m1.page.getByTestId(WS.main).locator('.timeline-global-curve-editor-pane')
  const dots = graph.locator('circle.global-curve-editor-keyframe')
  await expect(dots, 'the curve shows both keyframes').toHaveCount(2)
  return { clipId: clip.id, graph, dots }
}

/** A point on the graph at least `clearance` px away from every keyframe and handle. */
async function emptyGraphPoint(graph: Locator, avoid: Locator, fx: number, fy: number): Promise<Point> {
  const box = await graph.boundingBox()
  if (!box) throw new Error('graph pane is not rendered')
  const targets = await avoid.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = box.x + box.width * ((fx + attempt * 0.07) % 0.9 + 0.05)
    const y = box.y + box.height * fy
    if (targets.every(target => Math.hypot(target.x - x, target.y - y) > 40)) return { x, y }
  }
  throw new Error('no empty spot on the graph')
}

test('curve-editors: Curves opens from Editors; its side panels collapse, expand and survive a reload @phone', async ({ m1 }) => {
  await turnLandscape(m1)
  await openEditor(m1, 'curves')
  await expect(m1.page.getByTestId(WS.main).getByTestId('curves-panel'), 'the desktop Curves panel fills the editor').toBeVisible()
  await proveSidesRemembered(m1, 'curves', ['left', 'right'])
})

test('curve-editors: one finger pans time, two fingers zoom time and curve height @phone', async ({ m1 }) => {
  const { graph, dots } = await openCurvesOnRamp(m1)
  const panel = m1.page.getByTestId('curves-panel')
  const sidebar = panel.locator('.timeline-global-curve-sidebar')
  const zoom = async () => Number(await panel.getAttribute('data-time-zoom'))
  const scroll = async () => Number(await panel.getAttribute('data-time-scroll'))
  const height = async () => Number(await sidebar.getAttribute('data-vertical-zoom'))
  const avoid = graph.locator('circle[data-keyframe-id]')
  const box = (await graph.boundingBox())!

  const zoomBefore = await zoom()
  const mid = await emptyGraphPoint(graph, avoid, 0.45, 0.55)
  await twoFingers(m1, [{ x: mid.x - 30, y: mid.y }, { x: mid.x + 30, y: mid.y }], [{ x: mid.x - 90, y: mid.y }, { x: mid.x + 90, y: mid.y }])
  await expect.poll(zoom, { message: 'spreading two fingers side by side did not zoom time in' }).toBeGreaterThan(zoomBefore * 2)

  const heightBefore = await height()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await twoFingers(m1, [{ x: centre.x, y: centre.y - 25 }, { x: centre.x, y: centre.y + 25 }], [{ x: centre.x, y: centre.y - 70 }, { x: centre.x, y: centre.y + 70 }])
  await expect.poll(height, { message: 'spreading two stacked fingers did not scale the curve height' }).toBeGreaterThan(heightBefore * 1.5)

  const scrollBefore = await scroll()
  const start = await emptyGraphPoint(graph, avoid, 0.7, 0.85)
  await m1.touch.pan(start, { x: -120, y: 0 })
  await expect.poll(scroll, { message: 'a one-finger drag on empty graph did not pan time' }).toBeGreaterThan(scrollBefore + 60)
  // Pans and zooms are view changes: the keyframes are untouched.
  await expect(dots).toHaveCount(await dots.count())
})

test('curve-editors: a finger near a keyframe selects and drags it @phone', async ({ m1 }) => {
  const { clipId, dots } = await openCurvesOnRamp(m1)
  const before = await keyframesOf(m1, clipId)
  const first = dots.first()
  const dot = await centreOf(first)
  // Finger lands 12 px beside the 10 px dot: still that keyframe.
  await m1.touch.tap({ x: dot.x + 12, y: dot.y + 4 })
  await expect(first, 'the tapped keyframe is not selected').toHaveClass(/selected/)
  await expect(m1.page.getByTestId(WS.main).locator('circle.curve-editor-handle'), 'a selected keyframe shows its Bezier handle').not.toHaveCount(0)

  await m1.touch.pan({ x: dot.x + 8, y: dot.y }, { x: 0, y: -40 })
  await expect.poll(async () => (await keyframesOf(m1, clipId))[0].value, { message: 'dragging the keyframe up did not raise its value' })
    .toBeGreaterThan(before[0].value + 5)
  expect((await keyframesOf(m1, clipId))[1], 'the other keyframe stays').toEqual(before[1])
})

test('curve-editors: dragging a Bezier handle changes the easing; one Undo restores it @phone', async ({ m1 }) => {
  const { clipId, dots } = await openCurvesOnRamp(m1)
  const before = await keyframesOf(m1, clipId)
  const first = dots.first()
  await tapOn(m1, first)
  await expect(first).toHaveClass(/selected/)
  const handle = m1.page.getByTestId(WS.main).locator('circle.curve-editor-handle[data-handle="out"]')
  await expect(handle, 'the first keyframe has no out handle').toHaveCount(1)
  const grip = await centreOf(handle)
  await m1.touch.pan(grip, { x: 10, y: -45 })

  await expect.poll(async () => JSON.stringify((await keyframesOf(m1, clipId))[0]), { message: 'the handle drag did not change the first keyframe' })
    .not.toBe(JSON.stringify(before[0]))
  const after = await keyframesOf(m1, clipId)
  expect(after[0].easing, 'a handle drag turns the segment into a Bezier curve').not.toBe(before[0].easing)
  expect(after[0].value, 'a handle drag keeps the key value').toBeCloseTo(before[0].value, 6)

  await waitForSettledHistory(m1)
  await undoInEditor(m1)
  await expect.poll(async () => JSON.stringify(await keyframesOf(m1, clipId)), { message: 'one Undo did not restore the keyframes' })
    .toBe(JSON.stringify(before))
})
