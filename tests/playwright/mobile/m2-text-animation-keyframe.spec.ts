import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_ANIMATION_TEST_IDS, phoneAnimationPresetTestId } from '../../../src/components/mobileSkin/animation/phoneAnimationTestIds'
import { PHONE_KEYFRAME_TEST_IDS as KF } from '../../../src/components/mobileSkin/keyframe/phoneKeyframeTestIds'
import { PHONE_TEXT_TEST_IDS as TX } from '../../../src/components/mobileSkin/text/phoneTextTestIds'
import { differingShare, expect, M1_IDS, previewPixels, seek, settled, tapAction, tapClip, tapOn, test, type M1Session } from './m1Fixture'
import {
  differenceCentroidX, differenceMask, differingOutside, importA, keySignature, openTextTab, openTitleSheet, pixelsWhen,
  previewCode, readKeyframes, rednessOver, tab, tapCancel, tapDone, tapSliderAt, tapUndo, textClips,
} from './m2TextAnimationFixture'

/**
 * M2 "Gestalten", packet P4: text style, animation presets and keyframes on the phone (PLAN.md
 * section 5). One catalog case per test, in the M1 phone world (fresh empty composition per test,
 * clips through the media sheet, every action under test a real touch). The truth is the preview's
 * real pixels (frame codes and counted title colours on the black frame-code clips); the bridge
 * only arranges (playhead, selection reset) and inspects (keyframes). Every sheet proves
 * (a) Done changes the picture as expected, (b) one Undo returns exactly to the picture before,
 * (c) Cancel leaves pixels and timeline unchanged.
 */
test.describe.configure({ timeout: 180_000 })

const SAME = 0.0005

async function expectSamePicture(m1: M1Session, before: Awaited<ReturnType<typeof previewPixels>>, message: string) {
  await expect.poll(async () => differingShare(before, await previewPixels(m1.probe)), { message, timeout: 15_000 }).toBeLessThan(SAME)
}

test('text-fill-outline-shadow: colour, outline and shadow render; Cancel and Undo restore the picture @phone', async ({ m1 }) => {
  const { page } = m1
  await importA(m1, 1)
  const background = await previewPixels(m1.probe)

  // Reference: the same title in the default white style (created and undone again) gives the glyph mask.
  await openTitleSheet(m1, 'STYLE STYLE')
  await tapDone(m1)
  const white = await pixelsWhen(m1, image => differingShare(background, image) > 0.002, 'the reference title is not visible')
  const glyphs = differenceMask(background, white)
  await tapUndo(m1)
  await expectSamePicture(m1, background, 'Undo of the reference title left pixels behind')

  // Cancel: a styled draft shows live but never reaches the project. The preview is smaller while the
  // sheet is open, so the live check compares two live pictures: the white draft and the red one.
  await openTitleSheet(m1, 'STYLE STYLE')
  await expect.poll(async () => (await textClips(m1)).length, { message: 'the draft title is not previewed' }).toBe(1)
  await openTextTab(m1, 'color')
  const liveWhite = await previewPixels(m1.probe)
  await tapOn(m1, page.getByTestId(`${TX.color}-f0444a`))
  await pixelsWhen(m1, image => {
    const changed = differenceMask(liveWhite, image)
    return changed.size > 20 && rednessOver(image, changed) > rednessOver(liveWhite, changed) + 60
  }, 'the live preview does not turn the draft title red')
  await tapCancel(m1)
  expect(await textClips(m1), 'Cancel left a text clip').toHaveLength(0)
  await expectSamePicture(m1, background, 'Cancel changed the preview')

  // Done: fill red, outline yellow and wide, shadow blue, all in one sheet session.
  await openTitleSheet(m1, 'STYLE STYLE')
  await openTextTab(m1, 'color')
  await tapOn(m1, page.getByTestId(`${TX.color}-f0444a`))
  await openTextTab(m1, 'outline')
  await tapOn(m1, page.getByTestId(`${TX.strokeColor}-f5d33a`))
  await expect(page.getByTestId(TX.strokeToggle), 'picking an outline colour turns the outline on').toHaveAttribute('aria-checked', 'true')
  await tapSliderAt(m1, page.getByTestId(TX.strokeWidth), 0.4)
  await expect.poll(async () => Number.parseFloat(await page.getByTestId(`${TX.strokeWidth}-value`).innerText()), { message: 'the outline width slider did not move' }).toBeGreaterThan(10)
  await openTextTab(m1, 'shadow')
  await tapOn(m1, page.getByTestId(`${TX.shadowColor}-3a8bff`))
  await expect(page.getByTestId(TX.shadowToggle)).toHaveAttribute('aria-checked', 'true')
  await tapSliderAt(m1, page.getByTestId(TX.shadowX), 0.85)
  await tapDone(m1)
  expect(await textClips(m1), 'Done added one title').toHaveLength(1)
  const outlineOnly = await pixelsWhen(m1, image => differingOutside(white, image, glyphs) > 0.004,
    'the outline and shadow do not reach around the glyphs')
  // The wide outline covers most of the old glyph area too; the fill shows red where the glyphs are widest.
  expect(differingShare(white, outlineOnly), 'the committed title looks like the white default').toBeGreaterThan(0.004)

  // One Undo: the whole sheet session (title + style) is one step.
  await tapUndo(m1)
  await expect.poll(async () => (await textClips(m1)).length, { message: 'one Undo did not remove the styled title' }).toBe(0)
  await expectSamePicture(m1, background, 'Undo did not restore the picture before the sheet')
})

test('text-typography: bold and left alignment change the rendered title; Undo restores @phone', async ({ m1 }) => {
  await importA(m1, 1)
  const background = await previewPixels(m1.probe)

  // Reference: the same title in the default style (created and undone again).
  await openTitleSheet(m1, 'Typography')
  await tapDone(m1)
  const plain = await pixelsWhen(m1, image => differingShare(background, image) > 0.002, 'the plain reference title is not visible')
  const plainCentre = differenceCentroidX(background, plain)
  const plainGlyphs = differenceMask(background, plain).size
  await tapUndo(m1)
  await expectSamePicture(m1, background, 'Undo of the reference title left pixels behind')

  // Cancel: bold + left in the draft, nothing committed.
  await openTitleSheet(m1, 'Typography')
  await openTextTab(m1, 'font')
  await tapOn(m1, m1.page.getByTestId(TX.bold))
  await expect(m1.page.getByTestId(TX.bold)).toHaveAttribute('aria-pressed', 'true')
  await tapCancel(m1)
  expect(await textClips(m1)).toHaveLength(0)
  await expectSamePicture(m1, background, 'Cancel changed the preview')

  // Done: bold + aligned left.
  await openTitleSheet(m1, 'Typography')
  await openTextTab(m1, 'font')
  await tapOn(m1, m1.page.getByTestId(TX.bold))
  await openTextTab(m1, 'align')
  await tapOn(m1, m1.page.getByTestId(`${TX.alignH}-left`))
  await expect(m1.page.getByTestId(`${TX.alignH}-left`)).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)
  const styled = await pixelsWhen(m1, image => {
    const centre = differenceCentroidX(background, image)
    return centre !== null && plainCentre !== null && centre < plainCentre - 0.15
  }, 'the left-aligned title did not move to the left of the centred one')
  expect(differenceMask(background, styled).size, 'bold strokes cover more pixels than the regular weight').toBeGreaterThan(plainGlyphs * 1.1)

  await tapUndo(m1)
  await expect.poll(async () => (await textClips(m1)).length).toBe(0)
  await expectSamePicture(m1, background, 'Undo did not restore the picture')
})

test('text style tabs that are not available yet stay visible and explain themselves @phone', async ({ m1 }) => {
  await importA(m1, 1)
  await openTitleSheet(m1, 'Greyed')
  for (const id of ['box', 'animation'] as const) {
    await expect(tab(m1, id), `${id} tab is visible`).toBeVisible()
    await expect(tab(m1, id)).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, tab(m1, id))
    await expect(m1.page.getByTestId('phone-unavailable-notice'), `${id} explains itself`).toBeVisible()
    await tapOn(m1, m1.page.getByTestId('phone-unavailable-notice').getByRole('button').first())
  }
  await tapCancel(m1)
})

test('text-style-edit: a selected title reopens with its own style @phone', async ({ m1 }) => {
  await importA(m1, 1)
  await openTitleSheet(m1, 'Edit me')
  await openTextTab(m1, 'color')
  await tapOn(m1, m1.page.getByTestId(`${TX.color}-f0444a`))
  await tapDone(m1)
  // The title is selected after Done; a clip action named Text / Edit text should reopen it.
  const editText = m1.toolbar.getByRole('button', { name: /^(Edit text|Text)$/ })
  await expect(editText, 'no Text entry in the clip toolbar').toBeVisible({ timeout: 3_000 })
  await tapOn(m1, editText)
  await expect(m1.sheet, 'Edit text did not open the title sheet').toBeVisible()
  await expect(m1.page.getByTestId(M1_IDS.titleInput), 'the title sheet did not reopen the selected title').toHaveValue('Edit me')
  await tapCancel(m1)
})

test('animation In: Fade in on a video clip hides frame 0 and keeps later frames; Cancel and Undo restore @phone', async ({ m1 }) => {
  const state = await importA(m1, 0)
  const clip = state.main[0]
  await expect.poll(() => previewCode(m1), { message: 'frame 0 is not visible before the animation' }).toBe(0)
  const before = await previewPixels(m1.probe)

  await tapClip(m1, clip.id)
  await tapAction(m1, phoneActionTestId('animation'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.page.getByTestId(`${PHONE_ANIMATION_TEST_IDS.tab}-in`)).toHaveAttribute('aria-selected', 'true')
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('in', 'fade')))
  await expect.poll(() => previewCode(m1), { message: 'the live Fade in does not hide frame 0 (opacity 0 at the clip start)' }).toBeNull()
  await tapCancel(m1)
  await expect.poll(() => previewCode(m1), { message: 'Cancel did not bring frame 0 back' }).toBe(0)
  await expectSamePicture(m1, before, 'Cancel changed the preview')
  expect(await readKeyframes(m1, clip.id), 'Cancel left keyframes').toEqual([])

  await tapAction(m1, phoneActionTestId('animation'))
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('in', 'fade')))
  await tapDone(m1)
  await expect.poll(() => previewCode(m1), { message: 'after Done frame 0 is still visible' }).toBeNull()
  expect(keySignature(await readKeyframes(m1, clip.id))).toEqual(['opacity@0.000=0.000', 'opacity@0.500=1.000'])
  await seek(m1, 1)
  await settled(m1)
  await expect.poll(() => previewCode(m1), { message: 'after the fade the clip is fully visible again (frame 30)' }).toBe(30)

  await seek(m1, 0)
  await tapUndo(m1)
  await expect.poll(() => previewCode(m1), { message: 'one Undo did not bring frame 0 back' }).toBe(0)
  await expectSamePicture(m1, before, 'Undo did not restore the picture')
  expect(await readKeyframes(m1, clip.id), 'Undo left keyframes').toEqual([])
})

test('text-transform-animation: a title slides in from the left, holds and fades out; Undo restores @phone', async ({ m1 }) => {
  await importA(m1, 0)
  const background = await previewPixels(m1.probe)
  const endTime = 5 - 1 / 30 // last frame of a 5 s title; the 4 s clip below has ended there
  await seek(m1, endTime)
  const emptyEnd = await previewPixels(m1.probe)
  await seek(m1, 0)
  await openTitleSheet(m1, 'MOVING')
  await tapDone(m1)
  const [title] = await textClips(m1)
  expect(title.start + title.duration, 'titles last 5 s').toBeCloseTo(5, 3)
  const still = await pixelsWhen(m1, image => differingShare(background, image) > 0.002, 'the title is not visible')
  // Reference pictures of the static title during the hold and on its last frame.
  await seek(m1, 2.5)
  await settled(m1)
  await expect.poll(() => previewCode(m1)).toBe(75)
  const stillHold = await pixelsWhen(m1, image => differingShare(still, image) < 0.2, 'hold reference')
  await seek(m1, endTime)
  await settled(m1)
  await expect.poll(() => previewCode(m1)).toBeNull()
  const stillEnd = await pixelsWhen(m1, image => differingShare(emptyEnd, image) > 0.002, 'the static title is not visible on its last frame')
  await seek(m1, 0)
  await settled(m1)

  // The title is selected after Done: Animation opens for it. Cancel first.
  await tapAction(m1, phoneActionTestId('animation'))
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('in', 'left')))
  await tapOn(m1, m1.page.getByTestId(`${PHONE_ANIMATION_TEST_IDS.tab}-out`))
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('out', 'fade')))
  await tapCancel(m1)
  await expectSamePicture(m1, still, 'Cancel changed the preview')
  expect(await readKeyframes(m1, title.id)).toEqual([])

  await tapAction(m1, phoneActionTestId('animation'))
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('in', 'left')))
  await tapOn(m1, m1.page.getByTestId(`${PHONE_ANIMATION_TEST_IDS.tab}-out`))
  await tapOn(m1, m1.page.getByTestId(phoneAnimationPresetTestId('out', 'fade')))
  await tapDone(m1)
  // Entry: at the clip start the title is one composition width to the left, off screen.
  await expectSamePicture(m1, background, 'at the clip start the title should still be outside the picture')
  // Hold: in the middle it sits exactly where the static title was.
  await seek(m1, 2.5)
  await settled(m1)
  await expect.poll(() => previewCode(m1)).toBe(75)
  await expectSamePicture(m1, stillHold, 'during the hold the title is not back in its place')
  // Exit: on the last frame it has nearly faded out (opacity eases to 0 at the clip end).
  await seek(m1, endTime)
  await settled(m1)
  await expect.poll(() => previewCode(m1)).toBeNull()
  await expect.poll(async () => differingShare(emptyEnd, await previewPixels(m1.probe)), { message: 'the title is not fading out at the end' })
    .toBeLessThan(differingShare(emptyEnd, stillEnd) * 0.5)

  await seek(m1, 0)
  await tapUndo(m1)
  await expectSamePicture(m1, still, 'one Undo did not bring the static title back')
  expect(await readKeyframes(m1, title.id)).toEqual([])
})

test('keyframe diamond: adds the current transform at the playhead, fills, removes again; one Undo each @phone', async ({ m1 }) => {
  const state = await importA(m1, 1)
  const clip = state.main[0]
  const diamond = m1.page.getByTestId(KF.diamond)
  await expect(diamond, 'without a selection the diamond is greyed').toHaveAttribute('aria-disabled', 'true')
  await tapClip(m1, clip.id)
  await expect(diamond).toHaveAttribute('data-state', 'off')
  const before = await previewPixels(m1.probe)

  await tapOn(m1, diamond)
  await expect(diamond, 'the diamond fills on the new keyframe').toHaveAttribute('data-state', 'on')
  const keys = await readKeyframes(m1, clip.id)
  expect(keys.map(key => key.property).toSorted()).toEqual(['opacity', 'position.x', 'position.y', 'rotation.z', 'scale.x', 'scale.y'])
  expect(keys.every(key => Math.abs(key.time - 1) < 1e-3), 'all keys sit at the playhead (clip-local 1 s)').toBe(true)
  await expectSamePicture(m1, before, 'keying the current values changed the picture')

  await seek(m1, 2)
  await expect(diamond, 'off the keyframe the diamond is hollow').toHaveAttribute('data-state', 'off')
  await seek(m1, 1)
  await expect(diamond).toHaveAttribute('data-state', 'on')
  await tapOn(m1, diamond)
  await expect(diamond, 'a tap on a filled diamond removes the keys').toHaveAttribute('data-state', 'off')
  expect(await readKeyframes(m1, clip.id)).toEqual([])

  await tapUndo(m1)
  await expect(diamond, 'one Undo brings the removed keys back').toHaveAttribute('data-state', 'on')
  expect(await readKeyframes(m1, clip.id)).toHaveLength(6)
  await tapUndo(m1)
  await expect(diamond, 'a second Undo takes the added keys away').toHaveAttribute('data-state', 'off')
  expect(await readKeyframes(m1, clip.id)).toEqual([])
})

test('keyframe sheet: lists properties, jumps between keys, deletes one; Cancel and Undo restore @phone', async ({ m1 }) => {
  const state = await importA(m1, 0)
  const clip = state.main[0]
  // Arrangement: an opacity fade-out key (0 at 2 s) after a full key at 1 s, and a position key at 3 s.
  await m1.bridge.toolData('addKeyframe', { sequence: [
    { clipId: clip.id, property: 'opacity', value: 1, time: 1 },
    { clipId: clip.id, property: 'opacity', value: 0, time: 2 },
    { clipId: clip.id, property: 'position.x', value: 0, time: 3 },
  ] })
  const arranged = keySignature(await readKeyframes(m1, clip.id))
  expect(arranged).toHaveLength(3)
  await tapClip(m1, clip.id)

  await tapAction(m1, phoneActionTestId('keyframe'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.page.getByTestId(KF.row)).toHaveCount(2)
  await expect(m1.page.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.key}"]`)).toHaveCount(2)
  // Next / Previous move the playhead to the keys, and the preview follows (frame codes).
  await tapOn(m1, m1.page.getByTestId(KF.next))
  await expect.poll(async () => (await m1.timeline()).playhead).toBeCloseTo(1, 3)
  await expect.poll(() => previewCode(m1), { message: 'Next did not show frame 30' }).toBe(30)
  await tapOn(m1, m1.page.getByTestId(KF.next))
  await expect.poll(async () => (await m1.timeline()).playhead).toBeCloseTo(2, 3)
  await expect.poll(() => previewCode(m1), { message: 'at the opacity-0 key the clip is invisible' }).toBeNull()
  // Delete the opacity key at 2 s: the clip becomes visible there (live).
  await tapOn(m1, m1.page.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.deleteKey}"]`))
  await expect.poll(() => previewCode(m1), { message: 'deleting the opacity-0 key did not show frame 60' }).toBe(60)
  await tapCancel(m1)
  expect(keySignature(await readKeyframes(m1, clip.id)), 'Cancel did not restore the keys').toEqual(arranged)
  await expect.poll(async () => (await m1.timeline()).playhead, { message: 'Cancel did not restore the playhead' }).toBeCloseTo(0, 3)
  await expect.poll(() => previewCode(m1)).toBe(0)

  // Done: jump to the key with a chip and delete it; one Undo brings it back.
  await tapAction(m1, phoneActionTestId('keyframe'))
  await tapOn(m1, m1.page.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.key}"][data-time="2.0000"]`))
  await expect.poll(async () => (await m1.timeline()).playhead).toBeCloseTo(2, 3)
  await tapOn(m1, m1.page.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.deleteKey}"]`))
  await tapDone(m1)
  await expect.poll(() => previewCode(m1), { message: 'after Done frame 60 is visible' }).toBe(60)
  expect(await readKeyframes(m1, clip.id)).toHaveLength(2)
  await tapUndo(m1)
  await expect.poll(() => previewCode(m1), { message: 'one Undo did not bring the opacity-0 key back' }).toBeNull()
  expect(keySignature(await readKeyframes(m1, clip.id))).toEqual(arranged)
})

test('sheet-growth: a style tab opened after the sheet settled grows the sheet instead of opening below the fold @phone', async ({ m1 }) => {
  await importA(m1, 1)
  await openTitleSheet(m1, 'GROW')
  // Past the 400 ms in which a content-fit sheet follows its content: its height is locked now.
  await expect.poll(async () => m1.sheet.evaluate(element => (element as HTMLElement).style.height), { message: 'the sheet height did not lock' }).toMatch(/px$/)
  await m1.page.getByTestId(M1_IDS.titleInput).blur()
  const before = (await m1.sheet.boundingBox())!.height
  await openTextTab(m1, 'shadow')
  await expect.poll(async () => (await m1.sheet.boundingBox())!.height, { message: 'the sheet grew for the opened panel' }).toBeGreaterThan(before + 30)
  await tapCancel(m1)
})
