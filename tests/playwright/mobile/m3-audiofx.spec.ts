import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_AUDIO_FX_TEST_IDS as FX } from '../../../src/components/mobileSkin/audiofx/phoneAudioFxTestIds'
import { PHONE_VOLUME_TEST_IDS as VOLUME } from '../../../src/components/mobileSkin/audio/phoneAudioTestIds'
import {
  IDS, expect, importViaSheet, tapAction, tapClip, tapOn, test, waitForIdle, type M1Session, type M1Timeline,
} from './m1Fixture'
import { TONE_SECONDS, generateM2AudioMedia, historyProbe, mixRms, waitForSourcesVerified, type M2AudioMedia } from './m2AudioFixture'
import { audioFxOf, clipOf, m3Snapshot, toneSilenceTone } from './m3CaptionsAudioFixture'
import { expectHandedOver, leaveWorkspace } from './m3TimelineFixture'

/**
 * M3 "Profi-Blätter" audio effects of the phone skin (packet Q3): the 'audioFx' sheet on the selected
 * clip's sound. One catalog case per test in the shared M1 phone world (a fresh empty composition per
 * test). Every action under test is real touch; files come in through the media sheet's hidden inputs.
 * Truth for sound: the PCM the export renders (`mixRms`, the export's own mix without the encoder).
 * Truth for "unchanged": a timeline snapshot that includes the audio effect stack and edit list.
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => { await leaveWorkspace(m1) })

const FULL: [number, number] = [0.2, 1.8]
let media: M2AudioMedia
test.beforeAll(async () => { media = await generateM2AudioMedia() })

const audioClipOf = (state: M1Timeline) => state.all.find(clip => clip.trackType === 'audio')

async function importAudio(m1: M1Session, file: string) {
  const state = await importViaSheet(m1, { audio: [file] }, { total: 1 })
  const audio = audioClipOf(state)
  expect(audio, 'the sound lands on an audio track').toBeTruthy()
  await waitForSourcesVerified(m1.page)
  return audio!
}

async function nothingSelected(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'root')
}

async function openAudioFx(m1: M1Session, clipId: string) {
  await historyProbe(m1.page)
  await nothingSelected(m1)
  await tapClip(m1, clipId)
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'clip')
  await tapAction(m1, phoneActionTestId('audio-fx'))
  await expect(m1.sheet, 'the Audio effects sheet opened').toBeVisible()
  await expect(m1.page.getByTestId(FX.target)).toContainText('Sound of')
}

async function addEffect(m1: M1Session, descriptor: string) {
  await tapOn(m1, m1.page.locator(`[data-testid="${FX.card}"][data-descriptor="${descriptor}"]`))
  await expect(m1.page.locator(`[data-testid="${FX.row}"][data-descriptor="${descriptor}"]`), `${descriptor} is in the stack`).toBeVisible()
}

async function typeInto(m1: M1Session, testId: string, value: string) {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(value)
  await field.blur()
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

async function undoOnce(m1: M1Session): Promise<void> {
  await m1.bridge.toolData('clearSelection')
  const revision = (await historyProbe(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => (await historyProbe(m1.page)).revisionId, { message: 'Undo moved to another revision' }).not.toBe(revision)
  await waitForIdle(m1)
}

const fullMix = async (m1: M1Session) => (await mixRms(m1.page, 0, TONE_SECONDS, [FULL]))[0]

test('INV2/audio-effects-access: Done adds a low-pass at 200 Hz, the 440 Hz tone drops in the export mix, one Undo restores @phone', async ({ m1 }) => {
  const tone = await importAudio(m1, media.tone)
  const before = await m3Snapshot(m1.page)
  const unity = await fullMix(m1)
  expect(unity, 'the tone is audible in the export mix').toBeGreaterThan(0.05)

  await openAudioFx(m1, tone.id)
  await expect(m1.page.getByTestId(FX.empty)).toBeVisible()
  await addEffect(m1, 'audio-low-pass')
  await expect(m1.page.getByTestId(FX.mainInput)).toHaveValue('22000')
  await typeInto(m1, FX.mainInput, '200')
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id))[0]?.params.frequencyHz, { message: 'the cutoff changes live' }).toBe(200)
  await done(m1)

  const stack = await audioFxOf(m1.page, tone.id)
  expect(stack.map(effect => [effect.descriptorId, effect.enabled, effect.params.frequencyHz])).toEqual([['audio-low-pass', true, 200]])
  const filtered = await fullMix(m1)
  expect(filtered / unity, `the low-pass takes most of the 440 Hz tone away (${(filtered / unity).toFixed(3)})`).toBeLessThan(0.6)

  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo returns exactly to the state before the sheet' }).toBe(before)
  expect(Math.abs((await fullMix(m1)) / unity - 1), 'the export mix is back at full level').toBeLessThan(0.03)
})

test('INV4/audio-effect-stack: switch off, reorder and remove act live; Cancel leaves the clip exactly unchanged @phone', async ({ m1 }) => {
  const tone = await importAudio(m1, media.tone)
  const before = await m3Snapshot(m1.page)
  const unity = await fullMix(m1)

  await openAudioFx(m1, tone.id)
  await addEffect(m1, 'audio-reverb')
  await addEffect(m1, 'audio-compressor')
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id)).map(effect => effect.descriptorId)).toEqual(['audio-reverb', 'audio-compressor'])
  expect((await audioFxOf(m1.page, tone.id))[1].params, 'the compressor gets the phone starting point').toMatchObject({ thresholdDb: -18, ratio: 3 })

  const compressorRow = m1.page.locator(`[data-testid="${FX.row}"][data-descriptor="audio-compressor"]`)
  await tapOn(m1, compressorRow.getByTestId(FX.toggle))
  await expect(compressorRow).toHaveAttribute('data-enabled', 'false')
  await tapOn(m1, compressorRow.getByTestId(FX.moveUp))
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id)).map(effect => [effect.descriptorId, effect.enabled]))
    .toEqual([['audio-compressor', false], ['audio-reverb', true]])
  await tapOn(m1, m1.page.locator(`[data-testid="${FX.row}"][data-descriptor="audio-reverb"]`).getByTestId(FX.remove))
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id)).map(effect => effect.descriptorId)).toEqual(['audio-compressor'])

  await cancel(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'Cancel rolls everything back' }).toBe(before)
  expect(Math.abs((await fullMix(m1)) / unity - 1), 'the export mix is unchanged').toBeLessThan(0.03)
})

test('INV4/audio-normalize: Normalize raises the quiet tone towards -1 dB peak; one Undo restores @phone', async ({ m1 }) => {
  const tone = await importAudio(m1, media.tone)
  const before = await m3Snapshot(m1.page)
  const unity = await fullMix(m1)

  await openAudioFx(m1, tone.id)
  await tapOn(m1, m1.page.getByTestId(`${FX.sectionPrefix}cleanup`))
  await tapOn(m1, m1.page.getByTestId(FX.normalize))
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id)).map(effect => [effect.descriptorId, effect.params.mode, effect.params.targetPeakDb]))
    .toEqual([['audio-normalize', 'peak', -1]])
  await done(m1)

  const louder = await fullMix(m1)
  // 1/8 amplitude (-18 dBFS peak) normalized to -1 dBFS peak is about 7x louder.
  expect(louder / unity, `the export mix is louder after normalize (${(louder / unity).toFixed(2)}x)`).toBeGreaterThan(4)
  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo removes the normalize' }).toBe(before)
})

test('INV4/audio-silence-cleanup: removes the silent second of tone-silence-tone; one Undo restores @phone', async ({ m1 }) => {
  const clip = await importAudio(m1, await toneSilenceTone())
  const before = await m3Snapshot(m1.page)
  const start = await clipOf(m1.page, clip.id)
  expect(start?.duration, 'the clip is 3 s long').toBeCloseTo(3, 1)

  await openAudioFx(m1, clip.id)
  await tapOn(m1, m1.page.getByTestId(`${FX.sectionPrefix}cleanup`))
  await tapOn(m1, m1.page.getByTestId(FX.silenceRun))
  await expect(m1.page.getByTestId(FX.silenceResult)).toContainText('Removed', { timeout: 60_000 })
  await done(m1)

  const after = await clipOf(m1.page, clip.id)
  expect(after?.edits, 'the removal is an edit operation of the clip').toBeGreaterThan(0)
  expect(after!.duration, `the silent part is gone (${after!.duration.toFixed(2)} s)`).toBeLessThan(2.5)
  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo brings the silence back' }).toBe(before)
})

test('INV2/audio-effects-access: Volume links here, All parameters and AI Studio open the desktop panels, Track and master effects open the mixer, spectral explains itself @phone', async ({ m1 }) => {
  const tone = await importAudio(m1, media.tone)
  await nothingSelected(m1)
  await tapClip(m1, tone.id)
  await tapAction(m1, phoneActionTestId('volume'))
  await tapOn(m1, m1.page.getByTestId(VOLUME.audioEffects))
  await expect(m1.page.getByTestId(FX.target), 'Volume opens the Audio effects sheet for the same clip').toContainText('Sound of')

  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  for (const id of ['spectral']) {
    const control = m1.page.getByTestId(`${FX.unavailablePrefix}${id}`)
    await expect(control).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, control)
    await expect(notice, `${id} explains itself`).toBeVisible()
    expect((await notice.innerText()).trim().length).toBeGreaterThan(20)
    await tapOn(m1, notice.getByRole('button').last())
    await expect(notice).toBeHidden()
  }

  await tapOn(m1, m1.page.getByTestId(FX.allParameters))
  await expect(m1.page.locator('[data-testid="phone-panel-host"][data-panel-type="clip-properties"]'), 'All parameters opens Properties').toBeVisible()
  await cancel(m1)

  await openAudioFx(m1, tone.id)
  await tapOn(m1, m1.page.getByTestId(`${FX.sectionPrefix}ai`))
  await expect(m1.page.getByTestId(FX.stemsStatus)).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(FX.aiStudio))
  await expect(m1.page.locator('[data-testid="phone-panel-host"][data-panel-type="ai-studio"]'), 'AI Studio opens in the phone').toBeVisible()
  await cancel(m1)

  await openAudioFx(m1, tone.id)
  await tapOn(m1, m1.page.getByTestId(FX.trackEffects))
  await expectHandedOver(m1, 'mixer')
  await expect(m1.page.locator('.audio-mixer-panel'), 'the desktop mixer (track and master effects) renders').toBeVisible()
})

test('INV-4/audio-parameter-automation: Effect curves keeps the added effect as one undo step and opens Curves on the clip @phone', async ({ m1 }) => {
  const tone = await importAudio(m1, media.tone)
  await openAudioFx(m1, tone.id)
  await addEffect(m1, 'audio-reverb')
  await tapOn(m1, m1.page.getByTestId(FX.effectCurves))
  const state = await expectHandedOver(m1, 'curves')
  expect(state.selected, 'Curves shows the clip').toEqual([tone.id])
  expect((await audioFxOf(m1.page, tone.id)).map(effect => effect.descriptorId), 'the effect was kept before the editor opened').toEqual(['audio-reverb'])
  await leaveWorkspace(m1)
  await undoOnce(m1)
  await expect.poll(async () => (await audioFxOf(m1.page, tone.id)).length, { message: 'one Undo removes the effect again' }).toBe(0)
})
