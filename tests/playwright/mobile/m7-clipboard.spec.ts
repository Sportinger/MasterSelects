import { PHONE_CLIPBOARD_TEST_IDS as CB } from '../../../src/components/mobileSkin/clipboard/phoneClipboardTestIds'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { PHONE_KEYFRAME_TEST_IDS as KF } from '../../../src/components/mobileSkin/keyframe/phoneKeyframeTestIds'
import { expect, previewPixels, seek, tapOn, test, type M1Session } from './m1Fixture'
import {
  differenceBox, differing, effectsOf, importAB, importABShort, keysOf, luma, openClipTool, pickTargets, pixelsWhen, seekAndExpect,
  setGroup, tapCancel, tapDone, tapUndo,
} from './m7ClipboardFixture'
import { stablePixels } from './m2DesignFixture'

/**
 * G2 clipboards on the phone (packet G2-clipboard-looks-text), one catalog case per test:
 * INV-1/attribute-clipboard, INV-2/copy-paste-effects, INV-3/colour-copy-paste and
 * INV-3/keyframe-copy-paste. Every action under test is a real touch on the phone; the bridge only
 * arranges (effects, keys) and inspects. Pixels and frame codes are the truth: a pasted Invert breaks
 * the frame code, a pasted opacity fade hides the clip, a pasted grade brightens it. Done is one undo
 * step, Cancel leaves the project as it was.
 */
test.describe.configure({ timeout: 180_000 })

/** Drags the visible effect/adjust slider by `fraction` of its width (real touch from the thumb). */
async function dragSlider(m1: M1Session, fraction: number): Promise<void> {
  const range = m1.sheet.getByTestId(FX.slider).locator('.handle-only-range').first()
  await range.scrollIntoViewIfNeeded()
  const box = (await range.boundingBox())!
  const [now, min, max] = await Promise.all(['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map(async name => Number(await range.getAttribute(name))))
  const ratio = (now - min) / (max - min)
  const start = { x: box.x + 3.5 + ratio * (box.width - 7), y: box.y + box.height / 2 }
  await m1.touch.pan(start, { x: fraction * (box.width - 7), y: 0 }, { steps: 10 })
}

test('INV-1/attribute-clipboard: Copy & paste puts effects and animation on two clips; Cancel restores, Done is one undo step @phone', async ({ m1 }) => {
  const [a, b, short] = (await importABShort(m1)).main
  await m1.bridge.toolData('addEffect', { clipId: a.id, effectType: 'invert' })
  await m1.bridge.toolData('addKeyframe', { sequence: [
    { clipId: a.id, property: 'opacity', value: 1, time: 0 },
    { clipId: a.id, property: 'opacity', value: 0, time: 2 },
  ] })
  const sourceEffect = (await effectsOf(m1, a.id))[0]
  await seekAndExpect(m1, b.start + 2.5, 75, 'B shows frame 75 before any paste')
  await seekAndExpect(m1, b.start + 0.25, 7, 'B shows frame 7 before any paste')
  const bBefore = await previewPixels(m1.probe)

  // Cancel: copy, paste onto B and short live, then Cancel takes it back.
  await openClipTool(m1, a.id, 'clipboard')
  await setGroup(m1, CB.copyGroup, 'colour', false)
  await setGroup(m1, CB.copyGroup, 'effects', true)
  await setGroup(m1, CB.copyGroup, 'animation', true)
  await tapOn(m1, m1.sheet.getByTestId(CB.copy))
  await expect(m1.sheet.getByTestId(CB.paste)).toBeVisible()
  await pickTargets(m1, [b.id, short.id])
  await tapOn(m1, m1.sheet.getByTestId(CB.paste))
  await expect(m1.sheet.getByTestId(CB.pasted)).toBeVisible()
  await expect.poll(async () => (await effectsOf(m1, b.id)).map(effect => effect.type), { message: 'the paste is not live' }).toEqual(['invert'])
  await tapCancel(m1)
  expect(await effectsOf(m1, b.id), 'Cancel removed the pasted effects of B').toEqual([])
  expect(await effectsOf(m1, short.id)).toEqual([])
  expect(await keysOf(m1, b.id)).toEqual([])

  // Done: the same paste stays, as one undo step.
  await openClipTool(m1, a.id, 'clipboard')
  await pickTargets(m1, [b.id, short.id])
  await tapOn(m1, m1.sheet.getByTestId(CB.paste))
  await expect(m1.sheet.getByTestId(CB.pasted)).toBeVisible()
  await tapDone(m1)
  for (const target of [b, short]) {
    const effects = await effectsOf(m1, target.id)
    expect(effects.map(effect => effect.type), `${target.name} got the effect`).toEqual(['invert'])
    expect(effects[0].id, 'a pasted effect is a new instance').not.toBe(sourceEffect.id)
    // Same clip-local times as on A; on the 1 s clip the 2 s key is clamped to its end.
    expect((await keysOf(m1, target.id, 'opacity')).map(key => [Number(key.time.toFixed(3)), key.value]), 'the animation lands at the same local times')
      .toEqual([[0, 1], [Math.min(2, Number(target.duration.toFixed(3))), 0]])
  }
  expect((await effectsOf(m1, a.id)).map(effect => effect.id), 'the source stays as it was').toEqual([sourceEffect.id])
  await seekAndExpect(m1, b.start + 2.5, null, 'the pasted fade hides B after 2 s')
  await seek(m1, b.start + 0.25)
  await pixelsWhen(m1, px => differing(bBefore, px) > 0.3, 'the pasted Invert changes B')

  await tapUndo(m1)
  await expect.poll(() => effectsOf(m1, b.id), { message: 'one Undo did not remove the paste from B' }).toEqual([])
  expect(await effectsOf(m1, short.id), 'one Undo removed the paste from both clips').toEqual([])
  expect(await keysOf(m1, b.id)).toEqual([])
  await seekAndExpect(m1, b.start + 2.5, 75, 'after Undo B shows frame 75 again')
})

test('INV-2/copy-paste-effects: Effects → Copy or paste effects replaces the target stack; one Undo restores @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  await m1.bridge.toolData('addEffect', { clipId: a.id, effectType: 'invert' })
  await m1.bridge.toolData('addEffect', { clipId: b.id, effectType: 'brightness', params: { amount: 0.3 } })
  await seek(m1, b.start + 0.5)
  // The selection outline is drawn on the preview: compare pictures with nothing selected.
  await m1.bridge.toolData('clearSelection')
  const bBefore = await stablePixels(m1)

  await openClipTool(m1, a.id, 'effects')
  await tapOn(m1, m1.sheet.getByTestId(FX.effectsClipboard))
  await expect(m1.sheet.getByTestId(CB.copy), 'Copy & paste opened from Effects').toBeVisible()
  await expect(m1.sheet.getByTestId(`${CB.copyGroup}-effects`)).toHaveAttribute('aria-pressed', 'true')
  await expect(m1.sheet.getByTestId(`${CB.copyGroup}-colour`), 'only the effects group is focused').toHaveAttribute('aria-pressed', 'false')
  await tapOn(m1, m1.sheet.getByTestId(CB.copy))
  await pickTargets(m1, [b.id])
  await expect(m1.sheet.getByTestId(CB.replaceNote), 'the replacement is spelled out').toContainText('replaces the effects')
  await tapOn(m1, m1.sheet.getByTestId(CB.paste))
  await expect(m1.sheet.getByTestId(CB.pasted)).toBeVisible()
  await tapDone(m1)

  expect((await effectsOf(m1, b.id)).map(effect => effect.type), 'the paste replaced B\'s stack').toEqual(['invert'])
  await pixelsWhen(m1, px => differing(bBefore, px) > 0.3, 'B shows the pasted Invert')
  await tapUndo(m1)
  await expect.poll(async () => (await effectsOf(m1, b.id)).map(effect => effect.type), { message: 'one Undo did not bring back B\'s stack' }).toEqual(['brightness'])
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => { const px = await previewPixels(m1.probe); return `${differing(bBefore, px) < 0.002} ${differenceBox(bBefore, px)}` }, { message: 'after Undo B looks as before', timeout: 20_000 }).toMatch(/^true/)
})

test('INV-3/colour-copy-paste: Adjust → Copy or paste colour grades a second clip the same; one Undo restores @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  await seekAndExpect(m1, a.start + 1, 30, 'A frame 30')
  const aBefore = await previewPixels(m1.probe)
  // Arrangement through the phone: brighten A in Adjust.
  await openClipTool(m1, a.id, 'adjust')
  await dragSlider(m1, 0.3)
  await pixelsWhen(m1, px => luma(px) > luma(aBefore) + 8, 'Adjust brightened A')
  await tapDone(m1)
  await seekAndExpect(m1, b.start + 0.5, 15, 'B frame 15 before the paste')
  const bBefore = await previewPixels(m1.probe)
  const effectsBefore = await effectsOf(m1, b.id)

  await openClipTool(m1, a.id, 'adjust')
  await tapOn(m1, m1.sheet.getByTestId(FX.adjustClipboard))
  await expect(m1.sheet.getByTestId(CB.copy), 'Copy & paste opened from Adjust').toBeVisible()
  await expect(m1.sheet.getByTestId(`${CB.copyGroup}-colour`)).toHaveAttribute('aria-pressed', 'true')
  await expect(m1.sheet.getByTestId(`${CB.copyGroup}-effects`), 'only the colour group is focused').toHaveAttribute('aria-pressed', 'false')
  await tapOn(m1, m1.sheet.getByTestId(CB.copy))
  await pickTargets(m1, [b.id])
  await tapOn(m1, m1.sheet.getByTestId(CB.paste))
  await expect(m1.sheet.getByTestId(CB.pasted)).toBeVisible()
  await tapDone(m1)

  await seek(m1, b.start + 0.5)
  await pixelsWhen(m1, px => luma(px) > luma(bBefore) + 8, 'the pasted grade brightens B')
  expect(await effectsOf(m1, b.id), 'a colour paste leaves the effects alone').toEqual(effectsBefore)
  await tapUndo(m1)
  await pixelsWhen(m1, px => differing(bBefore, px) < 0.002, 'one Undo did not take the grade off B')
  await seek(m1, a.start + 1)
  await pixelsWhen(m1, px => luma(px) > luma(aBefore) + 8, 'A stays graded')
})

test('INV-3/keyframe-copy-paste: picked keys copy and paste at the playhead of another clip without doubling; one Undo @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  await m1.bridge.toolData('addKeyframe', { sequence: [
    { clipId: a.id, property: 'opacity', value: 1, time: 1 },
    { clipId: a.id, property: 'opacity', value: 0, time: 2 },
  ] })
  await openClipTool(m1, a.id, 'keyframe')
  await tapOn(m1, m1.sheet.getByTestId(KF.selectMode))
  for (const time of ['1.0000', '2.0000']) {
    const chip = m1.sheet.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.key}"][data-time="${time}"]`)
    await tapOn(m1, chip)
    await expect(chip).toHaveAttribute('data-picked', 'true')
  }
  await tapOn(m1, m1.sheet.getByTestId(KF.copy))
  await expect(m1.sheet.getByTestId(KF.paste)).toContainText('Paste 2')
  await tapCancel(m1)
  expect((await keysOf(m1, a.id)).length, 'copying changes nothing').toBe(2)

  await seekAndExpect(m1, b.start + 0.5, 15, 'B frame 15 at the paste point')
  await openClipTool(m1, b.id, 'keyframe')
  await tapOn(m1, m1.sheet.getByTestId(KF.paste))
  await expect(m1.sheet.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.key}"]`), 'pasted keys show live').toHaveCount(2)
  await tapOn(m1, m1.sheet.getByTestId(KF.paste))
  await expect(m1.sheet.getByTestId(KF.pasted)).toBeVisible()
  await expect(m1.sheet.locator(`[data-testid="${KF.row}"][data-property="opacity"] [data-testid="${KF.key}"]`), 'pasting again does not double keys').toHaveCount(2)
  await tapDone(m1)

  expect((await keysOf(m1, b.id, 'opacity')).map(key => [Number(key.time.toFixed(3)), key.value]), 'the copy starts at the playhead').toEqual([[0.5, 1], [1.5, 0]])
  await seekAndExpect(m1, b.start + 2, null, 'after the pasted fade B is hidden')
  await seekAndExpect(m1, b.start + 0.25, 7, 'before the pasted keys B is fully visible')
  await tapUndo(m1)
  await expect.poll(() => keysOf(m1, b.id), { message: 'one Undo did not remove the pasted keys' }).toEqual([])
  await seekAndExpect(m1, b.start + 2, 60, 'after Undo B shows frame 60 again')
})
