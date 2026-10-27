import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { buildPhoneSpeedCurveWarp, phoneWarpSourceAt } from '../../../src/components/mobileSkin/speed/phoneSpeedCurves'
import { PHONE_SPEED_TEST_IDS as SPEED, phoneSpeedChipTestId, phoneSpeedCurveTestId } from '../../../src/components/mobileSkin/speed/phoneSpeedTestIds'
import {
  PHONE_TRANSITION_TEST_IDS as TRANSITION, phoneTransitionCategoryTestId, phoneTransitionChoiceTestId,
} from '../../../src/components/mobileSkin/transition/phoneTransitionTestIds'
import { visibleCentre } from './phoneFixture'
import { readPreviewFrame } from './phoneTouch'
import {
  A_TAG, B_TAG, FPS, IDS, differingShare, expect, importViaSheet, previewPixels, seek, signatureOf, tapAction, tapClip, tapOn, test,
  type M1Session, type M1Timeline,
} from './m1Fixture'

/**
 * M2 "Gestalten", packet transitions and speed (PLAN.md section 5): the transition button at a cut,
 * the transition sheet and the speed sheet, one catalog case per test, in the M1 phone world
 * (m1Fixture.ts: a phone project built through the phone UI, a fresh composition per test).
 * The truth is the preview's real pixels: frame codes where the picture is one frame of one clip
 * (speed, reverse, curve), pixel differences where a transition mixes two pictures. Every action
 * under test is a real touch on the phone UI; the bridge only arranges (playhead) and inspects
 * (timeline state, clip details). For every sheet: Done changes the rendered result, ONE Undo
 * returns exactly to the state before, Cancel leaves pixels and timeline unchanged.
 *
 * Media: A = 4 s (frames 0..119), B = 3 s (frames 0..89), short = 1 s, all 360x640 at 30 fps.
 */
test.describe.configure({ timeout: 150_000 })

interface TransitionInfo { id: string; type: string; duration: number; linkedClipId: string }
interface ClipDetails { duration: number; startTime: number; speed: number; reversed: boolean; transitionOut?: TransitionInfo; transitionIn?: TransitionInfo }

const details = (m1: M1Session, clipId: string) => m1.bridge.toolData<ClipDetails>('getClipDetails', { clipId })
const transitionOut = async (m1: M1Session, clipId: string) => (await details(m1, clipId)).transitionOut ?? null
const cutButton = (m1: M1Session, clipAId: string) => m1.page.locator(`[data-testid="${TRANSITION.cutButton}"][data-clip-a="${clipAId}"]`)

async function importAB(m1: M1Session): Promise<M1Timeline> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  expect(state.main[0].name).toContain(A_TAG)
  expect(state.main[1].name).toContain(B_TAG)
  return state
}

/** Waits until the preview shows `frame` (frame code) twice in a row. */
async function expectFrame(m1: M1Session, frame: number, what: string): Promise<void> {
  m1.probe.mark()
  await m1.probe.waitForFrame(frame, { allowed: () => true, timeoutMs: 15_000 })
  for (let read = 0; read < 2; read++) expect((await readPreviewFrame(m1.probe)).frame, `${what}. ${m1.probe.summary()}`).toBe(frame)
}

/** Waits until the preview pixels match `reference` (sheet closed, render settled). */
async function expectPixelsLike(m1: M1Session, reference: Awaited<ReturnType<typeof previewPixels>>, what: string): Promise<void> {
  await expect.poll(async () => differingShare(reference, await previewPixels(m1.probe)), { message: what, timeout: 15_000 }).toBeLessThan(0.0005)
}

async function openCut(m1: M1Session, clipAId: string): Promise<void> {
  await expect(cutButton(m1, clipAId), 'a transition button at the cut').toBeVisible()
  await tapOn(m1, cutButton(m1, clipAId))
  await expect(m1.sheet, 'the transition sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(TRANSITION.status)).toBeVisible()
}

async function pickTransition(m1: M1Session, category: string, type: string): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(phoneTransitionCategoryTestId(category)))
  await tapOn(m1, m1.page.getByTestId(phoneTransitionChoiceTestId(type)))
  await expect(m1.page.getByTestId(phoneTransitionChoiceTestId(type))).toHaveAttribute('aria-pressed', 'true')
}

async function tapDone(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden()
}

async function tapCancel(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'the sheet stayed open after Cancel').toBeHidden()
}

/** The unavailable notice shows a reason mentioning `pattern`; OK dismisses it. */
async function expectExplained(m1: M1Session, pattern: RegExp): Promise<void> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice).toContainText(pattern)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

async function undoOnce(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

/** Frame a constant-speed clip starting at 0 with in point 0 shows at time t. */
const frameAtSpeed = (t: number, speed: number) => Math.floor(t * speed * FPS + 1e-6)

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

test('T1 the button at a cut opens the transition sheet; Done renders Dip to White, one Undo removes it @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  await seek(m1, b.start)
  await expectFrame(m1, 0, 'B frame 0 at the cut before any transition')
  const before = await previewPixels(m1.probe)
  const signature = signatureOf((await m1.timeline()).main)
  await expect(cutButton(m1, a.id)).toHaveAttribute('data-has-transition', 'false')

  await openCut(m1, a.id)
  expect((await m1.timeline()).selectedIds, 'tapping the cut button selected a clip').toEqual([])
  await expect(m1.page.getByTestId(TRANSITION.status)).toContainText('no transition')
  await pickTransition(m1, 'dissolve', 'dip-to-white')
  await expect.poll(async () => (await transitionOut(m1, a.id))?.type, { message: 'the choice is not applied live' }).toBe('dip-to-white')
  await tapDone(m1)

  const applied = await transitionOut(m1, a.id)
  expect(applied, 'A carries the transition to B').toMatchObject({ type: 'dip-to-white', duration: 1, linkedClipId: b.id })
  expect(signatureOf((await m1.timeline()).main), 'a transition never moves clips').toEqual(signature)
  await expect(cutButton(m1, a.id)).toHaveAttribute('data-has-transition', 'true')
  expect((await m1.timeline()).playhead, 'the playhead stays at the cut').toBeCloseTo(b.start, 4)
  // Middle of a dip to white: the picture at the cut turns white.
  await expect.poll(async () => differingShare(before, await previewPixels(m1.probe)), {
    message: 'the preview at the cut does not show the transition', timeout: 15_000,
  }).toBeGreaterThan(0.3)

  await undoOnce(m1)
  await expect.poll(() => transitionOut(m1, a.id), { message: 'one Undo did not remove the transition' }).toBeNull()
  await expectPixelsLike(m1, before, 'one Undo did not bring back the plain cut')
  expect(signatureOf((await m1.timeline()).main)).toEqual(signature)
})

test('T2 Cancel in the transition sheet leaves pixels, timeline and playhead exactly as before @phone', async ({ m1 }) => {
  const [a] = (await importAB(m1)).main
  await seek(m1, 3)
  await expectFrame(m1, 90, 'A frame 90 at 3 s')
  const before = await previewPixels(m1.probe)
  const signature = signatureOf((await m1.timeline()).main)

  await openCut(m1, a.id)
  // The sheet shows the middle of the transition: the playhead jumps to the cut while it is open.
  await expect.poll(async () => (await m1.timeline()).playhead).toBeCloseTo(a.start + a.duration, 4)
  await pickTransition(m1, 'wipe', 'wipe-left')
  await expect.poll(async () => (await transitionOut(m1, a.id))?.type, { message: 'the choice is not applied live' }).toBe('wipe-left')
  await tapCancel(m1)

  await expect.poll(() => transitionOut(m1, a.id), { message: 'Cancel kept the transition' }).toBeNull()
  expect((await m1.timeline()).playhead, 'Cancel returns the playhead').toBeCloseTo(3, 4)
  expect(signatureOf((await m1.timeline()).main), 'Cancel changed the timeline').toEqual(signature)
  await expectFrame(m1, 90, 'A frame 90 after Cancel')
  await expectPixelsLike(m1, before, 'Cancel changed the preview')
})

test('T3 the Transition tool of a selected clip opens its cut; the duration slider sets the duration, one Undo removes all @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  await seek(m1, 1)
  await tapClip(m1, a.id)
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([a.id])
  await tapAction(m1, phoneActionTestId('transition'))
  await expect(m1.sheet).toBeVisible()
  await expect(m1.page.getByTestId(TRANSITION.status)).toContainText(A_TAG)
  await expect(m1.page.getByTestId(TRANSITION.status)).toContainText(B_TAG)
  await pickTransition(m1, 'dissolve', 'crossfade')

  // Drag the slider thumb by touch from its current value (1.0 s) towards 2.5 s. On a short screen
  // the slider sits below the fold of the sheet: scroll it in and press where it is really visible.
  const slider = m1.page.getByTestId(TRANSITION.duration)
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  if (!box) throw new Error('duration slider not rendered')
  const now = Number(await slider.inputValue())
  const [min, max] = await Promise.all(['min', 'max'].map(async name => Number(await slider.getAttribute(name))))
  expect(now, 'the duration starts at 1 s').toBeCloseTo(1, 5)
  const thumb = 12 // half the 24 px thumb (phoneChoiceControls.css)
  const xFor = (seconds: number) => box.x + thumb + ((seconds - min) / (max - min)) * (box.width - 2 * thumb)
  const start = { x: xFor(now), y: (await visibleCentre(slider, m1.sheet)).y }
  expect(await m1.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null, start), 'the finger lands on the slider').toBe(TRANSITION.duration)
  await m1.touch.pan(start, { x: xFor(2.5) - start.x, y: 0 })
  const shown = Number((await m1.page.getByTestId(TRANSITION.durationValue).innerText()).replace(/[^\d.]/g, ''))
  expect(shown, 'the slider moved the duration').toBeGreaterThan(1.5)
  await expect.poll(async () => (await transitionOut(m1, a.id))?.duration, { message: 'the duration is not applied live' }).toBeCloseTo(shown, 5)
  await tapDone(m1)

  expect(await transitionOut(m1, a.id)).toMatchObject({ type: 'crossfade', linkedClipId: b.id })
  expect((await transitionOut(m1, a.id))!.duration).toBeCloseTo(shown, 5)
  await undoOnce(m1)
  await expect.poll(() => transitionOut(m1, a.id), { message: 'one Undo did not remove type and duration together' }).toBeNull()
})

test('T4 "Apply to all cuts" puts the transition on every cut of the track as one undo step @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path, m1.media.short.path] }, { main: 3, total: 3 })
  const [a, b, c] = state.main
  expect(c.start, 'the short clip follows B').toBeCloseTo(b.start + b.duration, 2)
  await seek(m1, b.start)
  await openCut(m1, a.id)
  await pickTransition(m1, 'dissolve', 'crossfade')
  await expect(m1.page.getByTestId(TRANSITION.applyAll)).toContainText('(2)')
  await tapOn(m1, m1.page.getByTestId(TRANSITION.applyAll))
  await expect(m1.page.getByTestId(TRANSITION.applyAll)).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)

  expect(await transitionOut(m1, a.id)).toMatchObject({ type: 'crossfade', linkedClipId: b.id })
  expect(await transitionOut(m1, b.id)).toMatchObject({ type: 'crossfade', linkedClipId: c.id })
  await undoOnce(m1)
  await expect.poll(async () => [await transitionOut(m1, a.id), await transitionOut(m1, b.id)], { message: 'one Undo did not clear both cuts' }).toEqual([null, null])
})

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

async function openSpeed(m1: M1Session, clipId: string): Promise<void> {
  await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([clipId])
  await tapAction(m1, phoneActionTestId('speed'))
  await expect(m1.sheet, 'the speed sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(SPEED.value)).toHaveText('1x')
  const name = (await m1.timeline()).main.find(clip => clip.id === clipId)?.name ?? ''
  await expect(m1.page.getByTestId(SPEED.target), 'the sheet names the clip it changes').toContainText(name.slice(0, 20))
  await expect(m1.page.getByTestId(SPEED.leftOut), 'one selected clip leaves nothing out').toHaveCount(0)
}

test('S1 Speed 2x halves the clip and doubles the pace in the preview; one Undo restores both @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  const t = 0.5 + 0.25 / FPS
  await seek(m1, t)
  await expectFrame(m1, frameAtSpeed(t, 1), 'A at 1x')
  await openSpeed(m1, a.id)
  await tapOn(m1, m1.page.getByTestId(phoneSpeedChipTestId(2)))
  await expect(m1.page.getByTestId(SPEED.value)).toHaveText('2x')
  await expect.poll(async () => (await details(m1, a.id)).duration, { message: 'the clip length does not follow live' }).toBeCloseTo(2, 4)
  await expect(m1.page.getByTestId(SPEED.duration)).toContainText('4.0 s → 2.0 s')
  await tapDone(m1)

  expect(await details(m1, a.id)).toMatchObject({ speed: 2 })
  expect((await details(m1, b.id)).startTime, 'like on the desktop, the next clip keeps its place').toBeCloseTo(b.start, 4)
  await seek(m1, t)
  await expectFrame(m1, frameAtSpeed(t, 2), 'A at 2x shows the source frame twice as far in')

  await undoOnce(m1)
  await expect.poll(async () => (await details(m1, a.id)).duration, { message: 'one Undo did not restore the length' }).toBeCloseTo(4, 4)
  expect((await details(m1, a.id)).speed).toBe(1)
  await seek(m1, t)
  await expectFrame(m1, frameAtSpeed(t, 1), 'A back at 1x after one Undo')
})

test('S2 Cancel in the speed sheet leaves pixels and timeline exactly as before @phone', async ({ m1 }) => {
  const [a] = (await importAB(m1)).main
  await seek(m1, 1)
  await expectFrame(m1, 30, 'A frame 30 at 1 s')
  const before = await previewPixels(m1.probe)
  const signature = signatureOf((await m1.timeline()).main)
  await openSpeed(m1, a.id)
  await tapOn(m1, m1.page.getByTestId(phoneSpeedChipTestId(0.5)))
  await expect.poll(async () => (await details(m1, a.id)).duration, { message: 'the slower speed is not applied live' }).toBeCloseTo(8, 4)
  await tapOn(m1, m1.page.getByTestId(SPEED.reverse))
  await expect.poll(async () => (await details(m1, a.id)).reversed).toBe(true)
  await tapCancel(m1)

  await expect.poll(async () => (await details(m1, a.id)).duration, { message: 'Cancel kept the new length' }).toBeCloseTo(4, 6)
  expect(await details(m1, a.id)).toMatchObject({ speed: 1, reversed: false })
  expect(signatureOf((await m1.timeline()).main), 'Cancel changed the timeline').toEqual(signature)
  await expectFrame(m1, 30, 'A frame 30 after Cancel')
  await expectPixelsLike(m1, before, 'Cancel changed the preview')
})

test('S3 Reverse plays the clip backwards from its last frame; one Undo restores the direction @phone', async ({ m1 }) => {
  const [a] = (await importAB(m1)).main
  const t = 0.5 / FPS
  await seek(m1, t)
  await expectFrame(m1, 0, 'A frame 0 at the start')
  await openSpeed(m1, a.id)
  await tapOn(m1, m1.page.getByTestId(SPEED.reverse))
  await expect(m1.page.getByTestId(SPEED.reverse)).toHaveAttribute('aria-checked', 'true')
  await tapDone(m1)
  await seek(m1, t)
  await expectFrame(m1, 119, 'reversed A starts on its last frame')
  await undoOnce(m1)
  await expect.poll(async () => (await details(m1, a.id)).reversed, { message: 'one Undo did not restore the direction' }).toBe(false)
  await seek(m1, t)
  await expectFrame(m1, 0, 'A frame 0 again after one Undo')
})

test('S4 a speed curve keeps the clip length and changes the pace inside it; one Undo restores it @phone', async ({ m1 }) => {
  const [a] = (await importAB(m1)).main
  const warp = buildPhoneSpeedCurveWarp({ duration: a.duration, inPoint: a.inPoint, outPoint: a.inPoint + a.duration, backward: false }, 'slow-middle')!
  // A time inside the clip where the curve's frame is far from the 1x frame and clear of a frame boundary.
  const candidates = [0.6, 0.8, 1.0, 1.2, 2.6, 2.8, 3.0].map(time => time + 0.5 / FPS)
  const t = candidates.find(time => {
    const exact = phoneWarpSourceAt(warp.points, time) * FPS
    return Math.abs(Math.floor(exact) - frameAtSpeed(time, 1)) >= 4 && exact - Math.floor(exact) > 0.15 && exact - Math.floor(exact) < 0.85
  })!
  expect(t, 'a measurable time for the curve').toBeDefined()
  const curveFrame = Math.floor(phoneWarpSourceAt(warp.points, t) * FPS)

  await seek(m1, t)
  await expectFrame(m1, frameAtSpeed(t, 1), 'A at 1x')
  await openSpeed(m1, a.id)
  await tapOn(m1, m1.page.getByTestId(SPEED.tabCurve))
  await tapOn(m1, m1.page.getByTestId(phoneSpeedCurveTestId('slow-middle')))
  await expect(m1.page.getByTestId(phoneSpeedCurveTestId('slow-middle'))).toHaveAttribute('aria-pressed', 'true')
  await tapDone(m1)

  expect((await details(m1, a.id)).duration, 'a curve keeps the clip length').toBeCloseTo(a.duration, 4)
  await seek(m1, t)
  await expectFrame(m1, curveFrame, `the curve shows source frame ${curveFrame} at ${t.toFixed(3)} s`)
  await undoOnce(m1)
  await seek(m1, t)
  await expectFrame(m1, frameAtSpeed(t, 1), 'A at 1x again after one Undo')
})

test('S5 options the phone does not have yet stay visible, greyed, and explain themselves @phone', async ({ m1 }) => {
  const [a] = (await importAB(m1)).main
  await openSpeed(m1, a.id)
  for (const id of [SPEED.freeze, SPEED.fitLength]) {
    await expect(m1.page.getByTestId(id)).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, m1.page.getByTestId(id))
    await expectExplained(m1, /M3/)
  }
  await expect(m1.sheet, 'explaining an option keeps the sheet open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(SPEED.tabCurve))
  await expect(m1.page.getByTestId(SPEED.editPoints)).toHaveAttribute('aria-disabled', 'true')
  await tapCancel(m1)
  await m1.bridge.toolData('clearSelection')
  await seek(m1, a.start + a.duration)
  await openCut(m1, a.id)
  await expect(m1.page.getByTestId(TRANSITION.settings)).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(TRANSITION.settings))
  await expectExplained(m1, /M3/)
  await tapCancel(m1)
  expect(await transitionOut(m1, a.id), 'looking at the options changed nothing').toBeNull()
})

test('S6 with two clips selected the sheet names its clip, says the other stays, and changes only that clip @phone', async ({ m1 }) => {
  const [a, b] = (await importAB(m1)).main
  // Arrange a two-clip selection (the bridge only arranges); the touch opens the sheet. The primary is the first id.
  await m1.bridge.toolData('selectClips', { clipIds: [b.id, a.id] })
  await expect.poll(async () => (await m1.timeline()).selectedIds.toSorted()).toEqual([a.id, b.id].toSorted())
  await tapAction(m1, phoneActionTestId('speed'))
  await expect(m1.sheet, 'the speed sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(SPEED.target)).toContainText(B_TAG)
  await expect(m1.page.getByTestId(SPEED.leftOut), 'the sheet says the other selected clip keeps its speed').toContainText(/Only this clip changes/)
  await expect(m1.page.getByTestId(SPEED.leftOut)).toContainText(A_TAG)
  await tapOn(m1, m1.page.getByTestId(phoneSpeedChipTestId(2)))
  await tapDone(m1)

  expect(await details(m1, b.id), 'the named clip changed').toMatchObject({ speed: 2 })
  expect((await details(m1, a.id)).speed, 'the other selected clip kept its speed, as the sheet said').toBe(1)
  await undoOnce(m1)
  await expect.poll(async () => (await details(m1, b.id)).speed, { message: 'one Undo did not restore the speed' }).toBe(1)
})
