import { PHONE_COMPOSITIONS_TEST_IDS as COMP } from '../../../src/components/mobileSkin/compositions/phoneCompositionsTestIds'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { PHONE_CLIPBOARD_TEST_IDS as CB } from '../../../src/components/mobileSkin/clipboard/phoneClipboardTestIds'
import { PHONE_TEXT_MULTI_TEST_IDS as TM } from '../../../src/components/mobileSkin/text/phoneTextMultiTestIds'
import {
  PHONE_TRANSITION_TEST_IDS as TR, phoneTransitionCategoryTestId, phoneTransitionChoiceTestId,
} from '../../../src/components/mobileSkin/transition/phoneTransitionTestIds'
import { IDS, expect, importViaSheet, previewPixels, seek, signatureOf, tapAction, tapClip, tapOn, test, type M1Session } from './m1Fixture'
import { leaveWorkspace } from './m3TimelineFixture'
import {
  differenceBox, differing, effectsOf, importAB, openClipTool, pixelsWhen, tapCancel, tapDone, tapUndo,
} from './m7ClipboardFixture'
import { stablePixels } from './m2DesignFixture'

/**
 * G2 looks, titles and transition compositions on the phone, one catalog case per test:
 * INV-2/custom-look-stacks, INV-5/text-multiselect-style, INV-2/transition-compositions and
 * INV-1/transition-composition-editing. Real touch for every action under test; the bridge
 * arranges and inspects. Pixels are the truth where the picture changes.
 */
test.describe.configure({ timeout: 180_000 })
test.afterEach(async ({ m1 }) => { await leaveWorkspace(m1) })

interface TransitionInfo { id: string; type: string; duration: number; compositionId?: string }
const transitionOut = async (m1: M1Session, clipId: string) =>
  (await m1.bridge.toolData<{ transitionOut?: TransitionInfo }>('getClipDetails', { clipId })).transitionOut ?? null
const cutButton = (m1: M1Session, clipAId: string) => m1.page.locator(`[data-testid="${TR.cutButton}"][data-clip-a="${clipAId}"]`)

async function addCrossfadeByTouch(m1: M1Session, clipAId: string): Promise<void> {
  await tapOn(m1, cutButton(m1, clipAId))
  await expect(m1.sheet, 'the transition sheet did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(phoneTransitionCategoryTestId('dissolve')))
  await tapOn(m1, m1.page.getByTestId(phoneTransitionChoiceTestId('crossfade')))
  await expect(m1.page.getByTestId(phoneTransitionChoiceTestId('crossfade'))).toHaveAttribute('aria-pressed', 'true')
}

test('INV-2/custom-look-stacks: Save as look stores the stack, Filters → Saved applies it to another clip and deletes it @phone', async ({ m1 }, testInfo) => {
  const [a, b] = (await importAB(m1)).main
  await m1.bridge.toolData('addEffect', { clipId: a.id, effectType: 'invert' })
  const name = `G2 look ${testInfo.project.name} ${Date.now() % 100000}`

  await openClipTool(m1, a.id, 'effects')
  await m1.sheet.getByTestId(FX.effectsSaveLookName).fill(name)
  await tapOn(m1, m1.sheet.getByTestId(FX.effectsSaveLook))
  await expect(m1.page.getByTestId(IDS.toast)).toContainText('Filters → Saved')
  await tapCancel(m1)

  await seek(m1, b.start + 0.5)
  const bBefore = await stablePixels(m1)
  await openClipTool(m1, b.id, 'filters')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.filtersCategory}"][data-group="custom"]`))
  const card = m1.sheet.locator(`[data-testid="${FX.filtersCard}"]`, { hasText: name })
  await expect(card, 'the saved look is listed under Saved').toHaveCount(1)
  await tapOn(m1, card)
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)
  expect((await effectsOf(m1, b.id)).map(effect => effect.type), 'the look put its stack on B').toEqual(['invert'])
  await pixelsWhen(m1, px => differing(bBefore, px) > 0.3, 'B shows the saved look')
  await tapUndo(m1)
  await expect.poll(() => effectsOf(m1, b.id), { message: 'one Undo took the look off B' }).toEqual([])

  // Delete it again: the card disappears from Saved.
  await openClipTool(m1, b.id, 'filters')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.filtersCategory}"][data-group="custom"]`))
  const lookId = await card.getAttribute('data-look-id')
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.filtersDeleteLook}"][data-look-id="${lookId}"]`))
  await expect(card, 'the deleted look left Saved').toHaveCount(0)
  await tapCancel(m1)
})

test('INV-5/text-multiselect-style: three titles grow by the same step and turn bold together; one Undo restores @phone', async ({ m1 }) => {
  await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  const sizes = [80, 120, 160]
  const ids: string[] = []
  for (const [index, size] of sizes.entries()) {
    // After A (0..4 s), one second each, so they never collide with the picture on a shared track.
    const created = await m1.bridge.toolData<{ clipId: string }>('createTextClip', {
      text: `T${index + 1}`, startTime: 4 + index, duration: 1, fontSize: size,
    })
    ids.push(created.clipId)
  }
  const sizeOf = async (id: string) => (await m1.bridge.toolData<{ textProperties: { fontSize: number; fontWeight: number } }>('getTextProperties', { clipId: id })).textProperties
  expect(await Promise.all(ids.map(async id => (await sizeOf(id)).fontSize))).toEqual(sizes)
  await seek(m1, 4.5)
  // The selection outline is drawn on the preview: compare pictures with nothing selected.
  await m1.bridge.toolData('clearSelection')
  const before = await stablePixels(m1)
  const signature = signatureOf((await m1.timeline()).all)

  await tapClip(m1, ids[0])
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([ids[0]])
  await tapAction(m1, phoneActionTestId('style-titles'))
  await expect(m1.sheet.getByTestId(TM.status)).toContainText('1 title picked')
  for (const id of ids.slice(1)) {
    const row = m1.sheet.locator(`[data-testid="${CB.pickRow}"][data-clip-id="${id}"]`)
    await tapOn(m1, row)
    await expect(row).toHaveAttribute('aria-checked', 'true')
  }
  await expect(m1.sheet.getByTestId(TM.status)).toContainText('3 titles picked')
  for (let step = 0; step < 5; step++) await tapOn(m1, m1.sheet.getByTestId(TM.sizeUp))
  await expect(m1.sheet.getByTestId(TM.sizeDelta)).toHaveText('+20 px')
  await tapOn(m1, m1.sheet.getByTestId(TM.bold))
  await expect.poll(async () => (await sizeOf(ids[2])).fontSize, { message: 'the change is not live' }).toBe(180)
  await tapDone(m1)

  expect(await Promise.all(ids.map(async id => (await sizeOf(id)).fontSize)), 'each title grew by the same step').toEqual([100, 140, 180])
  for (const id of ids) expect((await sizeOf(id)).fontWeight, 'bold applied to every picked title').toBeGreaterThanOrEqual(600)
  expect(signatureOf((await m1.timeline()).all), 'styling never moves clips').toEqual(signature)
  await m1.bridge.toolData('clearSelection')
  await pixelsWhen(m1, px => differing(before, px) > 0.0003, 'the bigger, bold title renders (glyph area grows)')
  await tapUndo(m1)
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => Promise.all(ids.map(async id => (await sizeOf(id)).fontSize)), { message: 'one Undo did not restore every size' }).toEqual(sizes)
  await expect.poll(async () => { const px = await previewPixels(m1.probe); return `${differing(before, px) < 0.0002} ${differenceBox(before, px)}` }, { message: 'after Undo the titles look as before', timeout: 20_000 }).toMatch(/^true/)
})

test('INV-2/transition-compositions: Edit transition content enters its composition; the crumb leads back and the cut is unchanged @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  const parentId = (await m1.timeline()).activeCompositionId
  await addCrossfadeByTouch(m1, a.id)
  await tapOn(m1, m1.sheet.getByTestId(TR.content))
  await expect(m1.sheet, 'the sheet closed for the content').toBeHidden()
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'the transition composition did not open', timeout: 20_000 }).not.toBe(parentId)
  const childId = (await m1.timeline()).activeCompositionId
  await expect(m1.page.getByTestId(COMP.topBarBack), 'the back crumb leads to the parent').toBeVisible()
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'the content shows the two clips of the cut' }).toBeGreaterThanOrEqual(2)

  await tapOn(m1, m1.page.getByTestId(COMP.topBarBack))
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'the crumb did not return to the parent' }).toBe(parentId)
  const transition = await transitionOut(m1, a.id)
  expect(transition, 'the cut keeps its crossfade').toMatchObject({ type: 'crossfade', duration: 1, compositionId: childId })
  expect((await m1.timeline()).main.map(clip => [clip.id, clip.start]), 'opening moved no clip').toEqual([[a.id, a.start], [b.id, b.start]])
})

test('INV-1/transition-composition-editing: Edit in Nodes opens the content landscape; an edit inside shows at the parent cut @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  const parentId = (await m1.timeline()).activeCompositionId
  await addCrossfadeByTouch(m1, a.id)
  await tapDone(m1)
  await seek(m1, b.start)
  const atCut = await stablePixels(m1)

  await tapOn(m1, cutButton(m1, a.id))
  await expect(m1.sheet).toBeVisible()
  await tapOn(m1, m1.sheet.getByTestId(TR.contentNodes))
  await expect(m1.page.getByTestId('phone-workspace'), 'the node editor opened').toHaveAttribute('data-workspace', 'nodes')
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'the content composition is active' }).not.toBe(parentId)
  await leaveWorkspace(m1)

  // Edit inside: Invert on every layer of the content, by touch through the Effects sheet.
  const layers = (await m1.timeline()).all.filter(clip => clip.trackType === 'video')
  expect(layers.length, 'the content has layers to edit').toBeGreaterThanOrEqual(1)
  for (const layer of layers) {
    await openClipTool(m1, layer.id, 'effects')
    await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="invert"]`))
    await expect.poll(async () => (await effectsOf(m1, layer.id)).map(effect => effect.type)).toContain('invert')
    await tapDone(m1)
  }
  await tapOn(m1, m1.page.getByTestId(COMP.topBarBack))
  await expect.poll(async () => (await m1.timeline()).activeCompositionId).toBe(parentId)
  await seek(m1, b.start)
  await pixelsWhen(m1, px => differing(atCut, px) > 0.3, 'the parent cut shows the inverted content', 30_000)
})
