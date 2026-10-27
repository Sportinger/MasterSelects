import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { differingShare, ensureEditor, expect, previewPixels, tapAction, tapClip, tapOn, test, type M1Session } from './m1Fixture'
import { importClipA, stablePixels, waitForSettledHistory } from './m2DesignFixture'
import {
  activeNodes, centreOf, clipJson, clipKeyframeCount, controlsPanel, elementPixels, leaveLandscape, litShare, meanDifference, nodesSide,
  openColourFromEditors, primaryNode, readGrade, resetSidePanels, scopesSide, tapTool, tapUndo, turnToLandscape, wheelPad,
} from './m4ColourFixture'

/**
 * M4 "Querformat-Editoren", packet R3: the landscape Colour editor of the phone skin (wheels,
 * curves, colour nodes, scopes, colour keyframes), one catalog case per test in the M1 phone world
 * (fresh empty composition per test, frame-code clip A imported through the media sheet). Done when
 * the editor is reachable by a button, its side panels collapse/expand and keep that state across a
 * reload, its canvases pan/zoom/select by touch, and a grade made by touch lands in
 * clip.colorCorrection and one Undo restores it. Real touch only; the bridge arranges and inspects.
 */
test.describe.configure({ timeout: 240_000 })

async function arrange(m1: M1Session): Promise<{ clipId: string; portrait: { width: number; height: number } }> {
  const clip = await importClipA(m1)
  await m1.bridge.toolData('clearSelection')
  await resetSidePanels(m1)
  const portrait = await turnToLandscape(m1)
  return { clipId: clip.id, portrait }
}

test('colour editor: reachable from Editors, side panels collapse, expand and survive a reload @phone', async ({ m1 }) => {
  const { portrait } = await arrange(m1)
  try {
    await openColourFromEditors(m1)
    await expect(scopesSide(m1).locator('.scopes-panel')).toBeVisible()
    await expect(nodesSide(m1).locator('.color-shared-node-view')).toBeVisible()
    const mainOpen = (await controlsPanel(m1).boundingBox())!.width

    await tapOn(m1, m1.page.getByTestId(WS.toggleLeft))
    await expect(scopesSide(m1)).toHaveCount(0)
    await expect(m1.page.getByTestId(WS.toggleLeft)).toHaveAttribute('aria-pressed', 'false')
    const mainGrown = (await controlsPanel(m1).boundingBox())!.width
    expect(mainGrown, 'the controls grow when the scopes collapse').toBeGreaterThan(mainOpen + 100)
    await tapOn(m1, m1.page.getByTestId(WS.toggleLeft))
    await expect(scopesSide(m1).locator('.scopes-panel')).toBeVisible()
    await tapOn(m1, m1.page.getByTestId(WS.toggleRight))
    await expect(nodesSide(m1)).toHaveCount(0)

    // Reload: the choice (nodes collapsed, scopes open) comes back when the editor opens again.
    await m1.page.reload({ waitUntil: 'domcontentloaded' })
    await ensureEditor(m1)
    await m1.bridge.waitForTarget({ timeoutMs: 60_000, requireVisible: true })
    await m1.bridge.authenticate()
    await expect(m1.page.getByTestId(WS.root)).toHaveCount(0)
    await m1.bridge.toolData('clearSelection')
    await openColourFromEditors(m1)
    await expect(nodesSide(m1), 'the collapsed nodes panel stays collapsed after a reload').toHaveCount(0)
    await expect(scopesSide(m1).locator('.scopes-panel'), 'the open scopes panel stays open after a reload').toBeVisible()
    await tapOn(m1, m1.page.getByTestId(WS.toggleRight))
    await expect(nodesSide(m1).locator('.color-shared-node-view')).toBeVisible()

    // The phone offers only real tools: no placeholder buttons without an implementation.
    const tools = await controlsPanel(m1).locator('.color-tool-dock-nav [data-color-tool]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-color-tool')))
    expect(tools).toEqual(['primaries', 'exposure', 'curves', 'keyframes'])
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('colour wheels: a touch drag on Gain grades the clip, one Undo restores it @phone', async ({ m1 }) => {
  const { clipId, portrait } = await arrange(m1)
  try {
    await leaveLandscape(m1, portrait)
    const before = await stablePixels(m1)
    await turnToLandscape(m1)
    await openColourFromEditors(m1)
    await expect.poll(async () => primaryNode(await readGrade(m1, clipId))?.id, { message: 'the colour editor did not prepare a grade' }).toBeTruthy()
    await waitForSettledHistory(m1)
    const gradeBefore = primaryNode(await readGrade(m1, clipId))!
    const pad = wheelPad(m1, 'Gain')
    const centre = await centreOf(pad)
    await m1.touch.pan(centre, { x: -70, y: -20 })
    await expect.poll(async () => {
      const node = primaryNode(await readGrade(m1, clipId))!
      return ['gainR', 'gainG', 'gainB'].some(key => node.params[key] !== gradeBefore.params[key])
    }, { message: 'the Gain wheel drag did not change clip.colorCorrection' }).toBe(true)
    const graded = primaryNode(await readGrade(m1, clipId))!
    const red = Number(graded.params.gainR ?? 1), blue = Number(graded.params.gainB ?? 1)
    expect(Math.abs(red - blue), 'the wheel tints the gain (channels differ)').toBeGreaterThan(0.01)

    await leaveLandscape(m1, portrait)
    await expect.poll(async () => differingShare(before, await previewPixels(m1.probe), 12), { message: 'the grade is visible in the preview' }).toBeGreaterThan(0.05)
    await waitForSettledHistory(m1)
    await tapUndo(m1)
    await expect.poll(async () => {
      const node = primaryNode(await readGrade(m1, clipId))
      return ['gainR', 'gainG', 'gainB'].every(key => node?.params[key] === gradeBefore.params[key])
    }, { message: 'one Undo did not restore the gain' }).toBe(true)
    await expect.poll(async () => differingShare(before, await previewPixels(m1.probe), 12), { message: 'Undo returns the preview to the ungraded picture' }).toBeLessThan(0.01)
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('colour curves: a finger drags a curve point, one Undo restores the curve @phone', async ({ m1 }) => {
  const { clipId, portrait } = await arrange(m1)
  try {
    await openColourFromEditors(m1)
    await tapOn(m1, m1.page.getByTestId(WS.toggleLeft))
    await tapOn(m1, m1.page.getByTestId(WS.toggleRight))
    await tapTool(m1, 'curves')
    const panel = controlsPanel(m1).locator('.color-curves-panel')
    await expect(panel).toBeVisible()
    await tapOn(m1, panel.getByRole('button', { name: 'R', exact: true }))
    await expect(panel).toHaveAttribute('data-channel', 'r')
    await tapOn(m1, panel.getByTitle('Add curve point'))
    await expect(panel.locator('circle.curve-editor-keyframe')).toHaveCount(3)
    await waitForSettledHistory(m1)
    const curveBefore = String(primaryNode(await readGrade(m1, clipId))?.params.curveR ?? '')
    const points = await panel.locator('circle.curve-editor-keyframe').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }))
    const middle = points.toSorted((a, b) => a.x - b.x)[1]
    // Land a little off the point: the finger radius picks it up.
    await m1.touch.pan({ x: middle.x + 8, y: middle.y + 6 }, { x: 0, y: -60 })
    await expect.poll(async () => String(primaryNode(await readGrade(m1, clipId))?.params.curveR ?? ''), { message: 'the touch drag did not move the curve point' }).not.toBe(curveBefore)
    await expect(panel.locator('.color-curves-readout output').nth(1)).not.toHaveText('—')

    await leaveLandscape(m1, portrait)
    await waitForSettledHistory(m1)
    await tapUndo(m1)
    await expect.poll(async () => String(primaryNode(await readGrade(m1, clipId))?.params.curveR ?? ''), { message: 'one Undo did not restore the curve' }).toBe(curveBefore)
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('colour nodes: add, select and bypass by touch; the graph pans and pinch-zooms @phone', async ({ m1 }) => {
  const { clipId, portrait } = await arrange(m1)
  try {
    await openColourFromEditors(m1)
    await tapOn(m1, m1.page.getByTestId(WS.toggleLeft))
    const side = nodesSide(m1)
    await expect(side.locator('.node-workspace-node').first()).toBeVisible({ timeout: 20_000 })
    const countBefore = activeNodes(await readGrade(m1, clipId)).length

    // Add a Color Wheels node through the picker.
    await tapOn(m1, side.getByRole('combobox', { name: 'Add color node' }))
    await tapOn(m1, m1.page.getByRole('option', { name: 'Color Wheels' }))
    await expect.poll(async () => activeNodes(await readGrade(m1, clipId)).length, { message: 'the picker did not add a node' }).toBe(countBefore + 1)
    const wheels = activeNodes(await readGrade(m1, clipId)).find(node => node.type === 'wheels')!
    await expect.poll(async () => (await readGrade(m1, clipId))?.ui.selectedNodeId).toBe(wheels.id)

    // Tap the Primaries card: it becomes the selected grade node.
    const primary = primaryNode(await readGrade(m1, clipId))!
    const primaryCard = side.locator('.node-workspace-node[aria-label^="Primar"], .node-workspace-node:has-text("Primaries")').first()
    await expect(primaryCard).toBeVisible()
    const cardBox = (await primaryCard.boundingBox())!
    await m1.touch.tap({ x: cardBox.x + cardBox.width / 2, y: cardBox.y + Math.min(14, cardBox.height / 4) })
    await expect.poll(async () => (await readGrade(m1, clipId))?.ui.selectedNodeId, { message: 'tapping the card did not select it' }).toBe(primary.id)

    // Bypass by tap, then Undo after leaving.
    await tapOn(m1, primaryCard.getByRole('button', { name: /^Bypass/ }))
    await expect.poll(async () => primaryNode(await readGrade(m1, clipId))?.enabled, { message: 'bypass did not switch the node off' }).toBe(false)

    // Pan: one finger on empty canvas moves the cards; pinch: the zoom readout grows. Both only move
    // the view: the clip (grade and graph layout) stays exactly as it was.
    const clipBeforeView = await clipJson(m1, clipId)
    const canvas = side.locator('.node-workspace-canvas')
    const canvasBox = (await canvas.boundingBox())!
    const cardBefore = (await primaryCard.boundingBox())!
    const empty = { x: canvasBox.x + canvasBox.width * 0.5, y: canvasBox.y + canvasBox.height - 24 }
    await m1.touch.pan(empty, { x: -40, y: -30 })
    await expect.poll(async () => (await primaryCard.boundingBox())!.x, { message: 'one-finger pan did not move the graph' }).toBeLessThan(cardBefore.x - 20)
    const zoomText = side.locator('.node-workspace-zoom')
    const zoomBefore = parseInt(await zoomText.innerText(), 10)
    // Fingers on empty canvas below the cards (a finger on a card would start a card drag instead).
    await m1.touch.pinch({ x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height - 30 }, 60, 160)
    await expect.poll(async () => parseInt(await zoomText.innerText(), 10), { message: 'pinch did not zoom the colour graph' }).toBeGreaterThan(zoomBefore * 1.4)

    expect(await clipJson(m1, clipId), 'pan and pinch change only the view, not the clip').toBe(clipBeforeView)

    await leaveLandscape(m1, portrait)
    await waitForSettledHistory(m1)
    await tapUndo(m1)
    await expect.poll(async () => primaryNode(await readGrade(m1, clipId))?.enabled, { message: 'one Undo did not end the bypass' }).toBe(true)
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('colour scopes: the side panel shows the picture and switches waveform, histogram and vectorscope @phone', async ({ m1 }) => {
  const { portrait } = await arrange(m1)
  try {
    await openColourFromEditors(m1)
    const scopes = scopesSide(m1).locator('.scopes-panel')
    await expect(scopes).toHaveAttribute('data-scope-mode', 'parade')
    const content = scopes.locator('.scopes-panel-content')
    const pick = async (label: string, mode: string) => {
      await tapOn(m1, scopes.getByRole('button', { name: 'Scope type' }))
      await tapOn(m1, scopes.getByRole('menuitemradio', { name: label }))
      await expect(scopes).toHaveAttribute('data-scope-mode', mode)
    }
    const shots: Record<string, Awaited<ReturnType<typeof elementPixels>>> = {}
    for (const [label, mode] of [['Waveform', 'waveform'], ['Histogram', 'histogram'], ['Vectorscope', 'vectorscope']] as const) {
      await pick(label, mode)
      await expect.poll(async () => litShare(await elementPixels(content.locator('canvas').first())), { message: `the ${label} scope draws no trace of the clip` }).toBeGreaterThan(0.004)
      shots[mode] = await elementPixels(content)
    }
    expect(meanDifference(shots.waveform, shots.histogram), 'waveform and histogram look different').toBeGreaterThan(4)
    expect(meanDifference(shots.histogram, shots.vectorscope), 'histogram and vectorscope look different').toBeGreaterThan(4)
    // Channel switch (waveform): Y only draws less colour than RGB.
    await pick('Waveform', 'waveform')
    await tapOn(m1, scopes.getByRole('button', { name: 'Y', exact: true }))
    await expect(scopes.getByRole('button', { name: 'Y', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('colour keyframes: the Gain stopwatch keys the wheel and the keyframes view lists it @phone', async ({ m1 }) => {
  const { clipId, portrait } = await arrange(m1)
  try {
    await openColourFromEditors(m1)
    await tapOn(m1, m1.page.getByTestId(WS.toggleLeft))
    await tapOn(m1, m1.page.getByTestId(WS.toggleRight))
    await waitForSettledHistory(m1)
    expect(await clipKeyframeCount(m1, clipId)).toBe(0)
    const gain = controlsPanel(m1).locator('.resolve-color-wheel').filter({ has: m1.page.locator('header strong', { hasText: 'Gain' }) })
    await tapOn(m1, gain.getByTitle('Add Gain keyframes'))
    await expect.poll(() => clipKeyframeCount(m1, clipId), { message: 'the stopwatch set no colour keyframes' }).toBe(4)
    await tapTool(m1, 'keyframes')
    const view = controlsPanel(m1).locator('.color-keyframes-panel')
    await expect(view).toBeVisible()
    await expect(view.locator('.color-keyframes-row.node b').first()).toBeVisible()
    await tapTool(m1, 'primaries')
    await expect(view).toHaveCount(0)
    await leaveLandscape(m1, portrait)
    await waitForSettledHistory(m1)
    await tapUndo(m1)
    await expect.poll(() => clipKeyframeCount(m1, clipId), { message: 'one Undo did not remove the keys' }).toBe(0)
  } finally {
    await leaveLandscape(m1, portrait)
  }
})

test('Adjust -> Wheels opens the Colour editor on the selected clip @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await resetSidePanels(m1)
  await tapClip(m1, clip.id)
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([clip.id])
  await tapAction(m1, phoneActionTestId('adjust'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.page.getByTestId(FX.adjustWheels)).toContainText('Colour editor')
  const portrait = await turnToLandscape(m1)
  try {
    await tapOn(m1, m1.page.getByTestId(FX.adjustWheels))
    await expect(m1.page.getByTestId(WS.root)).toHaveAttribute('data-workspace', 'color')
    await expect(m1.sheet).toBeHidden()
    await expect(controlsPanel(m1).locator('.color-workspace-surface-header')).toContainText(clip.name)
  } finally {
    await leaveLandscape(m1, portrait)
  }
})
