import { PHONE_COMPOSITIONS_TEST_IDS as COMPS, phoneCompositionFormatTestId, phoneCompositionFpsTestId } from '../../../src/components/mobileSkin/compositions/phoneCompositionsTestIds'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EDITS_TEST_IDS as EDITS } from '../../../src/components/mobileSkin/edits/phoneEditsTestIds'
import { PHONE_MARKERS_TEST_IDS as MARKERS } from '../../../src/components/mobileSkin/markers/phoneMarkersTestIds'
import { PHONE_REPLACE_TEST_IDS as REPLACE } from '../../../src/components/mobileSkin/replace/phoneReplaceTestIds'
import { PHONE_TRACKS_TEST_IDS as TRACKS } from '../../../src/components/mobileSkin/tracks/phoneTracksTestIds'
import { differingShare, expect, IDS, importViaSheet, previewPixels, seek, tapAction, tapOn, test, type M1Session } from './m1Fixture'
import { openRootSheet, tapCancel, tapDone, tapUndo, waitForSettledHistory } from './m2DesignFixture'
import {
  activeComposition, compositions, dismissNotice, expectFrame, expectHandedOver, handoffState, importAB, leaveWorkspace, markers, mediaIdOf,
  seekToFrame, selectOnly, tapTestId, tracks,
} from './m3TimelineFixture'

/**
 * M3 "Profi-Blätter", packet Q1 compositions and timeline pro (PLAN.md section 5): the compositions
 * sheet and the top bar's composition controls, the tracks, markers, trim-modes and replace sheets,
 * one catalog case per test, in the M1 phone world (m1Fixture.ts: a fresh composition per test).
 * Every action under test is real touch on the phone UI; the bridge only arranges (playhead) and
 * inspects (compositions, tracks, markers, clips). The truth is the preview's frame codes where a
 * picture is one frame of one clip, and store state for structure. Editing sheets: Done changes
 * the result, ONE Undo restores it, Cancel leaves it unchanged.
 *
 * Media: A = 4 s (frames 0..119), B = 3 s (frames 0..89), short = 1 s, all 360x640 at 30 fps.
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => { await leaveWorkspace(m1) })

/** Taps a range input at a fraction of its track (real touch, like a thumb landing there). */
async function tapRange(m1: M1Session, target: ReturnType<M1Session['page']['locator']>, fraction: number): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('the slider is not rendered')
  await m1.touch.tap({ x: box.x + 12 + (box.width - 24) * fraction, y: box.y + box.height / 2 })
}

/** The phone's Undo from the timeline (an open editor is left first); waits for the next revision. */
async function undoFromTimeline(m1: M1Session): Promise<void> {
  await leaveWorkspace(m1)
  await expect.poll(async () => (await handoffState(m1)).openGestures, { message: 'an edit transaction is still open' }).toBe(false)
  await tapUndo(m1)
}

const row = (m1: M1Session, testId: string, attribute: string, value: string) => m1.page.locator(`[data-testid="${testId}"][${attribute}="${value}"]`)

async function openCompositions(m1: M1Session): Promise<void> {
  await tapTestId(m1, COMPS.topBarButton)
  await expect(m1.sheet, 'the compositions sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(COMPS.list)).toBeVisible()
}

async function closeSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden({ timeout: 15_000 })
}

async function openRowMore(m1: M1Session, compositionId: string): Promise<ReturnType<M1Session['page']['locator']>> {
  const target = row(m1, COMPS.row, 'data-composition-id', compositionId)
  // The row stays expanded when a form returns to the list.
  if (!await target.getByTestId(COMPS.rename).isVisible()) await tapOn(m1, target.getByTestId(COMPS.rowMore))
  await expect(target.getByTestId(COMPS.rename)).toBeVisible()
  return target
}

// ---------------------------------------------------------------------------
// Compositions
// ---------------------------------------------------------------------------

test('composition-tabs-navigation: the top bar names the open composition and opens the list with it marked @phone', async ({ m1 }) => {
  const active = await activeComposition(m1)
  const button = m1.page.getByTestId(COMPS.topBarButton)
  await expect(button).toHaveAttribute('aria-label', new RegExp(active.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
  await openCompositions(m1)
  await expect(row(m1, COMPS.row, 'data-composition-id', active.id)).toHaveAttribute('data-active', 'true')
  await expect(m1.page.locator(`[data-testid="${COMPS.row}"][data-active="true"]`)).toHaveCount(1)
  await closeSheet(m1)
})

test('duplicate-manage-compositions: create with format and frame rate opens it; tapping a row switches back @phone', async ({ m1 }) => {
  const before = await activeComposition(m1)
  await openCompositions(m1)
  await tapTestId(m1, COMPS.create)
  const name = `Q1 wide ${Date.now() % 100000}`
  await m1.page.getByTestId(COMPS.nameInput).fill(name)
  await tapTestId(m1, phoneCompositionFormatTestId('16:9'))
  await tapTestId(m1, phoneCompositionFpsTestId(25))
  await tapTestId(m1, COMPS.formSubmit)
  await expect.poll(async () => (await activeComposition(m1)).name, { message: 'the new composition did not open' }).toBe(name)
  const created = await activeComposition(m1)
  expect([created.width, created.height, created.frameRate]).toEqual([1920, 1080, 25])
  await expect(m1.page.getByTestId(IDS.compositionTabs).locator(`[data-composition-id="${created.id}"]`)).toHaveAttribute('aria-selected', 'true')
  // Switch back by touch from the list.
  await closeSheet(m1)
  await openCompositions(m1)
  await tapOn(m1, row(m1, COMPS.row, 'data-composition-id', before.id).getByTestId(COMPS.rowOpen))
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'tapping the row did not switch back' }).toBe(before.id)
  await expect(m1.sheet).toBeHidden()
})

test('duplicate-manage-compositions: rename is one undo step; duplicate and delete with confirmation, Undo restores @phone', async ({ m1 }) => {
  const original = await activeComposition(m1)
  await waitForSettledHistory(m1)
  await openCompositions(m1)
  let target = await openRowMore(m1, original.id)
  await tapOn(m1, target.getByTestId(COMPS.rename))
  const renamed = `${original.name} R`
  await m1.page.getByTestId(COMPS.nameInput).fill(renamed)
  await tapTestId(m1, COMPS.formSubmit)
  await expect.poll(async () => (await activeComposition(m1)).name).toBe(renamed)
  await closeSheet(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await activeComposition(m1)).name, { message: 'one Undo did not restore the name' }).toBe(original.name)

  const countBefore = (await compositions(m1)).length
  await openCompositions(m1)
  target = await openRowMore(m1, original.id)
  await tapOn(m1, target.getByTestId(COMPS.duplicate))
  await expect.poll(async () => (await compositions(m1)).length, { message: 'duplicate did not add a composition' }).toBe(countBefore + 1)
  const copy = (await compositions(m1)).find(comp => comp.name === `${original.name} Copy`)
  expect(copy, 'the copy is named after the original').toBeTruthy()
  target = await openRowMore(m1, copy!.id)
  await tapOn(m1, target.getByTestId(COMPS.remove))
  await expect(m1.page.getByTestId(COMPS.confirmDelete), 'delete asks for confirmation').toBeVisible()
  await tapTestId(m1, COMPS.confirmDelete)
  await expect.poll(async () => (await compositions(m1)).some(comp => comp.id === copy!.id), { message: 'the copy was not deleted' }).toBe(false)
  expect((await m1.timeline()).activeCompositionId, 'deleting another composition keeps the open one').toBe(original.id)
  await closeSheet(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await compositions(m1)).some(comp => comp.id === copy!.id), { message: 'one Undo did not bring the deleted copy back' }).toBe(true)
})

test('duplicate-manage-compositions: settings change frame rate and duration as one undo step; Back changes nothing @phone', async ({ m1 }) => {
  const original = await activeComposition(m1)
  await waitForSettledHistory(m1)
  await openCompositions(m1)
  let target = await openRowMore(m1, original.id)
  await tapOn(m1, target.getByTestId(COMPS.settings))
  await tapTestId(m1, phoneCompositionFpsTestId(24))
  await tapTestId(m1, 'phone-compositions-duration-plus-10')
  await tapTestId(m1, COMPS.formBack)
  await expect(m1.page.getByTestId(COMPS.list)).toBeVisible()
  expect(await activeComposition(m1), 'Back must not change the settings').toMatchObject({ frameRate: original.frameRate, duration: original.duration })

  target = await openRowMore(m1, original.id)
  await tapOn(m1, target.getByTestId(COMPS.settings))
  await tapTestId(m1, phoneCompositionFpsTestId(24))
  await tapTestId(m1, 'phone-compositions-duration-plus-10')
  await tapTestId(m1, COMPS.formSubmit)
  await expect.poll(async () => { const comp = await activeComposition(m1); return [comp.frameRate, comp.duration] }).toEqual([24, original.duration + 10])
  await closeSheet(m1)
  await tapUndo(m1)
  await expect.poll(async () => { const comp = await activeComposition(m1); return [comp.frameRate, comp.duration] }, { message: 'one Undo did not restore the settings' })
    .toEqual([original.frameRate, original.duration])
})

test('precompose-selection: Nest moves the selected clip into a new composition, the picture stays, one Undo restores it @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a] = state.main
  await seekToFrame(m1, 0.5, 15, 'clip A before nesting')
  await selectOnly(m1, a.id)
  const countBefore = (await compositions(m1)).length
  await openCompositions(m1)
  await tapTestId(m1, COMPS.nest)
  await expect.poll(async () => (await compositions(m1)).length, { message: 'nesting did not create a composition' }).toBe(countBefore + 1)
  await expect.poll(async () => (await m1.timeline()).all.some(clip => clip.id === a.id), { message: 'clip A is still on the timeline' }).toBe(false)
  await expect.poll(async () => (await m1.timeline()).main.some(clip => clip.id !== a.id && clip.start < 0.01), { message: 'a composition clip takes A\'s place' }).toBe(true)
  await expect(m1.page.locator(`[data-testid="${COMPS.nested}"]`)).toHaveCount(1)
  await closeSheet(m1)
  await expectFrame(m1, 15, 'the nested composition shows the same picture')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await m1.timeline()).all.some(clip => clip.id === a.id), { message: 'one Undo did not bring clip A back' }).toBe(true)
  await expectFrame(m1, 15, 'clip A after Undo')
})

test('nest-compositions: entering a nested composition shows the way back in the top bar @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const parent = (await m1.timeline()).activeCompositionId!
  await selectOnly(m1, state.main[0].id)
  await openCompositions(m1)
  await tapTestId(m1, COMPS.nest)
  await expect(m1.page.locator(`[data-testid="${COMPS.nested}"]`)).toHaveCount(1)
  const nestedId = await m1.page.getByTestId(COMPS.nested).getAttribute('data-composition-id')
  await tapTestId(m1, COMPS.nested)
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'Enter did not open the nested composition' }).toBe(nestedId)
  await expect(m1.sheet).toBeHidden()
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'the nested composition holds clip A' }).toBe(1)
  const back = m1.page.getByTestId(COMPS.topBarBack)
  await expect(back).toBeVisible()
  await tapOn(m1, back)
  await expect.poll(async () => (await m1.timeline()).activeCompositionId, { message: 'the back crumb did not return to the parent' }).toBe(parent)
  await expect(back).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

test('create-delete-tracks: add, rename and hide in one session; Done is one undo step @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await waitForSettledHistory(m1)
  await seekToFrame(m1, 0.5, 15, 'clip A before the tracks sheet')
  const lit = await previewPixels(m1.probe)
  const before = await tracks(m1)
  const mainTrackId = state.main[0].trackId
  await openRootSheet(m1, 'tracks')
  await tapTestId(m1, TRACKS.addVideo)
  await expect(m1.page.getByTestId(TRACKS.row)).toHaveCount(before.length + 1)
  const mainRow = row(m1, TRACKS.row, 'data-track-id', mainTrackId)
  await tapOn(m1, mainRow.getByTestId(TRACKS.more))
  await mainRow.getByTestId(TRACKS.renameInput).fill('Main picture')
  await tapOn(m1, mainRow.getByTestId(TRACKS.renameApply))
  await tapOn(m1, mainRow.getByTestId(TRACKS.visible))
  await expect(mainRow).toHaveAttribute('data-hidden', 'true')
  await expect.poll(async () => differingShare(lit, await previewPixels(m1.probe)), { message: 'hiding the track did not change the picture', timeout: 15_000 }).toBeGreaterThan(0.2)
  await tapDone(m1)
  const after = await tracks(m1)
  expect(after.length).toBe(before.length + 1)
  expect(after.find(track => track.id === mainTrackId)).toMatchObject({ name: 'Main picture', visible: false })
  await tapUndo(m1)
  await expect.poll(async () => (await tracks(m1)).map(track => [track.id, track.name, track.visible]), { message: 'one Undo did not restore every track change' })
    .toEqual(before.map(track => [track.id, track.name, track.visible]))
  await expectFrame(m1, 15, 'clip A is visible again after Undo')
})

test('track-order-name-colour-target: Cancel rolls back a hidden track and a new audio track exactly @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await waitForSettledHistory(m1)
  await seekToFrame(m1, 0.5, 15, 'clip A before the tracks sheet')
  const before = await tracks(m1)
  await openRootSheet(m1, 'tracks')
  await tapTestId(m1, TRACKS.addAudio)
  const mainRow = row(m1, TRACKS.row, 'data-track-id', state.main[0].trackId)
  await tapOn(m1, mainRow.getByTestId(TRACKS.visible))
  await expect(mainRow).toHaveAttribute('data-hidden', 'true')
  await tapCancel(m1)
  await expect.poll(async () => (await tracks(m1)).map(track => [track.id, track.name, track.visible]), { message: 'Cancel left track changes behind' })
    .toEqual(before.map(track => [track.id, track.name, track.visible]))
  await expectFrame(m1, 15, 'clip A after Cancel')
})

test('INV-1/track-audio-controls: level and pan of an audio track by touch; Done is one undo step, Cancel changes nothing @phone', async ({ m1 }) => {
  await openRootSheet(m1, 'tracks')
  await tapTestId(m1, TRACKS.addAudio)
  await tapDone(m1)
  const audio = (await handoffState(m1)).tracks.filter(track => track.type === 'audio').at(-1)!
  const before = (await handoffState(m1)).tracks

  await openRootSheet(m1, 'tracks')
  const audioRow = row(m1, TRACKS.row, 'data-track-id', audio.id)
  await tapOn(m1, audioRow.getByTestId(TRACKS.more))
  await tapRange(m1, audioRow.getByTestId(TRACKS.volumeSlider), 0.25)
  await tapRange(m1, audioRow.getByTestId(TRACKS.panSlider), 0.9)
  await expect.poll(async () => (await handoffState(m1)).tracks.find(track => track.id === audio.id)?.volumeDb, { message: 'the level did not follow the slider' }).toBeLessThan(-20)
  await tapCancel(m1)
  await expect.poll(async () => (await handoffState(m1)).tracks, { message: 'Cancel left a level or pan behind' }).toEqual(before)

  await openRootSheet(m1, 'tracks')
  await tapOn(m1, audioRow.getByTestId(TRACKS.more))
  await tapRange(m1, audioRow.getByTestId(TRACKS.volumeSlider), 0.25)
  await tapRange(m1, audioRow.getByTestId(TRACKS.panSlider), 0.9)
  await tapDone(m1)
  const after = (await handoffState(m1)).tracks.find(track => track.id === audio.id)!
  expect(after.volumeDb, 'the level is kept').toBeLessThan(-20)
  expect(after.pan, 'the pan is kept, to the right').toBeGreaterThan(0.5)
  await undoFromTimeline(m1)
  await expect.poll(async () => (await handoffState(m1)).tracks, { message: 'one Undo did not restore level and pan' }).toEqual(before)
})

test('INV-4/audio-track-management: Mixer keeps the sheet\'s rename as one undo step and opens the landscape mixer @phone', async ({ m1 }) => {
  await openRootSheet(m1, 'tracks')
  await tapTestId(m1, TRACKS.addAudio)
  await tapDone(m1)
  const before = (await handoffState(m1)).tracks
  const audio = before.filter(track => track.type === 'audio').at(-1)!
  await openRootSheet(m1, 'tracks')
  const audioRow = row(m1, TRACKS.row, 'data-track-id', audio.id)
  await tapOn(m1, audioRow.getByTestId(TRACKS.more))
  await audioRow.getByTestId(TRACKS.renameInput).fill('Music bus')
  await tapOn(m1, audioRow.getByTestId(TRACKS.renameApply))
  await tapTestId(m1, TRACKS.mixer)
  const state = await expectHandedOver(m1, 'mixer')
  expect(state.tracks.find(track => track.id === audio.id)?.name, 'the rename was kept before the mixer opened').toBe('Music bus')
  await expect(m1.page.locator('.audio-mixer-panel'), 'the desktop mixer renders in the editor').toBeVisible()
  await undoFromTimeline(m1)
  await expect.poll(async () => (await handoffState(m1)).tracks, { message: 'one Undo did not take the rename back' }).toEqual(before)
})

test('INV-4/audio-midi-tracks-clips: + MIDI adds a MIDI track; Edit notes keeps it and opens the piano roll; one Undo removes it @phone', async ({ m1 }) => {
  const before = (await handoffState(m1)).tracks
  await openRootSheet(m1, 'tracks')
  await tapTestId(m1, TRACKS.addMidi)
  const midiRow = m1.page.locator(`[data-testid="${TRACKS.row}"][data-track-type="midi"]`)
  await expect(midiRow, 'the MIDI track is listed').toHaveCount(1)
  await tapOn(m1, midiRow.getByTestId(TRACKS.more))
  await tapOn(m1, midiRow.getByTestId(TRACKS.editNotes))
  const state = await expectHandedOver(m1, 'pianoRoll')
  expect(state.tracks.filter(track => track.type === 'midi'), 'the MIDI track was kept before the piano roll opened').toHaveLength(1)
  await undoFromTimeline(m1)
  await expect.poll(async () => (await handoffState(m1)).tracks, { message: 'one Undo did not remove the MIDI track' }).toEqual(before)
})

test('INV-5/path-traced-rendering: settings switch the 3D render engine as one undo step @phone', async ({ m1 }) => {
  const active = await activeComposition(m1)
  expect((await handoffState(m1)).renderEngine).toBe('raster')
  await openCompositions(m1)
  const target = await openRowMore(m1, active.id)
  await tapOn(m1, target.getByTestId(COMPS.settings))
  await tapTestId(m1, `${COMPS.renderEngine}-path-traced`)
  await expect.poll(async () => (await handoffState(m1)).renderEngine, { message: 'the engine did not switch' }).toBe('path-traced')
  await expect(m1.page.getByTestId(`${COMPS.renderEngine}-path-traced`)).toHaveAttribute('aria-pressed', 'true')
  await tapTestId(m1, COMPS.greyedAdvanced)
  expect(await dismissNotice(m1), 'the background colour explains why it is greyed').toMatch(/does not draw it/)
  await closeSheet(m1)
  await undoFromTimeline(m1)
  await expect.poll(async () => (await handoffState(m1)).renderEngine, { message: 'one Undo did not bring Raster back' }).toBe('raster')
})

test('INV-1/composition-graph: Node graph opens the Nodes editor on the open composition with no clip selected @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await waitForSettledHistory(m1)
  await selectOnly(m1, state.main[0].id)
  await openCompositions(m1)
  await tapTestId(m1, `${COMPS.nodeGraph}-list`)
  const after = await expectHandedOver(m1, 'nodes')
  expect(after.selected, 'the composition graph shows, not a clip graph').toEqual([])
  expect((await m1.timeline()).activeCompositionId).toBe(state.activeCompositionId)
})

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

test('markers: add at the playhead with label and colour, jump to it; Done is one undo step, Cancel adds nothing @phone', async ({ m1 }) => {
  await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await waitForSettledHistory(m1)
  await seek(m1, 1)
  await openRootSheet(m1, 'markers')
  await m1.page.getByTestId(MARKERS.labelInput).fill('Cue')
  await tapTestId(m1, `${MARKERS.color}-1`)
  await tapTestId(m1, MARKERS.add)
  await expect(m1.page.getByTestId(MARKERS.row)).toHaveCount(1)
  await tapCancel(m1)
  expect(await markers(m1), 'Cancel must not keep the marker').toEqual([])

  await openRootSheet(m1, 'markers')
  await m1.page.getByTestId(MARKERS.labelInput).fill('Cue')
  await tapTestId(m1, `${MARKERS.color}-1`)
  await tapTestId(m1, MARKERS.add)
  await tapDone(m1)
  const added = await markers(m1)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ label: 'Cue', color: '#e2514c' })
  expect(added[0].time).toBeCloseTo(1, 4)
  // Jump: from 0 back to the marker by touch (navigation, the sheet stays open).
  await seek(m1, 0)
  await openRootSheet(m1, 'markers')
  await tapTestId(m1, MARKERS.jump)
  await expect.poll(async () => (await m1.timeline()).playhead, { message: 'tapping the marker did not jump there' }).toBeCloseTo(1, 4)
  await expectFrame(m1, 30, 'the preview shows the marker frame')
  await tapCancel(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await markers(m1)).length, { message: 'one Undo did not remove the marker' }).toBe(0)
})

// ---------------------------------------------------------------------------
// Trim modes
// ---------------------------------------------------------------------------

async function openEdits(m1: M1Session, clipId: string): Promise<void> {
  await selectOnly(m1, clipId)
  await tapAction(m1, phoneActionTestId('edits'))
  await expect(m1.sheet, 'the trim modes sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(EDITS.status)).toBeVisible()
}

test('ripple-trim + slip-edit: ripple the start to the playhead, slip 10 frames; Done is one undo step @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a, b] = state.main
  await seek(m1, 1)
  await openEdits(m1, a.id)
  await tapTestId(m1, EDITS.rippleStart)
  await expect.poll(async () => (await m1.timeline()).main.find(clip => clip.id === a.id)?.inPoint, { message: 'ripple trim did not cut A' }).toBeCloseTo(1, 3)
  await expect.poll(async () => (await m1.timeline()).main.find(clip => clip.id === b.id)?.start, { message: 'B did not move up' }).toBeCloseTo(3, 3)
  await tapTestId(m1, `${EDITS.tab}-slip`)
  await tapTestId(m1, `${EDITS.slip}-minus-10`)
  await expect(m1.page.getByTestId(`${EDITS.slip}-value`)).toHaveText('−10 f')
  await tapDone(m1)
  // A now starts at source 1 s − 10 f: at 0.5 s the picture is frame 30 − 10 + 15 = 35.
  await seekToFrame(m1, 0.5, 35, 'A after ripple trim and slip')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await m1.timeline()).main.find(clip => clip.id === b.id)?.start, { message: 'one Undo did not restore B' }).toBeCloseTo(4, 3)
  await expectFrame(m1, 15, 'one Undo restores A')
})

test('slip-edit: Cancel rolls back a ripple trim and a slip exactly @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a] = state.main
  await seek(m1, 1)
  const before = JSON.stringify((await m1.timeline()).all)
  await openEdits(m1, a.id)
  await tapTestId(m1, EDITS.rippleStart)
  await expect.poll(async () => (await m1.timeline()).main.find(clip => clip.id === a.id)?.inPoint).toBeCloseTo(1, 3)
  await tapTestId(m1, `${EDITS.tab}-slip`)
  await tapTestId(m1, `${EDITS.slip}-minus-1`)
  await tapCancel(m1)
  await expect.poll(async () => JSON.stringify((await m1.timeline()).all), { message: 'Cancel left trim changes behind' }).toBe(before)
  await seekToFrame(m1, 0.5, 15, 'A after Cancel')
})

test('rolling-edit: the cut moves with the neighbour, nothing else moves; one Undo restores it @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a, b] = state.main
  // Give B footage before its in point: ripple its start to 4.5 s (B now uses source 0.5 s on).
  await seek(m1, 4.5)
  await openEdits(m1, b.id)
  await tapTestId(m1, EDITS.rippleStart)
  await expect.poll(async () => (await m1.timeline()).main.find(clip => clip.id === b.id)?.inPoint).toBeCloseTo(0.5, 3)
  await tapTestId(m1, `${EDITS.tab}-roll`)
  await tapTestId(m1, `${EDITS.rollSide}-start`)
  await tapTestId(m1, `${EDITS.roll}-minus-10`)
  await expect(m1.page.getByTestId(`${EDITS.roll}-value`)).toHaveText('−10 f')
  await tapDone(m1)
  const after = (await m1.timeline()).main
  expect(after.find(clip => clip.id === a.id)!.duration).toBeCloseTo(4 - 10 / 30, 3)
  expect(after.find(clip => clip.id === b.id)!.start).toBeCloseTo(4 - 10 / 30, 3)
  expect(after.find(clip => clip.id === b.id)!.start + after.find(clip => clip.id === b.id)!.duration, 'B keeps its end').toBeCloseTo(6.5, 3)
  // At 3.8 s the picture now comes from B: source 0.5 s − 10 f + (3.8 s − 3.667 s) = frame 9.
  await seekToFrame(m1, 3.8, 9, 'B after the roll')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expectFrame(m1, 114, 'one Undo restores A at 3.8 s')
})

test('close-gaps + link-clips: modes without room explain themselves instead of failing silently @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await waitForSettledHistory(m1)
  await openEdits(m1, state.main[0].id)
  await tapTestId(m1, `${EDITS.tab}-slide`)
  await expect(m1.page.getByTestId(`${EDITS.slide}-plus-1`)).toHaveAttribute('aria-disabled', 'true')
  await tapTestId(m1, `${EDITS.slide}-plus-1`)
  await expect(m1.page.getByTestId(IDS.unavailableNotice)).toContainText(/touching each side/)
  await tapOn(m1, m1.page.getByTestId(IDS.unavailableNotice).getByRole('button', { name: 'OK' }))
  await tapTestId(m1, `${EDITS.tab}-slip`)
  await expect(m1.page.getByTestId(`${EDITS.slip}-minus-1`), 'a full clip has no footage to slip').toHaveAttribute('aria-disabled', 'true')
  await tapTestId(m1, `${EDITS.tab}-link`)
  await tapTestId(m1, EDITS.link)
  await expect(m1.page.getByTestId(EDITS.message)).toContainText(/No unlinked clip/)
  await tapCancel(m1)
})

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

test('timeline-source-maintenance: replace with a video from the phone keeps the clip in place; Done is one undo step @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a] = state.main
  const originalMedia = await mediaIdOf(m1, a.id)
  await seekToFrame(m1, 3.5, 105, 'A at 3.5 s before replacing')
  await selectOnly(m1, a.id)
  await tapAction(m1, phoneActionTestId('replace'))
  await expect(m1.sheet).toBeVisible()
  await m1.page.getByTestId(REPLACE.input).setInputFiles(m1.media.short.path)
  await expect.poll(async () => await mediaIdOf(m1, a.id), { message: 'the picked video did not replace the source', timeout: 60_000 }).not.toBe(originalMedia)
  await tapDone(m1)
  const after = (await m1.timeline()).main.find(clip => clip.id === a.id)!
  expect([after.start, after.duration], 'the clip keeps its place and length').toEqual([a.start, a.duration])
  await seek(m1, 0.5)
  await expectFrame(m1, 15, 'the short clip shows at 0.5 s')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => await mediaIdOf(m1, a.id), { message: 'one Undo did not bring the original footage back' }).toBe(originalMedia)
  await seekToFrame(m1, 3.5, 105, 'A at 3.5 s after Undo')
})

test('timeline-source-maintenance: Cancel puts the original footage back after choosing a project video @phone', async ({ m1 }) => {
  const state = await importAB(m1)
  const [a, b] = state.main
  const originalMedia = await mediaIdOf(m1, a.id)
  const otherMedia = await mediaIdOf(m1, b.id)
  await seekToFrame(m1, 3.5, 105, 'A at 3.5 s before replacing')
  await selectOnly(m1, a.id)
  await tapAction(m1, phoneActionTestId('replace'))
  await expect(m1.sheet).toBeVisible()
  await tapOn(m1, row(m1, REPLACE.media, 'data-media-id', otherMedia!))
  await expect.poll(async () => await mediaIdOf(m1, a.id), { message: 'choosing B did not replace the source live' }).toBe(otherMedia)
  await expect(m1.page.getByTestId(REPLACE.message), 'B is shorter than what A uses: the sheet says so').toContainText(/shorter/)
  await tapCancel(m1)
  await expect.poll(async () => await mediaIdOf(m1, a.id), { message: 'Cancel did not restore the original footage' }).toBe(originalMedia)
  await expectFrame(m1, 105, 'A at 3.5 s after Cancel')
})
