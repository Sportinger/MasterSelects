import { expect, importViaSheet, seek, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { waitForSettledHistory } from './m2DesignFixture'
import { closeEditorIfOpen, openEditor, proveSidesRemembered, turnLandscape, turnPortrait, undoInEditor, WS } from './m4R4Fixture'

/**
 * M4 packet R4, the Multicam editor (catalog INV-1/multicam-build-and-cut,
 * INV-1/multi-preview-and-pinned-compositions): the desktop Multi Preview panel in the phone's
 * landscape editor. Real touch (CDP) only; the bridge arranges the two camera tracks (not under
 * test) and reads the timeline. Truth: the program clips in the store and the panel's on-air frame,
 * which the panel derives from the store (getProgramAngleIndex).
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => {
  await closeEditorIfOpen(m1)
  await turnPortrait(m1)
})

const slots = (m1: M1Session) => m1.page.getByTestId(WS.main).getByTestId('multi-preview-slot')
const toggle = (m1: M1Session) => m1.page.getByTestId(WS.main).locator('.multi-preview-multicam-toggle')

interface TrackState { id: string; clips: Array<{ id: string; startTime: number; duration: number }> }

async function videoTracks(m1: M1Session): Promise<TrackState[]> {
  return (await m1.bridge.toolData<{ videoTracks: TrackState[] }>('getTimelineState')).videoTracks
}

/** Which video track carries a clip at `time`, as `trackIndex:clipStart+duration` per track (program signature). */
async function programSignature(m1: M1Session): Promise<string> {
  const tracks = await videoTracks(m1)
  return tracks.map((track, index) => `${index}:${track.clips.map(clip => `${clip.startTime.toFixed(3)}+${clip.duration.toFixed(3)}`).toSorted().join(',')}`).join('|')
}

/** Clip A on the main track, clip B on a second video track from 0 s: two synchronized cameras. */
async function arrangeTwoCameras(m1: M1Session): Promise<void> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  const before = (await videoTracks(m1)).map(track => track.id)
  await m1.bridge.toolData('createTrack', { type: 'video' })
  let added: string | undefined
  await expect.poll(async () => { added = (await videoTracks(m1)).map(track => track.id).find(id => !before.includes(id)); return Boolean(added) }).toBe(true)
  const clipB = state.main[1]
  await m1.bridge.toolData('moveClip', { clipId: clipB.id, newStartTime: 0, newTrackId: added })
  await expect.poll(async () => (await videoTracks(m1)).filter(track => track.clips.length > 0).length, { message: 'camera B did not move to its own track' }).toBe(2)
  await waitForIdle(m1)
  await seek(m1, 1)
  await waitForSettledHistory(m1)
}

test('multicam-build-and-cut: Multicam opens from Editors; its side panel collapses, expands and survives a reload @phone', async ({ m1 }) => {
  await turnLandscape(m1)
  await openEditor(m1, 'multicam')
  await expect(slots(m1), 'the four preview slots fill the editor').toHaveCount(4)
  await proveSidesRemembered(m1, 'multicam', ['right'])
})

test('multicam-build-and-cut: Multicam with one camera says why it cannot start @phone', async ({ m1 }) => {
  await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await turnLandscape(m1)
  await openEditor(m1, 'multicam')
  await tapOn(m1, toggle(m1))
  await expect(m1.page.getByTestId('multi-preview-status'), 'a refused Multicam stays silent').toContainText(/two video tracks/i)
  await expect(toggle(m1)).toHaveAttribute('aria-pressed', 'false')
})

test('multi-preview-and-pinned-compositions: the source layout switches by touch and the slots follow @phone', async ({ m1 }) => {
  await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  const compositionName = (await m1.bridge.toolData<{ activeCompositionName?: string }>('getTimelineState')).activeCompositionName
  expect(compositionName).toBeTruthy()
  await turnLandscape(m1)
  await openEditor(m1, 'multicam')
  const main = m1.page.getByTestId(WS.main)
  await expect(main.locator('.multi-preview-slot-dropdown-btn'), 'custom layout: every slot has its own composition picker').toHaveCount(4)
  await expect(main.locator('.multi-preview-slot-dropdown-wrapper').first(), 'touch has no hover: the picker is visible').toHaveCSS('opacity', '1')

  await tapOn(m1, main.locator('.preview-comp-dropdown-btn'))
  await tapOn(m1, main.locator('.preview-comp-dropdown .preview-comp-option', { hasText: compositionName! }))
  await expect(main.locator('.multi-preview-slot-label', { hasText: 'Layer 1' }), 'the composition layout did not apply on the phone').toBeVisible()
  await expect(main.locator('.preview-comp-dropdown-btn')).toContainText(compositionName!)

  await tapOn(m1, main.locator('.preview-comp-dropdown-btn'))
  await tapOn(m1, main.locator('.preview-comp-dropdown .preview-comp-option', { hasText: 'Custom' }))
  await expect(main.locator('.multi-preview-slot-dropdown-btn')).toHaveCount(4)
})

test('multicam-build-and-cut: tapping a camera cuts to it at the playhead; one Undo restores the program @phone', async ({ m1 }) => {
  await arrangeTwoCameras(m1)
  await turnLandscape(m1)
  await openEditor(m1, 'multicam')
  await tapOn(m1, toggle(m1))
  await expect(toggle(m1), 'Multicam did not turn on').toHaveAttribute('aria-pressed', 'true')
  const angles = slots(m1).and(m1.page.locator('[data-multicam-angle]'))
  await expect(angles, 'both cameras show in the slots').toHaveCount(2)
  const onAir = slots(m1).and(m1.page.locator('[data-on-air="true"]'))
  await expect(onAir, 'one camera is on air at the playhead').toHaveCount(1)
  const firstOnAir = await onAir.getAttribute('data-multicam-angle')
  const other = firstOnAir === '0' ? '1' : '0'
  await waitForSettledHistory(m1)
  const before = await programSignature(m1)

  // A tap on the camera already on air says so and changes nothing.
  await tapOn(m1, slots(m1).and(m1.page.locator(`[data-multicam-angle="${firstOnAir}"]`)))
  await expect(m1.page.getByTestId('multi-preview-status')).toContainText(/already on air/i)
  expect(await programSignature(m1)).toBe(before)

  await tapOn(m1, slots(m1).and(m1.page.locator(`[data-multicam-angle="${other}"]`)))
  await expect(onAir, 'the tapped camera did not go on air').toHaveAttribute('data-multicam-angle', other)
  await expect.poll(() => programSignature(m1), { message: 'the cut did not change the program clips' }).not.toBe(before)

  await waitForSettledHistory(m1)
  await undoInEditor(m1)
  await expect.poll(() => programSignature(m1), { message: 'one Undo did not restore the program' }).toBe(before)
  await expect(onAir).toHaveAttribute('data-multicam-angle', firstOnAir!)
})
