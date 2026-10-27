import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import type { PhoneWorkspaceId } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog'
import { expect, ensureEditor, tapOn, waitForIdle, type M1Session } from './m1Fixture'
import type { Point } from './phoneTouch'

/**
 * Helpers of the M4 landscape-editor journeys of packet R4 (multicam, 3D scene, curves), on top of
 * the M1 world (fresh empty 1080x1920 composition per test, real touch through CDP, the bridge only
 * arranges and inspects). The editors are landscape screens: each case turns the emulated phone
 * sideways (viewport swapped) and turns it back afterwards, so later spec files see the portrait
 * phone again.
 */
export { WS }

const portraitSizes = new WeakMap<object, { width: number; height: number }>()

/** Turns the phone sideways (swaps the viewport); remembers the portrait size for `turnPortrait`. */
export async function turnLandscape(m1: M1Session): Promise<void> {
  const size = m1.page.viewportSize()
  if (!size) throw new Error('the phone page has no viewport')
  if (size.width > size.height) return
  portraitSizes.set(m1.page, size)
  await m1.page.setViewportSize({ width: size.height, height: size.width })
  await m1.touch.nextFrame(2)
}

export async function turnPortrait(m1: M1Session): Promise<void> {
  const size = portraitSizes.get(m1.page)
  if (size) await m1.page.setViewportSize(size)
}

/** Back from an open editor, if one is open. */
export async function closeEditorIfOpen(m1: M1Session): Promise<void> {
  const back = m1.page.getByTestId(WS.back)
  if (await back.isVisible()) {
    await tapOn(m1, back)
    await expect(m1.page.getByTestId(WS.root)).toHaveCount(0)
  }
}

/** Root toolbar "Editors" -> the editor's row: the way a person opens a landscape editor. */
export async function openEditor(m1: M1Session, id: PhoneWorkspaceId): Promise<void> {
  if ((await m1.timeline()).selectedIds.length > 0) {
    await m1.bridge.toolData('clearSelection')
    await expect.poll(async () => (await m1.timeline()).selectedIds.length).toBe(0)
  }
  await tapOn(m1, m1.page.getByTestId(phoneActionTestId('editors')))
  await expect(m1.sheet, 'the Editors sheet did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${WS.editorRow}-${id}`))
  await expect(m1.page.getByTestId(WS.root), `the ${id} editor did not open`).toHaveAttribute('data-workspace', id)
  await expect(m1.sheet).toBeHidden()
}

/** The editor bar's own Undo (the person stays in the editor). */
export async function undoInEditor(m1: M1Session): Promise<void> {
  const undo = m1.page.getByTestId(WS.undo)
  await expect(undo, 'Undo is not available after the edit').toBeEnabled()
  await tapOn(m1, undo)
}

/** Reloads /m and comes back into the project's editor shell (bridge re-attached). */
export async function reloadPhone(m1: M1Session): Promise<void> {
  await m1.page.reload({ waitUntil: 'domcontentloaded' })
  await ensureEditor(m1)
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
  await waitForIdle(m1)
}

/**
 * Owner rule: every side panel collapses and expands, and the choice survives a reload.
 * Collapses each given side, reloads, reopens the editor, expects them still collapsed, then
 * expands them again (and expects that to stick as well, so the next case starts open).
 */
export async function proveSidesRemembered(m1: M1Session, id: PhoneWorkspaceId, sides: Array<'left' | 'right'>): Promise<void> {
  const toggle = (side: 'left' | 'right') => m1.page.getByTestId(side === 'left' ? WS.toggleLeft : WS.toggleRight)
  const panel = (side: 'left' | 'right') => m1.page.getByTestId(side === 'left' ? WS.sideLeft : WS.sideRight)
  const main = m1.page.getByTestId(WS.main)
  for (const side of sides) {
    // A choice stored by an earlier run may have left this side collapsed: open it first.
    if (await panel(side).count() === 0) await tapOn(m1, toggle(side))
    await expect(panel(side), `the ${side} panel does not open`).toBeVisible()
  }
  const mainWidthOpen = (await main.boundingBox())?.width ?? 0
  for (const side of sides) {
    await tapOn(m1, toggle(side))
    await expect(panel(side), `the ${side} panel did not collapse`).toHaveCount(0)
    await expect(toggle(side)).toHaveAttribute('aria-pressed', 'false')
  }
  await expect.poll(async () => (await main.boundingBox())?.width ?? 0, { message: 'the canvas did not grow when the sides collapsed' })
    .toBeGreaterThan(mainWidthOpen + 40)

  await reloadPhone(m1)
  await openEditor(m1, id)
  for (const side of sides) {
    await expect(panel(side), `the ${side} panel forgot it was collapsed after a reload`).toHaveCount(0)
    await tapOn(m1, toggle(side))
    await expect(panel(side), `the ${side} panel did not expand again`).toBeVisible()
    await expect(toggle(side)).toHaveAttribute('aria-pressed', 'true')
  }
}

// ---------------------------------------------------------------------------
// Two-finger gestures with free finger paths (phoneTouch.pinch is horizontal only)
// ---------------------------------------------------------------------------

export async function twoFingers(m1: M1Session, from: [Point, Point], to: [Point, Point], { steps = 14, still = 3 } = {}): Promise<void> {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) => m1.cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map((point, id) => ({ ...point, id, radiusX: 1, radiusY: 1, force: 1 })),
  })
  const at = (t: number): Point[] => from.map((start, index) => ({
    x: start.x + (to[index].x - start.x) * t,
    y: start.y + (to[index].y - start.y) * t,
  }))
  await send('touchStart', at(0))
  await m1.touch.nextFrame()
  for (let step = 1; step <= steps; step++) {
    await send('touchMove', at(step / steps))
    await m1.touch.nextFrame()
  }
  for (let index = 0; index < still; index++) {
    await send('touchMove', at(1))
    await m1.touch.nextFrame()
  }
  await send('touchEnd', [])
  await m1.touch.nextFrame(2)
}

/** Centre of an element's box (page coordinates). */
export async function centreOf(locator: import('@playwright/test').Locator): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element is not rendered')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
