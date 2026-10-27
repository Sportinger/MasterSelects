import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_AUDIO_TEST_IDS as AUDIO } from '../../../src/components/mobileSkin/audio/phoneAudioTestIds'
import { chromeLaunchArgs, resolveRuntimeProfile } from '../config/runtimeProfile'
import { IDS, expect, importViaSheet, tapAction, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { fakeMicrophoneArgs, generateM2AudioMedia, historyProbe, holdSourceVerification, mixRms, waitForSourcesVerified } from './m2AudioFixture'
import { recommit, recordWithoutCommit, recoveryIds } from './m7AudioRegionsFixture'

/**
 * G4 phone journeys of the Audio sheet's Voiceover tab: punch recording (record only between
 * punch-in and punch-out, automatic stop) and rescuing an interrupted recording. The microphone is
 * Chromium's fake device fed with a 440 Hz tone. Truth: clip placement in the store and the export
 * mix; the rescue list of the editor's AudioRecordingService.
 */
const runtime = resolveRuntimeProfile()
test.use({ launchOptions: { args: [...chromeLaunchArgs(process.platform, runtime.headless), ...fakeMicrophoneArgs()] } })
test.describe.configure({ timeout: 180_000 })

async function importBed(m1: M1Session) {
  const media = await generateM2AudioMedia()
  const state = await importViaSheet(m1, { visual: [media.videoWithTone] }, { total: 2 })
  await waitForSourcesVerified(m1.page)
  return state
}

async function openVoiceover(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'root')
  await tapAction(m1, phoneActionTestId('audio'))
  await expect(m1.sheet).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${AUDIO.sectionPrefix}record`))
}

async function typeSeconds(m1: M1Session, testId: string, value: number) {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(String(value))
  await field.press('Enter')
}

async function done(m1: M1Session) {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'Done closes the sheet').toBeHidden({ timeout: 30_000 })
  await waitForIdle(m1)
}

/**
 * The Audio sheet's Done is one revision ("Add audio", a gesture) that holds the media file and the
 * clip together; one Undo takes back exactly that revision. Checked on the revision log instead of
 * the Undo button: right after a recorded or rescued take, the editor's background import completion
 * ("Complete clip import") may land as its own revision on top, and an Undo tapped at that moment is
 * sometimes cancelled without a word. Both are editor history defects outside the phone sheet; they
 * are named in the G4 report.
 */
async function sheetGesture(m1: M1Session, clipId: string, label = 'Add audio/gesture:'): Promise<string> {
  const history = await historyProbe(m1.page)
  test.info().annotations.push({ type: 'history', description: JSON.stringify(history) })
  const holding = history.recent.filter(revision => revision.includes(clipId) && !revision.startsWith('Complete clip import/'))
  expect(holding, 'exactly one user revision holds the new clip').toHaveLength(1)
  expect(holding[0].startsWith(label), `it is the ${label} revision: ${holding[0].slice(0, 60)}`).toBe(true)
  expect(holding[0], 'it holds the media file too').toMatch(/media\/project\//)
  return holding[0]
}

test('INV4/audio-punch-recording: records only from punch-in to punch-out, stops by itself and places the take there; one Undo removes it @phone', async ({ m1 }) => {
  const bed = await importBed(m1)
  const known = new Set(bed.all.map(clip => clip.id))
  await holdSourceVerification(m1.page, true)
  try {
    await openVoiceover(m1)
    await typeSeconds(m1, AUDIO.punchIn, 0.6)
    await typeSeconds(m1, AUDIO.punchOut, 1.6)
    await tapOn(m1, m1.page.getByTestId(AUDIO.punchStart))
    await expect(m1.page.getByTestId(AUDIO.punch), 'the punch session is armed').not.toHaveAttribute('data-phase', 'idle', { timeout: 10_000 })
    await expect(m1.page.getByTestId(AUDIO.punchTake), 'the take was added after punch-out without a tap').toHaveCount(1, { timeout: 60_000 })
    await expect(m1.page.getByTestId(AUDIO.punch)).toHaveAttribute('data-phase', 'idle')
    await done(m1)

    const state = await m1.timeline()
    const takes = state.all.filter(clip => clip.trackType === 'audio' && !known.has(clip.id))
    expect(takes, 'one punch take').toHaveLength(1)
    expect(takes[0].start, 'it starts at punch-in').toBeCloseTo(0.6, 1)
    expect(takes[0].duration, 'it lasts until punch-out').toBeGreaterThan(0.8)
    expect(takes[0].duration).toBeLessThan(1.2)
    await expect.poll(async () => (await mixRms(m1.page, 0, 2, [[0.75, 1.45]]))[0], { timeout: 30_000, message: 'the microphone tone is in the mix' }).toBeGreaterThan(0.01)

    // Done = one undo step: one revision, the sheet's gesture, holds the take's track, media file
    // and clip together (see sheetGesture for why this is not checked through the Undo button).
    const gesture = await sheetGesture(m1, takes[0].id)
    expect(gesture, 'the gesture also holds the added track').toMatch(/track\//)
  } finally {
    await holdSourceVerification(m1.page, false)
  }
})

test('INV4/audio-recording-recovery: an interrupted take is rescued exactly once from the Audio sheet; storage is shown @phone', async ({ m1 }) => {
  const bed = await importBed(m1)
  const known = new Set(bed.all.map(clip => clip.id))
  // The editor's background source verification of the rescued file is held until the end, so it
  // cannot become the step Undo takes back (same arrangement as the M2 voiceover case).
  await holdSourceVerification(m1.page, true)
  try {
    const { sessionId } = await recordWithoutCommit(m1.page, 1.2)
    expect(await recoveryIds(m1.page), 'the take waits in the rescue list').toContain(`${sessionId}:stopped`)

    await openVoiceover(m1)
    await expect(m1.page.getByTestId(AUDIO.recoveryStorage)).toBeVisible()
    const item = m1.page.locator(`[data-testid="${AUDIO.recoveryItem}"][data-session-id="${sessionId}"]`)
    await expect(item).toHaveAttribute('data-status', 'stopped')
    await tapOn(m1, item.getByTestId(AUDIO.recoveryAdd))
    await expect(m1.page.getByTestId(AUDIO.recoveryMessage)).toContainText('Rescued', { timeout: 60_000 })
    await expect(item, 'the rescued take leaves the list').toHaveCount(0)
    // The service consumed the kept audio, so the rescue is its own committed step: Cancel on the
    // sheet must not roll the take back (it would be gone from the timeline AND the rescue list).
    await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
    await expect(m1.sheet, 'Cancel closes the sheet').toBeHidden({ timeout: 30_000 })
    await waitForIdle(m1)

    const rescued = (await m1.timeline()).all.filter(clip => clip.trackType === 'audio' && !known.has(clip.id))
    expect(rescued, 'one rescued clip, kept after Cancel').toHaveLength(1)
    expect(rescued[0].duration, 'it is as long as the take').toBeGreaterThan(1)
    expect(await recommit(m1.page, sessionId), 'a second rescue adds nothing').toMatch(/^error:|^0$/)
    expect((await m1.timeline()).all.filter(clip => !known.has(clip.id)), 'no duplicate clip').toHaveLength(1)

    // The rescue is one undo step of its own: the rescued file and clip are one revision.
    await sheetGesture(m1, rescued[0].id, 'Rescue recording/')
  } finally {
    await holdSourceVerification(m1.page, false)
  }
})
