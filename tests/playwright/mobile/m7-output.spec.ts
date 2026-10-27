import { IDS, expect, importViaSheet, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { closeEditorIfOpen, reloadPhone, turnPortrait, twoFingers, WS } from './m4R4Fixture'
import {
  OUT, FULL_FRAME, addItem, addTarget, boxPoint, cards, cornerField, dragHandle, expectOutput, freshOutputEditor, handle, importQuadrants,
  itemAction, items, openOutputEditor, savedMapping, selectTab, typeCorners,
} from './m7OutputFixture'

/**
 * Packet G5, the Output Manager on the phone: the 'output' landscape editor (Editors -> Output) with
 * the output targets on the left, the live output of the selected target in the middle and its slice
 * and mask stack on the right. One catalog case per test in the M1 phone world (fresh composition per
 * case, a four-colour calibration image imported through the media sheet). Every action is real touch
 * (CDP) or typing into the editor's own fields; the truth is the output preview's real pixels (the
 * engine draws the target with its slices and masks) and the saved mapping in browser storage.
 */
test.describe.configure({ timeout: 240_000 })

test.afterEach(async ({ m1 }) => {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  if (await notice.isVisible()) await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await closeEditorIfOpen(m1)
  await turnPortrait(m1)
})

/**
 * Calibration image in the composition and one saved output (added, Done, reopened) showing it full
 * frame: the state every Cancel in a case must come back to.
 */
async function stageWithOneOutput(m1: M1Session): Promise<string> {
  await importQuadrants(m1)
  await freshOutputEditor(m1)
  const id = await addTarget(m1)
  await tapOn(m1, m1.page.getByTestId(OUT.done))
  await expect(m1.page.getByTestId(WS.root)).toHaveCount(0)
  await openOutputEditor(m1)
  await expect(cards(m1.page).first()).toHaveAttribute('data-target-id', id)
  await expectOutput(m1, FULL_FRAME, 'a new output without slices shows the full composition')
  return id
}

test('INV-7/output-target-management: add, rename, switch, remove outputs; greyed external display explains itself @phone', async ({ m1 }) => {
  const { page } = m1
  await importQuadrants(m1)
  await freshOutputEditor(m1)
  const first = await addTarget(m1)
  const second = await addTarget(m1)
  expect(first).not.toBe(second)

  // Rename the selected (second) output by typing into its card.
  const name = page.getByTestId(OUT.targetName)
  await tapOn(m1, name)
  await name.fill('Stage left')
  await name.press('Enter')
  await expect(cards(page).last().locator('.phone-output__card-title')).toHaveText('Stage left')

  // Switch it on and off.
  const enabled = page.getByTestId(OUT.targetEnabled)
  await expect(enabled).toHaveAttribute('aria-pressed', 'false')
  await tapOn(m1, enabled)
  await expect(enabled).toHaveAttribute('aria-pressed', 'true')

  // Opening on a second display is greyed, visible, and says why and where it works.
  await tapOn(m1, page.getByTestId(OUT.targetExternal))
  const notice = page.getByTestId(IDS.unavailableNotice)
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('phone browser cannot open')
  await expect(notice).toContainText('full editor')
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()

  // Remove the first output; Done saves the remaining one with its name.
  await tapOn(m1, cards(page).first().locator('.phone-output__card-head'))
  await tapOn(m1, page.getByTestId(OUT.targetRemove))
  await expect(cards(page)).toHaveCount(1)
  await tapOn(m1, page.getByTestId(OUT.done))
  await expect(page.getByTestId(WS.root)).toHaveCount(0)
  expect((await savedMapping(m1)).targets.map(target => [target.id, target.name])).toEqual([[second, 'Stage left']])

  // Reopened, the card is there again, and the output shows the composition.
  await openOutputEditor(m1)
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toHaveAttribute('data-target-id', second)
  await expectOutput(m1, FULL_FRAME, 'the reopened output does not show the composition')
})

/**
 * Pinch x2 beside corner handle `corner` (TR here): the fingers start 28 px apart diagonally inward of
 * the corner and spread while moving further inward, so the corner ends up 20 px inside the stage.
 * (pinchView keeps the content under the starting midpoint under the current midpoint.)
 */
async function zoomTowardsCorner(m1: M1Session, corner: number): Promise<void> {
  const box = await handle(m1.page, corner).boundingBox()
  if (!box) throw new Error('corner handle is not rendered')
  const h = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const at = (dx: number, dy: number) => ({ x: h.x + dx, y: h.y + dy })
  await twoFingers(m1, [at(-40, 40), at(-20, 20)], [at(-100, 100), at(-60, 60)])
}

/** A composition that holds the orange image, and the case composition (active) with the quadrants. */
async function twoCompositions(m1: M1Session): Promise<{ orangeId: string; quadId: string }> {
  await importViaSheet(m1, { visual: [m1.media.image] }, { total: 1 })
  const orangeId = (await m1.timeline()).activeCompositionId!
  await m1.bridge.toolData('createComposition', { name: `Quad ${Date.now() % 100000}`, width: 1080, height: 1920, frameRate: 30, duration: 60 })
  await expect.poll(async () => (await m1.timeline()).activeCompositionId).not.toBe(orangeId)
  await expect.poll(async () => (await m1.timeline()).all.length).toBe(0)
  await importQuadrants(m1)
  const quadId = (await m1.timeline()).activeCompositionId!
  return { orangeId, quadId }
}

async function routeTo(m1: M1Session, value: string): Promise<void> {
  const select = m1.page.getByTestId(OUT.targetSource)
  await tapOn(m1, select)
  await select.selectOption(value)
  await expect(select).toHaveValue(value)
}

test('INV-1/render-target-management: two outputs show their own source without switching the edited composition @phone', async ({ m1 }) => {
  const { page } = m1
  const { orangeId, quadId } = await twoCompositions(m1)
  await freshOutputEditor(m1)
  const active = await addTarget(m1)
  await expectOutput(m1, FULL_FRAME, 'output 1 (active composition) does not show the quadrants')
  const fixed = await addTarget(m1)
  await routeTo(m1, `comp:${orangeId}`)
  await expectOutput(m1, [[0.3, 0.3, 'orange'], [0.7, 0.7, 'orange']], 'output 2 does not show the composition pinned to it')

  // Switching between the two cards switches the preview, not the edited composition.
  await tapOn(m1, page.locator(`[data-testid="${OUT.targetCard}"][data-target-id="${active}"] .phone-output__card-head`))
  await expectOutput(m1, FULL_FRAME, 'selecting output 1 again does not show the active composition')
  await tapOn(m1, page.locator(`[data-testid="${OUT.targetCard}"][data-target-id="${fixed}"] .phone-output__card-head`))
  await expectOutput(m1, [[0.5, 0.5, 'orange']], 'output 2 lost its pinned composition')
  expect((await m1.timeline()).activeCompositionId, 'routing changed the composition being edited').toBe(quadId)
})

test('INV-7/output-source-routing: a pinned composition does not follow the active tab; back to Active follows it @phone', async ({ m1 }) => {
  const { orangeId, quadId } = await twoCompositions(m1)
  await freshOutputEditor(m1)
  await addTarget(m1)
  await routeTo(m1, `comp:${quadId}`)
  await expectOutput(m1, FULL_FRAME, 'the output pinned to the quadrant composition does not show it')

  // The person switches the edited composition: the pinned output keeps its composition.
  await m1.bridge.toolData('openComposition', { compositionId: orangeId })
  await expect.poll(async () => (await m1.timeline()).activeCompositionId).toBe(orangeId)
  await expectOutput(m1, FULL_FRAME, 'the pinned output followed the active composition')

  // Routed to the active composition, it follows the switch.
  await routeTo(m1, 'active')
  await expectOutput(m1, [[0.3, 0.3, 'orange'], [0.7, 0.7, 'orange']], 'the output routed to the active composition does not follow it')
  await tapOn(m1, m1.page.getByTestId(OUT.done))
  expect((await savedMapping(m1)).targets[0].source.type).toBe('activeComp')
  await m1.bridge.toolData('openComposition', { compositionId: quadId })
})

test('INV-7/output-slice-stack: overlapping slices by touch; reorder, switch off, delete; Cancel restores @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  // Slice A: the whole frame. Slice B: the blue quadrant shown in the middle of the output, on top.
  await addItem(m1, 'slice')
  await addItem(m1, 'slice')
  await selectTab(m1, 'input')
  await typeCorners(m1, { 0: [50, 50], 1: [100, 50], 2: [100, 100], 3: [50, 100] })
  await selectTab(m1, 'output')
  await typeCorners(m1, { 0: [25, 25], 1: [75, 25], 2: [75, 75], 3: [25, 75] })
  const onTop = [[0.4, 0.4, 'blue'], [0.1, 0.1, 'red'], [0.9, 0.9, 'blue']] as Array<[number, number, 'blue' | 'red']>
  await expectOutput(m1, onTop, 'slice B (later in the stack) is not drawn on top of slice A')

  // Move B up: A now covers it.
  await itemAction(m1, 1, OUT.itemUp)
  await expect(items(page).first()).toHaveAttribute('data-selected', 'true')
  await expectOutput(m1, [[0.4, 0.4, 'red'], [0.6, 0.6, 'blue']], 'after moving B under A, A does not cover it')
  // Move it back down and switch it off: A shows through.
  await itemAction(m1, 0, OUT.itemDown)
  await expectOutput(m1, onTop, 'moving B down again did not put it on top')
  await itemAction(m1, 1, OUT.itemEnabled)
  await expect(items(page).nth(1).getByTestId(OUT.itemEnabled)).toHaveAttribute('aria-pressed', 'false')
  await expectOutput(m1, [[0.4, 0.4, 'red']], 'switching B off did not reveal A')
  await itemAction(m1, 1, OUT.itemEnabled)
  // Delete A: only B is left, the rest of the output is black.
  await itemAction(m1, 0, OUT.itemDelete)
  await expect(items(page)).toHaveCount(1)
  await expectOutput(m1, [[0.4, 0.4, 'blue'], [0.1, 0.1, 'black'], [0.9, 0.9, 'black']], 'deleting A did not leave only B')

  // Cancel restores the output as it was before the editor opened (no slices yet: full frame).
  await tapOn(m1, page.getByTestId(OUT.cancel))
  await expect(page.getByTestId(WS.root)).toHaveCount(0)
  await openOutputEditor(m1)
  await expect(cards(page)).toHaveCount(1)
  await expect(items(page)).toHaveCount(0)
  await expectOutput(m1, FULL_FRAME, 'Cancel did not restore the output without slices')
})

test('INV-1/slice-management: rename, reorder and switch off slices; Done and a reload keep it, Cancel does not @phone', async ({ m1 }) => {
  const { page } = m1
  const target = await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  const name = page.getByTestId(OUT.itemName)
  await tapOn(m1, name)
  await name.fill('Backdrop')
  await name.press('Enter')
  await expect(items(page).first().locator('.phone-output__card-title')).toHaveText('Backdrop')
  await addItem(m1, 'slice')
  await selectTab(m1, 'output')
  await typeCorners(m1, { 0: [0, 0], 1: [50, 0], 2: [50, 100], 3: [0, 100] })
  await expectOutput(m1, [[0.15, 0.3, 'red'], [0.35, 0.3, 'green'], [0.75, 0.3, 'green']], 'the squeezed slice B is not on top of the left half')
  await itemAction(m1, 1, OUT.itemUp)
  await expectOutput(m1, [[0.15, 0.3, 'red'], [0.35, 0.3, 'red'], [0.75, 0.3, 'green']], 'after reordering, Backdrop does not cover B')
  await tapOn(m1, page.getByTestId(OUT.done))
  expect((await savedMapping(m1)).configs[target].slices.map(slice => slice.name)[1]).toBe('Backdrop')

  await reloadPhone(m1)
  await openOutputEditor(m1)
  await expect(items(page)).toHaveCount(2)
  await expect(items(page).nth(1).locator('.phone-output__card-title')).toHaveText('Backdrop')
  await itemAction(m1, 1, OUT.itemEnabled)
  await expectOutput(m1, [[0.15, 0.3, 'red'], [0.35, 0.3, 'green'], [0.75, 0.3, 'black']], 'switching Backdrop off does not leave only the squeezed slice')
  await tapOn(m1, page.getByTestId(OUT.cancel))
  expect((await savedMapping(m1)).configs[target].slices.every(slice => slice.enabled), 'Cancel kept the switched-off slice').toBe(true)
})

test('INV-7/slice-input-region: pick a source region with handles while zoomed, typed values, and Match output shape @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  await selectTab(m1, 'input')
  // Zoom in x2 with two fingers next to the top-right corner, so that corner stays in view.
  await zoomTowardsCorner(m1, 1)
  await expect.poll(async () => Number(await page.getByTestId(OUT.zoomLabel).getAttribute('data-zoom'))).toBeCloseTo(2, 1)
  // Zoomed, drag the top-right corner to the middle of the top edge.
  await dragHandle(m1, 1, 0.5, 0, { x: -10, y: 10 })
  await expect.poll(async () => Number(await cornerField(page, 1, 'x').inputValue()), { message: 'the dragged corner did not land in the middle' }).toBeCloseTo(50, -0.5)
  // Typed: exact values for both right corners (left half of the source).
  await typeCorners(m1, { 1: [50, 0], 2: [50, 100] })
  await tapOn(m1, page.getByTestId(OUT.fit))
  await expect(page.getByTestId(OUT.zoomLabel)).toHaveAttribute('data-zoom', '1.000')
  // The Input tab shows the untouched source with the region on it; the Output tab shows the result.
  await expectOutput(m1, FULL_FRAME, 'the Input tab does not show the whole source under the region')
  await selectTab(m1, 'output')
  await expectOutput(m1, [[0.25, 0.3, 'red'], [0.75, 0.3, 'red'], [0.25, 0.7, 'yellow'], [0.75, 0.7, 'yellow']],
    'the left half of the source does not fill the output')
  // Match output shape (Input tab): the source region becomes the output shape (full frame) again.
  await selectTab(m1, 'input')
  await tapOn(m1, page.getByTestId(OUT.itemMatch))
  await expect(cornerField(page, 1, 'x')).toHaveValue('100')
  await selectTab(m1, 'output')
  await expectOutput(m1, FULL_FRAME, 'Match output shape did not take the full frame as source again')
})

test('INV-1/slice-input-output-warp: a source quarter onto a trapezoid, Match input shape, Reset, Cancel @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  await selectTab(m1, 'input')
  await typeCorners(m1, { 1: [50, 0], 2: [50, 50], 3: [0, 50] })
  await selectTab(m1, 'output')
  await typeCorners(m1, { 0: [25, 0], 1: [75, 0] })
  await expectOutput(m1, [[0.5, 0.5, 'red'], [0.05, 0.1, 'black'], [0.95, 0.1, 'black'], [0.9, 0.9, 'red']],
    'the red quarter is not warped onto the trapezoid')
  await tapOn(m1, page.getByTestId(OUT.itemMatch))
  await expectOutput(m1, [[0.25, 0.25, 'red'], [0.75, 0.75, 'black'], [0.75, 0.25, 'black']], 'Match input shape did not map the quarter onto itself')
  await tapOn(m1, page.getByTestId(OUT.itemReset))
  await expectOutput(m1, FULL_FRAME, 'Reset did not return to the untouched full frame')
  await tapOn(m1, page.getByTestId(OUT.cancel))
  await openOutputEditor(m1)
  await expect(items(page)).toHaveCount(0)
})

test('INV-7/slice-corner-pin: drag the four output corners by touch; Cancel restores the picture @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  await selectTab(m1, 'output')
  await expect(handle(page, 0)).toBeVisible()
  // Pull the left corners to the middle: the picture is pinned onto the right half.
  await dragHandle(m1, 0, 0.5, 0, { x: 10, y: 10 })
  await dragHandle(m1, 3, 0.5, 1, { x: 10, y: -10 })
  await expect.poll(async () => Number(await cornerField(page, 0, 'x').inputValue())).toBeCloseTo(50, -0.5)
  await expect.poll(async () => Number(await cornerField(page, 3, 'x').inputValue())).toBeCloseTo(50, -0.5)
  await typeCorners(m1, { 0: [50, 0], 3: [50, 100] })
  await expectOutput(m1, [[0.25, 0.5, 'black'], [0.6, 0.3, 'red'], [0.9, 0.3, 'green'], [0.9, 0.7, 'blue'], [0.6, 0.7, 'yellow']],
    'the corner-pinned picture is not on the right half')
  await tapOn(m1, page.getByTestId(OUT.cancel))
  await openOutputEditor(m1)
  await expectOutput(m1, FULL_FRAME, 'Cancel did not restore the untouched picture')
})

test('INV-7/output-blackout-masks: a mask blacks out inside or outside, in stack order; off and Reset @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  await addItem(m1, 'mask')
  // New masks black out their inside (the middle half of the output).
  await expect(items(page).nth(1).getByTestId(OUT.itemInvert)).toHaveAttribute('aria-pressed', 'true')
  await expectOutput(m1, [[0.4, 0.4, 'black'], [0.1, 0.1, 'red'], [0.9, 0.9, 'blue']], 'the mask does not black out its inside')
  await itemAction(m1, 1, OUT.itemInvert)
  await expectOutput(m1, [[0.4, 0.4, 'red'], [0.1, 0.1, 'black'], [0.9, 0.9, 'black']], 'the inverted mask does not black out its outside')
  // Under the slice in the stack, the mask is covered by the picture.
  await itemAction(m1, 1, OUT.itemUp)
  await expectOutput(m1, [[0.1, 0.1, 'red'], [0.9, 0.9, 'blue']], 'a mask below the slice still blacks out the picture')
  await itemAction(m1, 0, OUT.itemDown)
  await expectOutput(m1, [[0.1, 0.1, 'black']], 'the mask on top again does not black out')
  await itemAction(m1, 1, OUT.itemEnabled)
  await expectOutput(m1, [[0.1, 0.1, 'red'], [0.4, 0.4, 'red']], 'the switched-off mask still blacks out')
  await tapOn(m1, page.getByTestId(OUT.done))
  const saved = (await savedMapping(m1)).configs
  const masks = Object.values(saved).flatMap(config => config.slices).filter(slice => slice.type === 'mask')
  expect(masks.map(mask => [mask.enabled, mask.inverted])).toEqual([[false, false]])
})

test('INV-1/output-masks: mask and inverted mask give exact black and kept pixels; drag a mask corner; Cancel restores @phone', async ({ m1 }) => {
  const { page } = m1
  await stageWithOneOutput(m1)
  await addItem(m1, 'slice')
  await addItem(m1, 'mask')
  await selectTab(m1, 'output')
  // Drag the mask's bottom-right corner out to the bottom-right of the output: the black area grows.
  await dragHandle(m1, 2, 0.95, 0.95)
  await expectOutput(m1, [[0.85, 0.85, 'black'], [0.1, 0.1, 'red'], [0.9, 0.1, 'green']], 'the dragged mask corner did not grow the black area')
  await itemAction(m1, 1, OUT.itemInvert)
  await expectOutput(m1, [[0.85, 0.85, 'blue'], [0.1, 0.1, 'black'], [0.4, 0.4, 'red']], 'the inverted mask does not keep its inside')
  await tapOn(m1, page.getByTestId(OUT.cancel))
  await openOutputEditor(m1)
  await expectOutput(m1, FULL_FRAME, 'Cancel did not restore the output without the mask')
})

test('INV-7/output-manager-navigation-and-save: pinch, two-finger pan, Fit; Done survives a reload, Cancel discards @phone', async ({ m1 }) => {
  const { page } = m1
  const target = await stageWithOneOutput(m1)
  const viewport = page.getByTestId(OUT.viewport)
  const zoom = async () => Number(await page.getByTestId(OUT.zoomLabel).getAttribute('data-zoom'))
  const centre = await boxPoint(page, 0.5, 0.5)
  await twoFingers(m1, [{ x: centre.x - 20, y: centre.y }, { x: centre.x + 20, y: centre.y }], [{ x: centre.x - 60, y: centre.y }, { x: centre.x + 60, y: centre.y }])
  await expect.poll(zoom, { message: 'spreading two fingers did not zoom in' }).toBeGreaterThan(2.5)
  const before = await boxPoint(page, 0.5, 0.5)
  await twoFingers(m1, [{ x: centre.x - 30, y: centre.y }, { x: centre.x + 30, y: centre.y }], [{ x: centre.x - 70, y: centre.y + 20 }, { x: centre.x - 10, y: centre.y + 20 }])
  await expect.poll(async () => (await boxPoint(page, 0.5, 0.5)).x, { message: 'two fingers moving together did not pan' }).toBeLessThan(before.x - 25)
  await tapOn(m1, page.getByTestId(OUT.fit))
  await expect(page.getByTestId(OUT.zoomLabel)).toHaveAttribute('data-zoom', '1.000')
  await expect(viewport).toHaveAttribute('style', /translate\(0px, 0px\) scale\(1\)/)

  // A mapping (mask in the middle), saved with Done, survives a reload.
  await addItem(m1, 'slice')
  await addItem(m1, 'mask')
  await expectOutput(m1, [[0.4, 0.4, 'black'], [0.1, 0.1, 'red']], 'the mask is not applied')
  await tapOn(m1, page.getByTestId(OUT.done))
  await reloadPhone(m1)
  await openOutputEditor(m1)
  await expect(cards(page).first()).toHaveAttribute('data-target-id', target)
  await expect(items(page)).toHaveCount(2)
  await expectOutput(m1, [[0.4, 0.4, 'black'], [0.1, 0.1, 'red']], 'the reloaded mapping does not give the same output')

  // A change left with Cancel (and with Back) is discarded.
  await itemAction(m1, 1, OUT.itemDelete)
  await expectOutput(m1, FULL_FRAME, 'deleting the mask did not clear the black area')
  await tapOn(m1, page.getByTestId(OUT.cancel))
  await openOutputEditor(m1)
  await expect(items(page)).toHaveCount(2)
  await itemAction(m1, 1, OUT.itemDelete)
  await tapOn(m1, page.getByTestId(WS.back))
  await expect(page.getByTestId(WS.root)).toHaveCount(0)
  await openOutputEditor(m1)
  await expect(items(page), 'Back kept a change that was never confirmed with Done').toHaveCount(2)
  await expectOutput(m1, [[0.4, 0.4, 'black']], 'the discarded change still shows')
  await waitForIdle(m1)
})
