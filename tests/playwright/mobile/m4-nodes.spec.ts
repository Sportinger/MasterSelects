import type { Locator, Page } from '@playwright/test'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import type { Point } from './phoneTouch'
import { expect, importViaSheet, tapOn, test, type M1Session } from './m1Fixture'

/**
 * M4 packet R1, the Nodes editor (desktop node-workspace panel inside the landscape frame) by touch:
 * one-finger pan on empty canvas, pinch zoom, tap to select, drag a node, connect two ports by
 * dragging, add a node through the touch Add menu, delete the selection, and Undo/Redo from the
 * frame's bar. One catalog case per test in the M1 phone world (fresh composition per test, one
 * frame-code clip imported through the media sheet). Every action is real touch (CDP); the truth is
 * the timeline store read through the bridge (selection, clip effects) and the canvas' own geometry
 * (card boxes, the zoom and link read-outs), never a fixed sleep.
 */
test.describe.configure({ timeout: 240_000 })

interface NodesView {
  page: Page
  main: Locator
  canvas: Locator
  clipId: string
  restore: () => Promise<void>
}

const node = (main: Locator, suffix: string) => main.locator(`.node-workspace-node[data-node-id${suffix.endsWith('-') ? '*' : '$'}="${suffix}"]`)
const clipCard = (main: Locator) => main.locator('.node-workspace-node[data-node-id^="comp:clip:"]')

async function zoomPercent(main: Locator): Promise<number> {
  return Number((await main.locator('.node-workspace-zoom').innerText()).replace('%', ''))
}

/** Link count in the canvas toolbar ("N nodes / M links"), rendered from the stored graph. */
async function linkCount(main: Locator): Promise<number> {
  return Number(/(\d+) links/.exec(await main.locator('.node-workspace-toolbar-title').innerText())?.[1] ?? Number.NaN)
}

async function centre(target: Locator): Promise<Point> {
  const box = await target.boundingBox()
  if (!box) throw new Error('element is not rendered')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A point inside `target` where it is the topmost element (ports and plugs can overlap at a card's edge). */
async function exposedPoint(target: Locator): Promise<Point> {
  const point = await target.evaluate((element) => {
    const box = element.getBoundingClientRect()
    for (let fy = 0.5; fy < 1; fy += 0.1) for (const sign of [1, -1]) for (let fx = 0.5; fx < 1; fx += 0.1) for (const sx of [1, -1]) {
      const x = box.left + box.width * (0.5 + sx * (fx - 0.5)), y = box.top + box.height * (0.5 + sign * (fy - 0.5))
      const hit = document.elementFromPoint(x, y)
      if (hit && (hit === element || element.contains(hit))) return { x, y }
    }
    return null
  })
  if (!point) throw new Error('the element is covered everywhere')
  return point
}

async function effects(m1: M1Session, clipId: string): Promise<string[]> {
  const details = await m1.bridge.toolData<{ effects: Array<{ type: string }> }>('getClipDetails', { clipId })
  return details.effects.map(effect => effect.type)
}

/** y of the clip graph's transform node in the timeline store (88 for a fresh clip lane). */
async function transformLayoutY(m1: M1Session, clipId: string): Promise<number> {
  return m1.page.evaluate(async (id) => {
    const storeModule = '/src/stores/timeline/index.ts'
    const mod = await import(/* @vite-ignore */ storeModule) as { useTimelineStore: { getState: () => { clips: Array<{ id: string; nodeGraph?: { nodes?: Array<{ id: string; layout: { y: number } }> } }> } } }
    return mod.useTimelineStore.getState().clips.find(clip => clip.id === id)?.nodeGraph?.nodes?.find(item => item.id === 'transform')?.layout.y ?? 88
  }, clipId)
}

/** A point on the canvas with no card, port, plug or group under it (scanned in the real DOM). */
async function emptyPoint(view: NodesView, prefer: 'top-left' | 'bottom-right' = 'bottom-right'): Promise<Point> {
  const point = await view.page.evaluate((order) => {
    const canvas = document.querySelector('[data-testid="phone-workspace-main"] .node-workspace-canvas')!
    const rect = canvas.getBoundingClientRect()
    const xs = Array.from({ length: 9 }, (_, index) => rect.left + rect.width * (0.1 + index * 0.1))
    const ys = Array.from({ length: 9 }, (_, index) => rect.top + rect.height * (0.1 + index * 0.1))
    if (order === 'bottom-right') { xs.reverse(); ys.reverse() }
    for (const y of ys) for (const x of xs) {
      const hit = document.elementFromPoint(x, y)
      if (hit && canvas.contains(hit) && !hit.closest('.node-workspace-node, .node-workspace-port, .node-workspace-plug, .node-workspace-group, .node-workspace-edge-hit, button')) return { x, y }
    }
    return null
  }, prefer)
  if (!point) throw new Error('no empty canvas point found')
  return point
}

/** Imports one clip, opens Nodes from the Editors sheet in landscape and collapses both side panels by touch. */
async function openNodes(m1: M1Session): Promise<NodesView> {
  const { page } = m1
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { total: 1 })
  const clipId = state.all[0].id
  await m1.bridge.toolData('clearSelection')
  await page.evaluate(() => window.localStorage.removeItem('ms.phoneWorkspace.collapsed'))
  const size = page.viewportSize()!
  await page.setViewportSize({ width: Math.max(size.width, size.height), height: Math.min(size.width, size.height) })
  await tapOn(m1, page.getByTestId(phoneActionTestId('editors')))
  await tapOn(m1, page.getByTestId(`${WS.editorRow}-nodes`))
  const root = page.getByTestId(WS.root)
  await expect(root).toHaveAttribute('data-workspace', 'nodes')
  await tapOn(m1, page.getByTestId(WS.toggleLeft))
  await tapOn(m1, page.getByTestId(WS.toggleRight))
  await expect(root).toHaveAttribute('data-left', 'collapsed')
  await expect(root).toHaveAttribute('data-right', 'collapsed')
  const main = page.getByTestId(WS.main)
  const canvas = main.locator('.node-workspace-canvas')
  await expect(canvas).toBeVisible()
  await expect(clipCard(main), 'the composition graph shows no clip node').toHaveCount(1)
  const restore = async () => {
    if (await root.isVisible()) await tapOn(m1, page.getByTestId(WS.back))
    await page.setViewportSize(size)
  }
  return { page, main, canvas, clipId, restore }
}

/** Taps the clip node: selects the clip in the timeline store and opens its lane (source, transform, output). */
async function openClipLane(m1: M1Session, view: NodesView): Promise<void> {
  await tapOn(m1, clipCard(view.main))
  await expect.poll(async () => (await m1.bridge.toolData<{ selectedClipIds: string[] }>('getTimelineState')).selectedClipIds,
    { message: 'tapping the clip node did not select the clip' }).toEqual([view.clipId])
  await expect(node(view.main, '::transform'), 'the clip lane did not open').toHaveCount(1)
}

/** Pinches the canvas open around `around` until the zoom read-out reaches `minPercent`. */
async function zoomInAround(m1: M1Session, view: NodesView, target: Locator, minPercent: number): Promise<void> {
  await settledView(m1, view)
  for (let attempt = 0; attempt < 6 && await zoomPercent(view.main) < minPercent; attempt++) {
    // Both fingers stay inside the canvas: the pinch centre is the target, pulled in from the edges.
    const box = (await view.canvas.boundingBox())!
    const spot = await centre(target)
    const gap = Math.min(150, box.width - 24)
    const x = Math.min(Math.max(spot.x, box.x + gap / 2 + 8), box.x + box.width - gap / 2 - 8)
    const y = Math.min(Math.max(spot.y, box.y + 8), box.y + box.height - 8)
    await m1.touch.pinch({ x, y }, gap / 3, gap)
    await settledView(m1, view)
  }
  expect(await zoomPercent(view.main), 'pinching did not zoom in far enough').toBeGreaterThanOrEqual(minPercent)
}

/** Waits until the canvas camera stopped moving (a lane opening glides the view; a pinch must not race it). */
async function settledView(m1: M1Session, view: NodesView): Promise<void> {
  const read = async () => `${await zoomPercent(view.main)}|${JSON.stringify(await view.canvas.locator('.node-workspace-canvas-inner').first().getAttribute('style'))}`
  let previous = await read(), stable = 0
  for (let frame = 0; frame < 120 && stable < 5; frame++) {
    await m1.touch.nextFrame(2)
    const now = await read()
    stable = now === previous ? stable + 1 : 0
    previous = now
  }
  expect(stable, 'the node canvas view never came to rest').toBeGreaterThanOrEqual(5)
}

/** One-finger pan from empty canvas that moves `target` to the middle of the canvas. */
async function bringToCentre(m1: M1Session, view: NodesView, ...targets: Locator[]): Promise<void> {
  const box = (await view.canvas.boundingBox())!
  const spots = await Promise.all(targets.map(centre))
  const spot = { x: spots.reduce((sum, point) => sum + point.x, 0) / spots.length, y: spots.reduce((sum, point) => sum + point.y, 0) / spots.length }
  const delta = { x: box.x + box.width / 2 - spot.x, y: box.y + box.height / 2 - spot.y }
  if (Math.hypot(delta.x, delta.y) < 8) return
  await m1.touch.pan(await emptyPoint(view, delta.x > 0 ? 'top-left' : 'bottom-right'), delta, { steps: 14 })
  await settledView(m1, view)
}

async function finger(m1: M1Session, type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point): Promise<void> {
  await m1.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 0, radiusX: 1, radiusY: 1, force: 1 }] : [] })
  await m1.touch.nextFrame()
}

async function fingerTo(m1: M1Session, from: Point, to: Point, steps = 10): Promise<void> {
  for (let step = 1; step <= steps; step++) await finger(m1, 'touchMove', { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps })
}

async function addBoxBlur(m1: M1Session, view: NodesView): Promise<void> {
  await tapOn(m1, view.main.getByTestId('node-touch-add'))
  const menu = view.page.locator('.node-workspace-context-menu')
  await expect(menu, 'Add did not open the node menu').toBeVisible()
  await view.page.locator('.node-workspace-context-search').fill('box blur')
  await tapOn(m1, menu.locator('.node-workspace-context-results button', { hasText: 'Box Blur' }).first())
  await expect.poll(() => effects(m1, view.clipId), { message: 'the effect node did not land on the clip' }).toEqual(['box-blur'])
}

/**
 * Adds a Box Blur after the transform, unplugs the cable into it (drag its input plug off) and plugs it
 * back by dragging from the effect's free input port onto the transform's output port. Returns the link
 * read-out before the unplug and the cable id.
 */
async function unplugAndReconnect(m1: M1Session, view: NodesView): Promise<{ before: number; cableId: string; effect: Locator; links: () => Promise<number> }> {
  await openClipLane(m1, view)
  const transform = node(view.main, '::transform')
  await tapOn(m1, transform)
  await addBoxBlur(m1, view)
  const effectId = (await m1.bridge.toolData<{ effects: Array<{ id: string }> }>('getClipDetails', { clipId: view.clipId })).effects[0].id
  // The cable into an effect may be cut (built-in chain cables may not; the editor says so). The link
  // read-out in the toolbar is rendered from the stored graph; the cable id names both ends.
  const cableId = `transform:output->effect-${effectId}:input`
  const links = () => linkCount(view.main)
  const effect = node(view.main, `::effect-${effectId}`)
  await zoomInAround(m1, view, effect, 30)
  await bringToCentre(m1, view, effect, transform)

  // Unplug the image cable into the effect: drag its input plug off into empty canvas.
  await tapOn(m1, effect)
  const plug = view.main.locator(`.node-workspace-plug[data-node-id$="::effect-${effectId}"][data-port-id="input"][data-direction="input"]`).first()
  await expect(plug, 'the effect node shows no image input plug to unplug').toBeVisible()
  const from = await exposedPoint(plug)
  expect(await plug.getAttribute('data-edge-id'), 'the plug is not the transform -> effect cable').toMatch(new RegExp(`::${cableId}$`))
  const before = await links()
  const away = await emptyPoint(view, 'top-left')
  await finger(m1, 'touchStart', from)
  await fingerTo(m1, from, away)
  await finger(m1, 'touchEnd')
  await expect(view.main.locator('.node-workspace-graph-message'), 'the editor refused to unplug the cable').toHaveCount(0)
  await expect.poll(links, { message: 'unplugging the cable did not disconnect it' }).toBe(before - 1)

  // Connect them again by dragging from the effect's free input port onto the transform's output port.
  const start = await exposedPoint(view.main.locator(`.node-workspace-port[data-node-id$="::effect-${effectId}"][data-port-id="input"][data-direction="input"]`).first())
  const transformCard = await centre(transform)
  await finger(m1, 'touchStart', start)
  await fingerTo(m1, start, transformCard)
  const target = view.main.locator('.node-workspace-port[data-node-id$="::transform"][data-port-id="output"][data-direction="output"]').first()
  await expect(target, 'the transform node did not show its ports under the finger').toBeAttached()
  const end = await exposedPoint(target)
  await fingerTo(m1, transformCard, end, 6)
  await finger(m1, 'touchMove', end)
  await expect(target, 'the port under the finger is not offered as a compatible target').toHaveClass(/connectable/)
  await finger(m1, 'touchEnd')
  await expect.poll(links, { message: 'dragging between the ports did not connect them' }).toBe(before)
  return { before, cableId, effect, links }
}

test('one finger pans the empty canvas and two fingers pinch-zoom it', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    const output = node(view.main, 'comp:output')
    const before = await centre(output)
    await m1.touch.pan(await emptyPoint(view), { x: -80, y: -40 })
    await expect.poll(async () => Math.round((await centre(output)).x - before.x), { message: 'the pan did not move the graph' }).toBeLessThan(-60)
    const panned = await centre(output)
    expect(Math.abs(panned.y - before.y + 40), 'the pan moved the graph by a different vertical amount').toBeLessThan(8)

    const zoom = await zoomPercent(view.main)
    const box = (await view.canvas.boundingBox())!
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await m1.touch.pinch(middle, 60, 180)
    await expect.poll(() => zoomPercent(view.main), { message: 'the pinch did not zoom in' }).toBeGreaterThan(zoom * 2)
    const zoomed = await zoomPercent(view.main)
    await m1.touch.pinch(middle, 180, 90)
    await expect.poll(() => zoomPercent(view.main), { message: 'the pinch did not zoom out' }).toBeLessThan(zoomed * 0.7)
  } finally { await view.restore() }
})

test('a tap selects a node; dragging it moves it in the store, Undo and Redo apply', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    await openClipLane(m1, view)
    const transform = node(view.main, '::transform')
    await zoomInAround(m1, view, transform, 40)
    await tapOn(m1, transform)
    await expect(transform, 'the tapped node is not shown as selected').toHaveClass(/selected/)

    const startY = await transformLayoutY(m1, view.clipId)
    await m1.touch.pan(await centre(transform), { x: 0, y: 70 }, { steps: 14 })
    // The move is authored data: the clip's node layout in the timeline store follows the finger.
    await expect.poll(() => transformLayoutY(m1, view.clipId), { message: 'the moved node did not reach the store' }).toBeGreaterThan(startY + 40)
    const movedY = await transformLayoutY(m1, view.clipId)
    await m1.touch.nextFrame(10)
    expect(await transformLayoutY(m1, view.clipId), 'the moved node jumped back').toBe(movedY)
    await tapOn(m1, view.page.getByTestId(WS.undo))
    await expect.poll(() => transformLayoutY(m1, view.clipId), { message: 'Undo did not put the node back in the store' }).toBe(startY)
    await tapOn(m1, view.page.getByTestId(WS.redo))
    await expect.poll(() => transformLayoutY(m1, view.clipId), { message: 'Redo did not move the node again' }).toBe(movedY)
  } finally { await view.restore() }
})

test('Add opens a touch menu whose search adds an effect node; Undo and Redo apply', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    await openClipLane(m1, view)
    const transform = node(view.main, '::transform')
    await tapOn(m1, transform)
    await expect(transform).toHaveClass(/selected/)
    expect(await effects(m1, view.clipId)).toEqual([])

    await tapOn(m1, view.main.getByTestId('node-touch-add'))
    const menu = view.page.locator('.node-workspace-context-menu')
    await expect(menu, 'Add did not open the node menu').toBeVisible()
    // No hover on a phone: the menu stays until a choice or a tap outside (it used to close after 1.5 s).
    await m1.touch.nextFrame(150)
    await expect(menu, 'the add menu closed on its own on a touch screen').toBeVisible()
    await view.page.locator('.node-workspace-context-search').fill('box blur')
    await tapOn(m1, menu.locator('.node-workspace-context-results button', { hasText: 'Box Blur' }).first())
    await expect.poll(() => effects(m1, view.clipId), { message: 'the effect node did not land on the clip' }).toEqual(['box-blur'])
    await expect(node(view.main, '::effect-'), 'the new node is not on the canvas').toHaveCount(1)
    await expect(menu, 'the add menu stayed open after the choice').toBeHidden()
    await tapOn(m1, view.page.getByTestId(WS.undo))
    await expect.poll(() => effects(m1, view.clipId), { message: 'one Undo did not remove the added effect' }).toEqual([])
    await tapOn(m1, view.page.getByTestId(WS.redo))
    await expect.poll(() => effects(m1, view.clipId), { message: 'Redo did not bring the effect back' }).toEqual(['box-blur'])
  } finally { await view.restore() }
})

test('Delete removes the selected node, Undo restores it and Redo deletes it again', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    await openClipLane(m1, view)
    await tapOn(m1, node(view.main, '::transform'))
    await addBoxBlur(m1, view)
    await expect(node(view.main, '::effect-').first(), 'the new effect node is not selected').toHaveClass(/selected/)

    await tapOn(m1, view.main.getByTestId('node-touch-delete'))
    await expect.poll(() => effects(m1, view.clipId), { message: 'Delete did not remove the selected node' }).toEqual([])
    await tapOn(m1, view.page.getByTestId(WS.undo))
    await expect.poll(() => effects(m1, view.clipId), { message: 'Undo did not restore the deleted node' }).toEqual(['box-blur'])
    await tapOn(m1, view.page.getByTestId(WS.redo))
    await expect.poll(() => effects(m1, view.clipId), { message: 'Redo did not delete the node again' }).toEqual([])
  } finally { await view.restore() }
})

test('dragging a plug off disconnects, dragging between two ports connects', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    const { cableId, effect } = await unplugAndReconnect(m1, view)
    await tapOn(m1, effect)
    await expect(view.main.locator(`.node-workspace-plug[data-edge-id$="::${cableId}"]`).first(), 'the new cable is not transform -> effect').toBeAttached()
  } finally { await view.restore() }
})

// Was a product defect (node-edit-needs-extra-undo): the project record dropped an effect's `detached`
// flag, so undoing the reconnect restored a bypassed but still wired effect and the cable stayed. Fixed in
// projectCompositionSerialization (the flag is saved), covered by tests/unit/phoneUndoDefects.test.ts.
test('node-edit-needs-extra-undo: one Undo removes a cable connected in the node editor, Redo puts it back', async ({ m1 }) => {
  const view = await openNodes(m1)
  try {
    const { before, links } = await unplugAndReconnect(m1, view)
    await tapOn(m1, view.page.getByTestId(WS.undo))
    await expect.poll(links, { message: 'one Undo did not remove the new cable' }).toBe(before - 1)
    await tapOn(m1, view.page.getByTestId(WS.undo))
    await expect.poll(links, { message: 'the second Undo did not plug the original cable back' }).toBe(before)
    expect(await effects(m1, view.clipId), 'the second Undo took back more than the unplug').toEqual(['box-blur'])
    await tapOn(m1, view.page.getByTestId(WS.redo))
    await expect.poll(links, { message: 'Redo did not unplug the cable again' }).toBe(before - 1)
  } finally { await view.restore() }
})
