import { PHONE_EXPORT_TEST_IDS as EXPORT, phoneExportFormatTestId, phoneExportOptionTestId } from '../../../src/components/mobileSkin/export/phoneExportTestIds'
import { PHONE_ASSISTANT_TEST_IDS as ASSISTANT } from '../../../src/components/mobileSkin/assistant/phoneAssistantTestIds'
import {
  PHONE_BAKE_TEST_IDS as BAKE, PHONE_CLIP_DETAILS_TEST_IDS as DETAILS, PHONE_TIMELINE_CONTROLS_TEST_IDS as ROW,
  PHONE_TIMELINE_TOOLS_TEST_IDS as TOOLS, phoneGridChipTestId,
} from '../../../src/components/mobileSkin/timelineTools/phoneTimelineToolsTestIds'
import {
  FPS, M1_IDS, TOPBAR_EXPORT, differingShare, expect, previewPixels, probeVideo, seek, tapForDownload, tapOn, test, type M1Session,
} from './m1Fixture'
import { openClipSheet, openRootSheet, tapCancel, tapDone, tapUndo } from './m2DesignFixture'
import { dismissNotice, expectFrame, importAB, seekToFrame, selectOnly, tapTestId } from './m3TimelineFixture'
import { visibleCentre } from './phoneFixture'
import { clipState, expectNoOpenGesture, g1State, resetTimelinePrefs } from './m7TimelineFixture'

/**
 * G1 timeline tools (phone gaps of INV-1/3/4/5): snapping and the beat grid, the in/out range,
 * clip details (name, source colour), parenting (clip, track, null object), view options, the tempo
 * map and metronome, video bake regions and the range comparison, one catalog case per test in the
 * M1 phone world (m1Fixture.ts: a fresh 1080x1920 / 30 fps composition per test). Every action under
 * test is real touch on the phone UI; the bridge/probe only arranges (playhead, preferences) and
 * inspects. Edits: Done is one undo step, Cancel changes nothing. Truth is the preview's frame codes
 * where a picture is one frame of one clip, the exported file for the range, store state otherwise.
 *
 * Media: A = 4 s (frames 0..119) at 0 s, B = 3 s (frames 0..89) at 4 s, 360x640 at 30 fps.
 */
test.describe.configure({ timeout: 240_000 })

test.beforeEach(async ({ m1 }) => { await resetTimelinePrefs(m1) })
test.afterEach(async ({ m1 }) => { await resetTimelinePrefs(m1) })

async function openTimelineTab(m1: M1Session, tab: string): Promise<void> {
  await openRootSheet(m1, 'timeline-tools')
  await tapTestId(m1, tab)
  await expect(m1.page.getByTestId(TOOLS.root)).toBeVisible()
}

/** Drags B's start trim handle right by `px` CSS pixels with one finger. */
async function dragStartHandle(m1: M1Session, clipId: string, px: number): Promise<void> {
  const handle = m1.page.getByTestId(M1_IDS.trimHandleStart)
  await expect(m1.clip(clipId)).toHaveAttribute('aria-selected', 'true')
  await expect(handle).toBeVisible()
  await m1.touch.pan(await visibleCentre(handle, m1.surface), { x: px, y: 0 })
}

test('INV-1/snapping-and-grid: with the magnet and the beat grid on a trim lands exactly on a beat; off it moves freely @phone', async ({ m1 }) => {
  const { main: [, b] } = await importAB(m1)
  // Beat grid at the default 60 BPM, divided into eighths (0.5 s apart).
  await openTimelineTab(m1, TOOLS.tabSnap)
  await tapTestId(m1, TOOLS.gridSwitch)
  await tapTestId(m1, phoneGridChipTestId('1/8'))
  await tapDone(m1)
  await tapTestId(m1, ROW.snap)
  await expect(m1.page.getByTestId(ROW.snap)).toHaveAttribute('aria-pressed', 'true')
  expect(await g1State(m1)).toMatchObject({ snapping: true, beatGrid: true, subdivision: '1/8' })
  await expect(m1.page.getByTestId(ROW.beat).first(), 'the ruler draws the beats').toBeAttached()

  await seek(m1, 5)
  await tapOn(m1, m1.clip(b.id))
  const pxPerSecond = (await m1.clip(b.id).boundingBox())!.width / b.duration
  // 0.43 s right: free would be frame 13, the nearest eighth is 4.5 s (0.5 s into B).
  await dragStartHandle(m1, b.id, Math.round(pxPerSecond * 0.43))
  await expect.poll(async () => (await clipState(m1, b.id)).startTime, { message: 'the trimmed start did not snap to the beat' }).toBeCloseTo(4.5, 6)
  await seekToFrame(m1, 4.5 + 0.5 / FPS, 15, 'B starts with its frame 15 on the beat')

  await tapUndo(m1)
  await expect.poll(async () => (await clipState(m1, b.id)).startTime).toBeCloseTo(4, 6)
  // Magnet off: the same drag moves freely to a frame that is not on the beat.
  await tapTestId(m1, ROW.snap)
  await expect(m1.page.getByTestId(ROW.snap)).toHaveAttribute('aria-pressed', 'false')
  await seek(m1, 5)
  await dragStartHandle(m1, b.id, Math.round(pxPerSecond * 0.43))
  await expect.poll(async () => (await clipState(m1, b.id)).startTime, { message: 'the free trim did not move' }).toBeGreaterThan(4.2)
  expect(Math.abs((await clipState(m1, b.id)).startTime - 4.5), 'without the magnet the edge does not snap').toBeGreaterThan(1 / FPS / 2)
})

test('INV-1/composition-in-out: In/Out under the timeline mark 30 frames; the band shows and the export has exactly 30 frames @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(360_000)
  await importAB(m1)
  await seek(m1, 1)
  await tapTestId(m1, ROW.setIn)
  await seek(m1, 2)
  await tapTestId(m1, ROW.setOut)
  await expect.poll(async () => { const s = await g1State(m1); return [s.inPoint, s.outPoint] }).toEqual([1, 2])
  const band = m1.page.getByTestId(ROW.rangeBand)
  await expect(band, 'the ruler shows the range').toHaveAttribute('data-in', '1')
  await expect(band).toHaveAttribute('data-out', '2')
  // The Range tab reads it back and Cancel keeps a nudge from sticking.
  await openTimelineTab(m1, TOOLS.tabRange)
  await expect(m1.page.getByTestId(TOOLS.rangeSummary)).toHaveAttribute('data-frames', '30')
  await tapTestId(m1, `${TOOLS.rangeOutStep}-plus-10`)
  await expect(m1.page.getByTestId(TOOLS.rangeSummary)).toHaveAttribute('data-frames', '40')
  await tapCancel(m1)
  expect((await g1State(m1)).outPoint, 'Cancel restores the range').toBe(2)

  await tapOn(m1, m1.page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet).toBeVisible()
  const toggle = m1.page.getByTestId(EXPORT.advancedToggle)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await tapOn(m1, toggle)
  for (const id of [phoneExportFormatTestId('mp4-h264'), phoneExportOptionTestId('resolution', 480), phoneExportOptionTestId('range', 'in-out')]) {
    await tapTestId(m1, id)
    await expect(m1.page.getByTestId(id)).toHaveAttribute('aria-pressed', 'true')
  }
  await tapOn(m1, m1.page.getByTestId(M1_IDS.exportStart))
  await expect(m1.page.getByTestId(M1_IDS.exportSave), 'the export never finished').toHaveAttribute('aria-disabled', 'false', { timeout: 240_000 })
  const { file } = await tapForDownload(m1, m1.page.getByTestId(M1_IDS.exportSave), testInfo, 'range')
  expect((await probeVideo(file)).frames, 'the export holds exactly the 30 marked frames').toBe(30)
})

test('INV-1/parent-clips-and-tracks: Details parents B to A without a jump; a loop is refused visibly; one Undo restores @phone', async ({ m1 }) => {
  const { main: [a, b] } = await importAB(m1)
  await seekToFrame(m1, 5, 30, 'B at its frame 30')
  // Reference with B selected, as it is while the sheet works (a selection draws on the preview).
  await selectOnly(m1, b.id)
  await expectFrame(m1, 30, 'B selected at its frame 30')
  const before = await previewPixels(m1.probe)
  await openClipSheet(m1, b.id, 'clip-details')
  await tapTestId(m1, `${DETAILS.parentOption}-${a.id}`)
  await expect(m1.page.getByTestId(DETAILS.message)).toContainText('Parented')
  await tapDone(m1)
  await expectNoOpenGesture(m1)
  expect((await clipState(m1, b.id)).parentClipId).toBe(a.id)
  await expectFrame(m1, 30, 'B still shows frame 30')
  await expect.poll(async () => differingShare(before, await previewPixels(m1.probe)), { message: 'parenting moved the picture', timeout: 15_000 }).toBeLessThan(0.01)

  // A under B would be a loop: the sheet says why and nothing changes.
  await seek(m1, 1)
  await openClipSheet(m1, a.id, 'clip-details')
  await tapTestId(m1, `${DETAILS.parentOption}-${b.id}`)
  await expect(m1.page.getByTestId(DETAILS.message)).toHaveClass(/error/)
  await tapCancel(m1)
  expect((await clipState(m1, a.id)).parentClipId).toBeNull()

  await tapUndo(m1)
  await expect.poll(async () => (await clipState(m1, b.id)).parentClipId, { message: 'one Undo did not clear the parent' }).toBeNull()
})

test('INV-1/clip-labels-and-identity: Details colours the source, the tile shows it, rename explains itself; Cancel keeps nothing @phone', async ({ m1 }) => {
  const { main: [a] } = await importAB(m1)
  await seek(m1, 1)
  await openClipSheet(m1, a.id, 'clip-details')
  await expect(m1.page.getByTestId(DETAILS.span)).toHaveAttribute('data-duration', '4')
  await tapTestId(m1, DETAILS.renameGreyed)
  expect(await dismissNotice(m1)).toMatch(/media/)
  await tapTestId(m1, `${DETAILS.color}-red`)
  await expect(m1.page.getByTestId(`${DETAILS.color}-red`)).toHaveAttribute('aria-pressed', 'true')
  await tapCancel(m1)
  expect((await clipState(m1, a.id)).label, 'Cancel keeps no colour').toBe('none')

  await openClipSheet(m1, a.id, 'clip-details')
  await tapTestId(m1, `${DETAILS.color}-red`)
  await tapDone(m1)
  expect((await clipState(m1, a.id)).label).toBe('red')
  await expect(m1.clip(a.id), 'the tile shows the source colour').toHaveAttribute('data-label-color', '#e2514c')
  await expectFrame(m1, 30, 'the picture is unchanged')
  await tapUndo(m1)
  await expect.poll(async () => (await clipState(m1, a.id)).label, { message: 'one Undo did not remove the colour' }).toBe('none')
})

test('INV-1/timeline-view-options: video focus grows the main lane, thumbnails switch off, frames stay; Cancel restores @phone', async ({ m1 }) => {
  const { main: [a] } = await importAB(m1)
  await seekToFrame(m1, 1, 30, 'A at frame 30')
  const tileHeight = async () => (await m1.clip(a.id).boundingBox())!.height
  const balanced = await tileHeight()
  await openTimelineTab(m1, TOOLS.tabView)
  await tapTestId(m1, `${TOOLS.viewFocus}-video`)
  await tapTestId(m1, TOOLS.viewThumbnails)
  await expect.poll(tileHeight, { message: 'video focus did not grow the main lane' }).toBeGreaterThan(balanced + 8)
  await expect(m1.clip(a.id).locator('.phone-clip__filmstrip'), 'thumbnails are off').toHaveCount(0)
  await tapTestId(m1, TOOLS.viewMoreLanes)
  expect(await dismissNotice(m1)).toMatch(/full editor/)
  await expectFrame(m1, 30, 'the frame stays the same')
  await tapCancel(m1)
  expect(await g1State(m1)).toMatchObject({ focus: 'balanced', thumbnails: true })
  await expect.poll(tileHeight).toBeCloseTo(balanced, 0)
})

test('INV-1/tempo-map: faster project tempo and a change at the playhead are one undo step; video keeps its time @phone', async ({ m1 }) => {
  const { main: [a, b] } = await importAB(m1)
  await seek(m1, 2)
  await openTimelineTab(m1, TOOLS.tabTempo)
  await tapTestId(m1, `${TOOLS.tempoBpm}-plus-10`)
  await expect(m1.page.getByTestId(`${TOOLS.tempoBpm}-value`)).toHaveText('70 BPM')
  await tapTestId(m1, TOOLS.tempoAdd)
  await expect(m1.page.getByTestId(TOOLS.tempoRow)).toHaveCount(1)
  await tapTestId(m1, TOOLS.tempoRowRamp)
  await expect(m1.page.getByTestId(TOOLS.tempoRow)).toHaveAttribute('data-curve', 'ramp')
  await tapDone(m1)
  await expectNoOpenGesture(m1)
  const tempo = (await g1State(m1)).tempo
  expect(tempo.map(e => [e.time, e.bpm, e.curve])).toEqual([[0, 70, 'jump'], [2, 70, 'ramp']])
  expect((await clipState(m1, b.id)).startTime, 'media keeps its timeline position').toBe(b.start)
  await expectFrame(m1, 60, 'A still shows its frame 60 at 2 s')
  expect((await clipState(m1, a.id)).inPoint).toBe(0)
  await tapUndo(m1)
  await expect.poll(async () => (await g1State(m1)).tempo.map(e => e.bpm), { message: 'one Undo did not restore the tempo map' }).toEqual([60])
})

test('INV-1/metronome: the metronome toggle under the timeline switches the editor metronome on and off @phone', async ({ m1 }) => {
  await importAB(m1)
  const toggle = m1.page.getByTestId(ROW.metronome)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await tapOn(m1, toggle)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect((await g1State(m1)).metronome).toBe(true)
  await expect(m1.page.getByTestId('phone-toast')).toContainText('Metronome on')
  await tapOn(m1, toggle)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect((await g1State(m1)).metronome).toBe(false)
})

test('INV-1/video-bake-regions: Bake marks the whole clip, bakes and unbakes it, and removes the region @phone', async ({ m1 }) => {
  const { main: [a] } = await importAB(m1)
  await seek(m1, 1)
  await openClipSheet(m1, a.id, 'bake')
  await tapTestId(m1, BAKE.markClip)
  const row = m1.page.getByTestId(BAKE.row)
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute('data-status', 'marked')
  expect((await clipState(m1, a.id)).bake).toHaveLength(1)
  await tapOn(m1, row.getByTestId(BAKE.bake))
  await expect(row, 'the clip region did not finish baking').toHaveAttribute('data-status', 'baked', { timeout: 120_000 })
  await tapOn(m1, row.getByTestId(BAKE.unbake))
  await expect(row).toHaveAttribute('data-status', 'marked')
  await tapOn(m1, row.getByTestId(BAKE.remove))
  await expect(m1.page.getByTestId(BAKE.empty)).toBeVisible()
  expect((await clipState(m1, a.id)).bake).toHaveLength(0)
  await tapCancel(m1)
})

test('INV-1/storyboard-range-variants: Range → Compare opens the comparison and asks the assistant for A/B/C of the range @phone', async ({ m1 }) => {
  await importAB(m1)
  await seek(m1, 1)
  await tapTestId(m1, ROW.setIn)
  await seek(m1, 3)
  await tapTestId(m1, ROW.setOut)
  await openTimelineTab(m1, TOOLS.tabRange)
  await tapTestId(m1, TOOLS.rangeCompare)
  await expect(m1.page.getByTestId('phone-variants')).toHaveAttribute('data-open', 'false')
  await tapTestId(m1, 'phone-variants-ask')
  await expect(m1.page.getByTestId(ASSISTANT.prompt), 'the request is typed in, not sent').toHaveValue(/storyboard variants .* 0:01\.00 to 0:03\.00/)
  expect((await g1State(m1)).inPoint, 'the range survives the hand-over').toBe(1)
  await tapOn(m1, m1.page.getByTestId('phone-sheet-cancel'))
})

test('INV-4/audio-tempo-meter-grid: 3/4 at 60 BPM puts bar lines every 3 s on the ruler and bar 2 at 3 s; Undo restores 4/4 @phone', async ({ m1 }) => {
  await importAB(m1)
  await seek(m1, 3)
  await openTimelineTab(m1, TOOLS.tabTempo)
  await tapTestId(m1, `${TOOLS.tempoMeter}-3-4`)
  await expect(m1.page.getByTestId(TOOLS.tempoPosition)).toHaveAttribute('data-bar', '2')
  await tapTestId(m1, TOOLS.tabSnap)
  await tapTestId(m1, TOOLS.gridSwitch)
  await tapDone(m1)
  await expect.poll(async () => { const state = await g1State(m1); return [state.beatGrid, state.tempo[0].numerator] }, { message: 'Done kept the beat grid and 3/4' }).toEqual([true, 3])
  const downbeats = () => m1.page.locator(`[data-testid="${ROW.beat}"][data-downbeat="true"]`).evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-time'))))
  await expect.poll(async () => (await downbeats()).filter(time => time <= 7), { message: 'the ruler draws a bar line every 3 s' }).toEqual(expect.arrayContaining([0, 3, 6]))
  expect(await downbeats()).not.toContain(4)
  await tapUndo(m1)
  await expect.poll(async () => (await g1State(m1)).tempo[0].numerator, { message: 'one Undo did not restore 4/4' }).toBe(4)
})

test('INV-4/audio-metronome: level, beats/bars and on/off in Timeline → Tempo; Cancel restores all three @phone', async ({ m1 }) => {
  await importAB(m1)
  await openTimelineTab(m1, TOOLS.tabTempo)
  await tapTestId(m1, TOOLS.metronomeSwitch)
  await tapTestId(m1, `${TOOLS.metronomeVolume}-minus-0.1`)
  await tapTestId(m1, `${TOOLS.metronomeMode}-bars`)
  expect(await g1State(m1)).toMatchObject({ metronome: true, metronomeVolume: 0.4, metronomeMode: 'bars' })
  await tapCancel(m1)
  expect(await g1State(m1)).toMatchObject({ metronome: false, metronomeVolume: 0.5, metronomeMode: 'beats' })
  await openTimelineTab(m1, TOOLS.tabTempo)
  await tapTestId(m1, TOOLS.metronomeSwitch)
  await tapDone(m1)
  expect((await g1State(m1)).metronome).toBe(true)
  await expect(m1.page.getByTestId(ROW.metronome)).toHaveAttribute('aria-pressed', 'true')
})

test('INV-3/transform-parenting: parenting and unparenting B keep its picture in both directions @phone', async ({ m1 }) => {
  const { main: [a, b] } = await importAB(m1)
  await seekToFrame(m1, 5, 30, 'B at its frame 30')
  // Reference with B selected, as it is while the sheet works (a selection draws on the preview).
  await selectOnly(m1, b.id)
  await expectFrame(m1, 30, 'B selected at its frame 30')
  const before = await previewPixels(m1.probe)
  await openClipSheet(m1, b.id, 'clip-details')
  await tapTestId(m1, `${DETAILS.parentOption}-${a.id}`)
  await expect(m1.page.getByTestId(DETAILS.message)).toContainText('stays where it is')
  await tapTestId(m1, DETAILS.parentNone)
  await expect(m1.page.getByTestId(DETAILS.message)).toContainText('Parent removed')
  await tapDone(m1)
  expect((await clipState(m1, b.id)).parentClipId).toBeNull()
  await expectFrame(m1, 30, 'B still shows frame 30')
  await expect.poll(async () => differingShare(before, await previewPixels(m1.probe)), { message: 'parent and unparent moved the picture', timeout: 15_000 }).toBeLessThan(0.01)
})

test('INV-5/motion-null-parenting: Parent to a new null adds a null on a new track as B\'s parent; one Undo removes both @phone', async ({ m1 }) => {
  const { main: [, b] } = await importAB(m1)
  await seekToFrame(m1, 5, 30, 'B at its frame 30')
  // Reference with B selected, as it is while the sheet works (a selection draws on the preview).
  await selectOnly(m1, b.id)
  await expectFrame(m1, 30, 'B selected at its frame 30')
  const before = await previewPixels(m1.probe)
  const tracksBefore = (await g1State(m1)).tracks.length
  await openClipSheet(m1, b.id, 'clip-details')
  await tapTestId(m1, DETAILS.nullParent)
  await expect(m1.page.getByTestId(DETAILS.message)).toContainText('Null created')
  await tapDone(m1)
  await expectNoOpenGesture(m1)
  const state = await g1State(m1)
  const nullClip = state.clips.find(clip => clip.sourceType === 'motion-null')
  expect(nullClip, 'a null clip exists').toBeTruthy()
  expect(state.clips.find(clip => clip.id === b.id)?.parentClipId).toBe(nullClip!.id)
  expect(state.tracks.length).toBe(tracksBefore + 1)
  await expectFrame(m1, 30, 'B still shows frame 30')
  await expect.poll(async () => differingShare(before, await previewPixels(m1.probe)), { message: 'the null moved the picture', timeout: 15_000 }).toBeLessThan(0.01)
  await tapUndo(m1)
  await expect.poll(async () => (await g1State(m1)).clips.some(clip => clip.sourceType === 'motion-null'), { message: 'one Undo did not remove the null' }).toBe(false)
  expect((await clipState(m1, b.id)).parentClipId).toBeNull()
})
