import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_AUDIO_TEST_IDS as AUDIO, PHONE_VOLUME_TEST_IDS as VOLUME } from '../../../src/components/mobileSkin/audio/phoneAudioTestIds'
import { PHONE_TRACKS_TEST_IDS as TRACKS } from '../../../src/components/mobileSkin/tracks/phoneTracksTestIds'
import { chromeLaunchArgs, resolveRuntimeProfile } from '../config/runtimeProfile'
import {
  IDS, differingShare, expect, exportToReady, importViaSheet, previewPixels, seek, tapAction, tapClip, tapForDownload, tapOn, test,
  waitForIdle, type M1Session, type M1Timeline,
} from './m1Fixture'
import {
  TONE_SECONDS, clipAudio, fakeMicrophoneArgs, generateClickTrack, fileAudioRms, generateM2AudioMedia, historyProbe, holdSourceVerification, mediaNames, mixRms, uniqueTone, waitForSourcesVerified, timelineSnapshot, type M2AudioMedia,
} from './m2AudioFixture'
import { handoffState } from './m3TimelineFixture'

/**
 * M2 "Gestalten" audio acceptance of the phone skin (PLAN.md section 5, packet P3): the Volume
 * sheet (clip scope: level, mute, fades, also for the linked sound of a video) and the Audio
 * sheet (root scope: music at the playhead, voiceover, extract audio, beats). One catalog
 * case per test in the M1 phone world (m1Fixture.ts: one project built through the phone UI, a
 * fresh empty composition per test). Every action under test is real touch; files come in through
 * the hidden inputs; the microphone is Chromium's fake device fed with a 440 Hz tone.
 *
 * Truth for sound: the PCM the export renders (m2AudioFixture.ts `mixRms`, the export's own mix
 * without the encoder) and, in the export case, the decoded exported file. Truth for "unchanged":
 * the timeline snapshot (tracks, clips, links, effects, mute, every keyframe) plus preview pixels.
 */
const runtime = resolveRuntimeProfile()
test.use({ launchOptions: { args: [...chromeLaunchArgs(process.platform, runtime.headless), ...fakeMicrophoneArgs()] } })
test.describe.configure({ timeout: 180_000 })

const FULL: [number, number] = [0.2, 1.8]
const RATIO_TOLERANCE = 0.03

let media: M2AudioMedia
test.beforeAll(async () => { media = await generateM2AudioMedia() })

const audioClipOf = (state: M1Timeline) => state.all.find(clip => clip.trackType === 'audio')
const videoClipOf = (state: M1Timeline) => state.all.find(clip => clip.trackType === 'video')

async function importTone(m1: M1Session) {
  const state = await importViaSheet(m1, { audio: [media.tone] }, { total: 1 })
  const audio = audioClipOf(state)
  expect(audio, 'the tone lands on an audio track').toBeTruthy()
  await waitForSourcesVerified(m1.page)
  return audio!
}

async function importVideoWithTone(m1: M1Session) {
  const state = await importViaSheet(m1, { visual: [media.videoWithTone] }, { total: 2 })
  const video = videoClipOf(state)
  const audio = audioClipOf(state)
  expect(video && audio, 'the video and its linked sound are on the timeline').toBeTruthy()
  await expect.poll(async () => (await clipAudio(m1.page, video!.id))?.linkedClipId, { message: 'the video is linked to its sound' }).toBe(audio!.id)
  await waitForSourcesVerified(m1.page)
  return { video: video!, audio: audio! }
}

async function nothingSelected(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'root')
}

async function openVolume(m1: M1Session, clipId: string) {
  await historyProbe(m1.page)
  await nothingSelected(m1)
  await tapClip(m1, clipId)
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'clip')
  await tapAction(m1, phoneActionTestId('volume'))
  await expect(m1.sheet, 'the Volume sheet opened').toBeVisible()
  await expect(m1.page.getByTestId(VOLUME.levelInput)).toBeVisible()
}

async function previewStaysAboveSheet(m1: M1Session) {
  const preview = m1.page.getByTestId(IDS.previewRegion)
  await expect(preview, 'the preview stays visible while the sheet is open').toBeVisible()
  const [previewBox, sheetBox] = await Promise.all([preview.boundingBox(), m1.sheet.boundingBox()])
  expect(previewBox && sheetBox, 'preview and sheet are laid out').toBeTruthy()
  expect(previewBox!.height, 'the preview keeps a usable height').toBeGreaterThan(90)
  expect(previewBox!.y + previewBox!.height, 'the preview sits above the sheet').toBeLessThanOrEqual(sheetBox!.y + 1)
}

async function typeInto(m1: M1Session, testId: string, value: string) {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(value)
}

async function done(m1: M1Session) {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'Done closes the sheet').toBeHidden({ timeout: 30_000 })
  await waitForIdle(m1)
}

async function cancel(m1: M1Session) {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'Cancel closes the sheet').toBeHidden({ timeout: 30_000 })
  await waitForIdle(m1)
}

/** One tap on Undo; resolves once the editor checked out the previous revision (history is async). */
async function undoOnce(m1: M1Session): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  const history = await historyProbe(m1.page)
  const revision = history.revisionId
  test.info().annotations.push({ type: 'history-before-undo', description: JSON.stringify(history) })
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => (await historyProbe(m1.page)).revisionId, { message: 'Undo moved to another revision' }).not.toBe(revision)
  test.info().annotations.push({ type: 'history-after-undo', description: JSON.stringify(await historyProbe(m1.page)) })
  await waitForIdle(m1)
}

async function fullMix(m1: M1Session): Promise<number> {
  return (await mixRms(m1.page, 0, TONE_SECONDS, [FULL]))[0]
}

test('INV4/clip-volume: Done sets 50 % (export mix -6 dB) and one Undo restores the exact level @phone', async ({ m1 }) => {
  const tone = await importTone(m1)
  const before = await timelineSnapshot(m1.page)
  const unity = await fullMix(m1)
  expect(unity, 'the tone is audible in the export mix').toBeGreaterThan(0.05)

  await openVolume(m1, tone.id)
  await previewStaysAboveSheet(m1)
  await expect(m1.page.getByTestId(VOLUME.levelInput)).toHaveValue('100')
  await typeInto(m1, VOLUME.levelInput, '50')
  await expect.poll(async () => (await clipAudio(m1.page, tone.id))?.volume, { message: 'the level changes live while the sheet is open' }).toBeCloseTo(0.5, 6)
  await done(m1)

  expect((await clipAudio(m1.page, tone.id))?.volume, 'the clip keeps 50 % after Done').toBeCloseTo(0.5, 6)
  expect((await fullMix(m1)) / unity, 'the export mix is at half amplitude').toBeCloseTo(0.5, 1)
  expect(Math.abs((await fullMix(m1)) / unity - 0.5), 'within 3 %').toBeLessThan(RATIO_TOLERANCE)

  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo returns exactly to the state before the sheet' }).toBe(before)
  expect(Math.abs((await fullMix(m1)) / unity - 1), 'the export mix is back at full level').toBeLessThan(RATIO_TOLERANCE)
})

test('INV4/clip-volume: Cancel leaves pixels, timeline and sound exactly unchanged @phone', async ({ m1 }) => {
  const { video } = await importVideoWithTone(m1)
  await seek(m1, 1)
  await nothingSelected(m1)
  const before = await timelineSnapshot(m1.page)
  const unity = await fullMix(m1)
  const pixelsBefore = await previewPixels(m1.probe)

  await openVolume(m1, video.id)
  await typeInto(m1, VOLUME.levelInput, '25')
  await tapOn(m1, m1.page.getByTestId(VOLUME.mute))
  await typeInto(m1, VOLUME.fadeInInput, '0.5')
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'the sheet changes the clip live' }).not.toBe(before)
  await cancel(m1)
  await nothingSelected(m1)

  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel restores the exact timeline' }).toBe(before)
  expect(Math.abs((await fullMix(m1)) / unity - 1), 'Cancel restores the sound').toBeLessThan(RATIO_TOLERANCE)
  await expect.poll(async () => differingShare(pixelsBefore, await previewPixels(m1.probe)), {
    message: 'Cancel leaves the preview pixels unchanged',
  }).toBeLessThan(0.002)
})

test('INV4/clip-volume: mute silences the clip in the export mix and one Undo brings it back @phone', async ({ m1 }) => {
  const tone = await importTone(m1)
  const before = await timelineSnapshot(m1.page)
  const unity = await fullMix(m1)

  await openVolume(m1, tone.id)
  await tapOn(m1, m1.page.getByTestId(VOLUME.mute))
  await expect(m1.page.getByTestId(VOLUME.mute)).toHaveAttribute('aria-pressed', 'true')
  await done(m1)

  const muted = await clipAudio(m1.page, tone.id)
  expect(muted?.muted, 'the clip is muted').toBe(true)
  expect(muted?.volume, 'muting keeps the level').toBe(1)
  expect(await fullMix(m1), 'the muted clip is silent in the export mix').toBeLessThan(unity * 0.01)

  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo returns exactly to the state before' }).toBe(before)
  expect(Math.abs((await fullMix(m1)) / unity - 1)).toBeLessThan(RATIO_TOLERANCE)
})

test('INV4/audio-fades-crossfades: fade in and out ramp the export mix from and to silence; one Undo removes them @phone', async ({ m1 }) => {
  const tone = await importTone(m1)
  const before = await timelineSnapshot(m1.page)
  const windows: Array<[number, number]> = [[0, 0.04], [0.9, 1.1], [1.96, 2]]
  const [startBefore, middleBefore, endBefore] = await mixRms(m1.page, 0, TONE_SECONDS, windows)

  await openVolume(m1, tone.id)
  await typeInto(m1, VOLUME.fadeInInput, '0.5')
  await typeInto(m1, VOLUME.fadeOutInput, '0.5')
  await done(m1)

  const audio = await clipAudio(m1.page, tone.id)
  const expected = [[0, 0], [0.5, 1], [audio!.duration - 0.5, 1], [audio!.duration, 0]]
  expect(audio?.keyframes.length, 'four fade keyframes').toBe(4)
  audio!.keyframes.forEach((keyframe, index) => {
    expect(keyframe.time, `fade keyframe ${index} time`).toBeCloseTo(expected[index][0], 4)
    expect(keyframe.value, `fade keyframe ${index} value`).toBeCloseTo(expected[index][1], 6)
  })
  const [start, middle, end] = await mixRms(m1.page, 0, TONE_SECONDS, windows)
  expect(start / startBefore, 'the first 40 ms are faded in').toBeLessThan(0.35)
  expect(Math.abs(middle / middleBefore - 1), 'the middle keeps its level').toBeLessThan(RATIO_TOLERANCE)
  expect(end / endBefore, 'the last 40 ms are faded out').toBeLessThan(0.35)

  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo removes both fades' }).toBe(before)
  const [startUndo] = await mixRms(m1.page, 0, TONE_SECONDS, windows)
  expect(Math.abs(startUndo / startBefore - 1)).toBeLessThan(RATIO_TOLERANCE)
})

test('INV4/clip-volume: on a video clip the Volume sheet sets its linked sound @phone', async ({ m1 }) => {
  const { video, audio } = await importVideoWithTone(m1)
  const before = await timelineSnapshot(m1.page)
  const unity = await fullMix(m1)

  await openVolume(m1, video.id)
  await expect(m1.page.getByTestId(VOLUME.status)).not.toContainText('No sound')
  await typeInto(m1, VOLUME.levelInput, '50')
  await done(m1)

  expect((await clipAudio(m1.page, audio.id))?.volume, 'the linked audio clip carries the level').toBeCloseTo(0.5, 6)
  expect(Math.abs((await fullMix(m1)) / unity - 0.5)).toBeLessThan(RATIO_TOLERANCE)
  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo restores the linked sound' }).toBe(before)
})

test('INV4/clip-volume: the exported file carries the changed level @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(300_000)
  const { video } = await importVideoWithTone(m1)
  const source = await fileAudioRms(media.videoWithTone, FULL[0], FULL[1])
  await openVolume(m1, video.id)
  await typeInto(m1, VOLUME.levelInput, '50')
  await done(m1)
  await nothingSelected(m1)

  await exportToReady(m1)
  const { file } = await tapForDownload(m1, m1.page.getByTestId('phone-export-save'), testInfo, 'm2-volume-export')
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel)).catch(() => undefined)
  const exported = await fileAudioRms(file, FULL[0], FULL[1])
  testInfo.annotations.push({ type: 'export-rms', description: `source ${source.toFixed(4)}, exported ${exported.toFixed(4)}` })
  expect(Math.abs(exported / source - 0.5), 'the exported sound is at half amplitude (within 5 %)').toBeLessThan(0.05)
})

test('INV4/audio-microphone-recording (music): the Audio sheet adds a sound at the playhead; one Undo removes it; Cancel adds nothing @phone', async ({ m1 }) => {
  await importVideoWithTone(m1)
  await seek(m1, 0.5)
  await nothingSelected(m1)
  // Arrangement: the editor's background source verification of files added in this case is held
  // until the end, so it cannot become the step Undo takes back (defect case below).
  await holdSourceVerification(m1.page, true)
  try {
    const before = await timelineSnapshot(m1.page)
    const pixelsBefore = await previewPixels(m1.probe)

    // Cancel first: the picked sound is placed live and must disappear again.
    await tapAction(m1, phoneActionTestId('audio'))
    await expect(m1.sheet, 'the Audio sheet opened').toBeVisible()
    await previewStaysAboveSheet(m1)
    const mediaBefore = await mediaNames(m1.page)
    await m1.page.getByTestId(AUDIO.musicInput).setInputFiles(media.tone)
    await expect(m1.page.getByTestId(AUDIO.musicItem)).toHaveCount(1, { timeout: 60_000 })
    await cancel(m1)
    await expect.poll(async () => mediaNames(m1.page), { message: 'Cancel also removes the picked file from the media pool' }).toEqual(mediaBefore)
    await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel removes the live-placed sound' }).toBe(before)
    await expect.poll(async () => differingShare(pixelsBefore, await previewPixels(m1.probe)), {
      message: 'Cancel leaves the preview pixels unchanged',
    }).toBeLessThan(0.002)

    await tapAction(m1, phoneActionTestId('audio'))
    await m1.page.getByTestId(AUDIO.musicInput).setInputFiles(media.tone)
    await expect(m1.page.getByTestId(AUDIO.musicItem)).toHaveCount(1, { timeout: 60_000 })
    await expect(m1.page.getByTestId(AUDIO.musicItem)).toContainText('0:00.50')
    await done(m1)

    const state = await m1.timeline()
    const added = state.all.filter(clip => clip.trackType === 'audio' && clip.name.includes('m2-tone'))
    expect(added, 'one sound clip was added').toHaveLength(1)
    expect(added[0].start, 'it starts at the playhead').toBeCloseTo(0.5, 3)
    // The video (and its sound) ends at 2 s; the added 2 s sound runs from 0.5 s to 2.5 s.
    const [afterVideo] = await mixRms(m1.page, 0, 2.5, [[2.1, 2.4]])
    expect(afterVideo, 'the added sound is in the export mix after the video ended').toBeGreaterThan(0.05)

    await undoOnce(m1)
    await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo removes the added sound' }).toBe(before)
  } finally {
    await holdSourceVerification(m1.page, false)
  }
})

test('INV4/audio-microphone-recording: a voiceover records from the playhead; one Undo removes it; Cancel after a take leaves nothing @phone', async ({ m1 }) => {
  await importVideoWithTone(m1)
  await seek(m1, 0.5)
  await nothingSelected(m1)
  // Arrangement: the editor's background source verification of files added in this case is held
  // until the end, so it cannot become the step Undo takes back (defect case below).
  await holdSourceVerification(m1.page, true)
  try {
    const before = await timelineSnapshot(m1.page)

    const recordTake = async () => {
      await tapAction(m1, phoneActionTestId('audio'))
      await expect(m1.sheet).toBeVisible()
      await tapOn(m1, m1.page.getByTestId(`${AUDIO.sectionPrefix}record`))
      await tapOn(m1, m1.page.getByTestId(AUDIO.recordStart))
      const timer = m1.page.getByTestId(AUDIO.recordTimer)
      await expect(timer, 'the recording runs').toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => Number.parseFloat(await timer.innerText()), { timeout: 20_000, message: 'the timer passes 1.2 s' }).toBeGreaterThan(1.2)
      await tapOn(m1, m1.page.getByTestId(AUDIO.recordStop))
      await expect(m1.page.getByTestId(AUDIO.recordTake), 'the take is listed').toHaveCount(1, { timeout: 60_000 })
    }

    const mediaBefore = await mediaNames(m1.page)
    await recordTake()
    await cancel(m1)
    await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel throws the take (and its track) away' }).toBe(before)
    await expect.poll(async () => mediaNames(m1.page), { message: 'Cancel also removes the recorded file from the media pool' }).toEqual(mediaBefore)

    await recordTake()
    await done(m1)
    const state = await m1.timeline()
    const known = new Set(JSON.parse(before).clips.map((clip: { id: string }) => clip.id))
    const takes = state.all.filter(clip => clip.trackType === 'audio' && !known.has(clip.id))
    expect(takes, 'one voiceover clip').toHaveLength(1)
    expect(takes[0].start, 'it starts at the playhead').toBeCloseTo(0.5, 3)
    expect(takes[0].duration, 'it is as long as the recording').toBeGreaterThan(1)
    await expect.poll(async () => (await mixRms(m1.page, 0.5, 0.5 + takes[0].duration, [[0.6, 0.5 + takes[0].duration - 0.1]]))[0], {
      timeout: 30_000, message: 'the fake microphone tone is in the export mix',
    }).toBeGreaterThan(0.01)

    await undoOnce(m1)
    await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo removes the voiceover and its track' }).toBe(before)
  } finally {
    await holdSourceVerification(m1.page, false)
  }
})

test('regression: a background source verification after Done does not take the place of the edit in Undo @phone', async ({ m1 }, testInfo) => {
  // Regression guard for the editor history: the background media verification ("Verify media source")
  // committed after an edit must not become the Undo target and must not cancel a running Undo. Made
  // deterministic by holding the verification (withSourceIdentitiesPaused) until the edit is done.
  await holdSourceVerification(m1.page, true)
  try {
    const fresh = await uniqueTone(testInfo.outputPath('media'))
    const tone = await importViaSheet(m1, { audio: [fresh] }, { total: 1 }).then(state => audioClipOf(state)!)
    const before = await timelineSnapshot(m1.page)
    await openVolume(m1, tone.id)
    await typeInto(m1, VOLUME.levelInput, '50')
    await done(m1)
    await holdSourceVerification(m1.page, false)
    await waitForSourcesVerified(m1.page)
    await undoOnce(m1)
    await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo takes back the volume change', timeout: 10_000 }).toBe(before)
  } finally {
    await holdSourceVerification(m1.page, false)
  }
})

test('INV1/link-clips (extract audio): Extract separates the sound of the video under the playhead; one Undo links it again @phone', async ({ m1 }) => {
  const { video, audio } = await importVideoWithTone(m1)
  await seek(m1, 1)
  await nothingSelected(m1)
  const before = await timelineSnapshot(m1.page)

  await tapAction(m1, phoneActionTestId('audio'))
  await tapOn(m1, m1.page.getByTestId(`${AUDIO.sectionPrefix}extract`))
  await expect(m1.page.getByTestId(AUDIO.extractTarget)).toContainText('Video under the playhead')
  await tapOn(m1, m1.page.getByTestId(AUDIO.extractRun))
  await expect(m1.page.getByTestId(AUDIO.extractTarget)).toContainText('is now its own clip')
  await done(m1)

  expect((await clipAudio(m1.page, video.id))?.linkedClipId, 'the video is no longer linked').toBeNull()
  expect((await clipAudio(m1.page, audio.id))?.linkedClipId, 'the sound is its own clip').toBeNull()
  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo links them again' }).toBe(before)
})

test('INV-4/audio-track-management: Audio links to the Tracks sheet; Pan and Noise reduction say where they work @phone', async ({ m1 }) => {
  const tone = await importTone(m1)
  await nothingSelected(m1)
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  const explains = async (testId: string, pattern: RegExp) => {
    const control = m1.page.getByTestId(testId)
    await expect(control).toBeVisible()
    await expect(control).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, control)
    await expect(notice, `${testId} explains itself`).toContainText(pattern)
    await tapOn(m1, notice.getByRole('button').last())
    await expect(notice).toBeHidden()
    await expect(m1.sheet, 'the sheet stays open behind the notice').toBeVisible()
  }
  await openVolume(m1, tone.id)
  await explains(`${VOLUME.unavailablePrefix}pan`, /add Pan/)
  await explains(`${VOLUME.unavailablePrefix}noise`, /Noise Reduction/)
  await cancel(m1)

  await nothingSelected(m1)
  await tapAction(m1, phoneActionTestId('audio'))
  await explains(`${AUDIO.unavailablePrefix}devices`, /microphone/)
  await tapOn(m1, m1.page.getByTestId(AUDIO.tracks))
  await expect(m1.page.getByTestId(TRACKS.list), 'Audio tracks opens the Tracks sheet').toBeVisible()
  await cancel(m1)
})

async function openBeats(m1: M1Session) {
  await nothingSelected(m1)
  await tapAction(m1, phoneActionTestId('audio'))
  await tapOn(m1, m1.page.getByTestId(`${AUDIO.sectionPrefix}beats`))
  await expect(m1.page.getByTestId(AUDIO.beatsPlace), 'the Beats tab is open').toBeVisible()
}

test('INV-4/audio-beat-onset-detection: Detect beats analyses a music clip from the Audio sheet @phone', async ({ m1 }) => {
  const clicks = await generateClickTrack()
  const state = await importViaSheet(m1, { audio: [clicks] }, { total: 1 })
  const music = audioClipOf(state)!
  await waitForSourcesVerified(m1.page)
  await openBeats(m1)
  const source = m1.page.locator(`[data-testid="${AUDIO.beatsSource}"][data-value="${music.id}:unanalyzed"]`)
  await expect(source, 'the music clip is offered, not analysed yet').toHaveAttribute('aria-checked', 'true')
  await tapOn(m1, m1.page.getByTestId(AUDIO.beatsDetect))
  await expect.poll(async () => (await handoffState(m1)).clips.find(clip => clip.id === music.id)?.beatGridId ?? null,
    { message: 'the beat grid did not land on the clip', timeout: 90_000 }).not.toBeNull()
  await expect(m1.page.getByTestId(AUDIO.beatsMessage)).toContainText(/ready/)
  await expect(m1.page.locator(`[data-testid="${AUDIO.beatsSource}"][data-value="${music.id}:source"]`), 'the detected grid is the chosen source').toHaveAttribute('aria-checked', 'true')
  await cancel(m1)
})

test('INV-4/audio-beat-distribution-rules: Put on the beat lines up a track on the tempo map; Cancel leaves nothing, Done is one undo step @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.short.path, m1.media.a.path] }, { main: 2, total: 2 })
  const [short, a] = state.main
  expect(a.start, 'A follows the 1 s clip').toBeCloseTo(1, 3)
  await waitForIdle(m1)
  const before = await timelineSnapshot(m1.page)
  const place = async () => {
    await openBeats(m1)
    await tapOn(m1, m1.page.locator(`[data-testid="${AUDIO.beatsSource}"][data-value="tempo-map"]`))
    await tapOn(m1, m1.page.locator(`[data-testid="${AUDIO.beatsTrack}"][data-track-id="${a.trackId}"]`))
    await tapOn(m1, m1.page.locator(`[data-testid="${AUDIO.beatsStep}"][data-step="2"]`))
    await tapOn(m1, m1.page.getByTestId(AUDIO.beatsPlace))
    await expect(m1.page.getByTestId(AUDIO.beatsMessage)).toContainText(/on the beat/)
    // The default tempo map is 60 BPM: every 2nd beat is every 2 s, so A moves from 1 s to 2 s.
    await expect.poll(async () => (await handoffState(m1)).clips.find(clip => clip.id === a.id)?.startTime, { message: 'A did not move onto the beat' }).toBeCloseTo(2, 3)
    expect((await handoffState(m1)).clips.find(clip => clip.id === short.id)?.startTime, 'the first clip stays on beat 0').toBeCloseTo(0, 3)
  }
  await place()
  await cancel(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel left a moved clip behind' }).toBe(before)
  expect((await handoffState(m1)).beatRules, 'Cancel left no beat rule').toEqual([])

  await place()
  await done(m1)
  expect((await handoffState(m1)).beatRules, 'the beat rule stays editable').toEqual([expect.objectContaining({ members: 2, beatStep: 2 })])
  await undoOnce(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'one Undo puts the clips back' }).toBe(before)
  expect((await handoffState(m1)).beatRules).toEqual([])
})
