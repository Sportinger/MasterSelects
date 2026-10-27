import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_AUDIO_REGION_TEST_IDS as REGION } from '../../../src/components/mobileSkin/audioRegions/phoneAudioRegionTestIds'
import {
  IDS, expect, importViaSheet, tapAction, tapClip, tapOn, test, waitForIdle, type M1Session,
} from './m1Fixture'
import { historyProbe, timelineSnapshot, waitForSourcesVerified } from './m2AudioFixture'
import { channelCorrelation, channelRms, generateM7RegionMedia, regionState, type M7RegionMedia } from './m7AudioRegionsFixture'

/**
 * G4 phone journeys: the Sound range sheet (audioRegions/PhoneAudioRegionSheet.tsx), one catalog
 * case per test in the M1 phone world (one project built through the phone UI, a fresh composition
 * per test). Every action under test is real touch; typed values go into the visible fields.
 * Truth: the clip's audio edit stack in the editor store and the export's own PCM mix per channel
 * (m7AudioRegionsFixture.ts). Done is one undo step, Cancel leaves the timeline snapshot unchanged.
 */
test.describe.configure({ timeout: 180_000 })

let media: M7RegionMedia
test.beforeAll(async () => { media = await generateM7RegionMedia() })

async function importAudio(m1: M1Session, file: string) {
  const state = await importViaSheet(m1, { audio: [file] }, { total: 1 })
  const audio = state.all.find(clip => clip.trackType === 'audio')
  expect(audio, 'the sound lands on an audio track').toBeTruthy()
  await waitForSourcesVerified(m1.page)
  return audio!
}

async function openRange(m1: M1Session, clipId: string) {
  await historyProbe(m1.page)
  await m1.bridge.toolData('clearSelection')
  await tapClip(m1, clipId)
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'clip')
  await tapAction(m1, phoneActionTestId('sound-range'))
  await expect(m1.page.getByTestId(REGION.root), 'the Sound range sheet opened').toHaveAttribute('data-clip-id', clipId)
}

async function typeSeconds(m1: M1Session, testId: string, value: number) {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(String(value))
  await field.press('Enter')
}

/** Types the range (seconds from the clip start) and waits until the store holds it. */
async function setRange(m1: M1Session, start: number, end: number, clipStart = 0) {
  // Type the edge first that keeps the range ordered (a new range left of the old one: start first).
  const current = (await regionState(m1.page)).selection
  if (current && end <= current.startTime - clipStart) {
    await typeSeconds(m1, REGION.startInput, start)
    await typeSeconds(m1, REGION.endInput, end)
  } else {
    await typeSeconds(m1, REGION.endInput, end)
    await typeSeconds(m1, REGION.startInput, start)
  }
  await expect.poll(async () => {
    const selection = (await regionState(m1.page)).selection
    return selection ? [Number((selection.startTime - clipStart).toFixed(3)), Number((selection.endTime - clipStart).toFixed(3))] : null
  }, { message: 'the typed range is the editor selection' }).toEqual([start, end])
}

async function section(m1: M1Session, id: string) {
  await tapOn(m1, m1.page.getByTestId(`${REGION.sectionPrefix}${id}`))
}

async function command(m1: M1Session, key: string) {
  await tapOn(m1, m1.page.getByTestId(`${REGION.commandPrefix}${key}`))
}

async function edits(m1: M1Session, clipId: string) {
  return (await regionState(m1.page)).clips.find(clip => clip.id === clipId)?.edits ?? []
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

async function undoOnce(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => {
    const history = await historyProbe(m1.page)
    return history.openGestures || history.openTransactions.length > 0
  }, { message: 'no edit transaction is open before Undo', timeout: 30_000 }).toBe(false)
  const revision = (await historyProbe(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => (await historyProbe(m1.page)).revisionId, { message: 'Undo moved to another revision' }).not.toBe(revision)
  await waitForIdle(m1)
}

const left = (values: number[][], index: number) => values[index][0]

test('INV4/audio-region-selection: a touch drag selects a range, Move shifts it without moving the clip, typed edges are exact and Silence hits exactly that range @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.tone)
  const before = await timelineSnapshot(m1.page)
  await openRange(m1, audio.id)

  const strip = m1.page.getByTestId(REGION.waveform)
  const box = (await strip.boundingBox())!
  await m1.touch.pan({ x: box.x + box.width * 0.25, y: box.y + box.height / 2 }, { x: box.width * 0.25, y: 0 })
  let selection = (await regionState(m1.page)).selection
  expect(selection, 'the drag made a range').not.toBeNull()
  expect(selection!.startTime - audio.start).toBeCloseTo(0.5, 1)
  expect(selection!.endTime - audio.start).toBeCloseTo(1.0, 1)

  // Drawn range matches the selection: its box spans the same share of the strip.
  const range = (await m1.page.getByTestId(REGION.range).boundingBox())!
  expect((range.x - box.x) / box.width).toBeCloseTo((selection!.startTime - audio.start) / audio.duration, 1)
  expect(range.width / box.width).toBeCloseTo((selection!.endTime - selection!.startTime) / audio.duration, 1)

  await tapOn(m1, m1.page.getByTestId(`${REGION.modePrefix}move`))
  await expect(strip).toHaveAttribute('data-mode', 'move')
  const length = selection!.endTime - selection!.startTime
  await m1.touch.pan({ x: range.x + range.width / 2, y: box.y + box.height / 2 }, { x: box.width * 0.2, y: 0 })
  selection = (await regionState(m1.page)).selection
  expect(selection!.startTime - audio.start, 'Move shifted the range').toBeGreaterThan(0.7)
  expect(selection!.endTime - selection!.startTime, 'Move kept the length').toBeCloseTo(length, 2)
  expect((await regionState(m1.page)).clips.find(clip => clip.id === audio.id)!.startTime, 'the clip did not move').toBeCloseTo(audio.start, 6)

  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'time')
  await command(m1, 'silence')
  await expect.poll(async () => (await edits(m1, audio.id)).map(edit => edit.type), { message: 'Silence is on the edit stack' }).toEqual(['silence'])
  const levels = await channelRms(m1.page, audio.start, audio.start + 2, [[0.1, 0.45], [0.55, 1.45], [1.55, 1.95]].map(([a, b]) => [audio.start + a, audio.start + b]) as Array<[number, number]>)
  expect(left(levels, 0), 'before the range: unchanged').toBeGreaterThan(0.3)
  expect(left(levels, 1), 'inside the range: silent').toBeLessThan(0.01)
  expect(left(levels, 2), 'after the range: unchanged').toBeGreaterThan(0.3)

  await cancel(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel leaves the timeline as it was' }).toBe(before)
  expect(await edits(m1, audio.id), 'Cancel removed the silence').toEqual([])
})

test('INV4/audio-region-clipboard: copy a tone range, paste it into the silent half, cut it at the origin; Done is one undo step @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.toneThenSilence)
  const t = (value: number) => audio.start + value
  const before = await channelRms(m1.page, t(0), t(2), [[t(0.25), t(0.55)], [t(1.25), t(1.55)]])
  expect(left(before, 1), 'the second half starts silent').toBeLessThan(0.005)
  await openRange(m1, audio.id)

  await setRange(m1, 0.2, 0.6, audio.start)
  await command(m1, 'copy')
  await expect.poll(async () => (await regionState(m1.page)).clipboard?.duration, { message: 'the range is on the clipboard' }).toBeCloseTo(0.4, 3)
  await setRange(m1, 1.2, 1.6, audio.start)
  await command(m1, 'paste-region')
  await expect.poll(async () => (await edits(m1, audio.id)).map(edit => edit.type)).toEqual(['paste'])
  await expect.poll(async () => left(await channelRms(m1.page, t(0), t(2), [[t(1.25), t(1.55)]]), 0), { message: 'the tone now sounds in the pasted range', timeout: 30_000 }).toBeGreaterThan(0.3)

  await setRange(m1, 0.2, 0.6, audio.start)
  await command(m1, 'cut')
  await expect.poll(async () => left(await channelRms(m1.page, t(0), t(2), [[t(0.25), t(0.55)]]), 0), { message: 'Cut leaves a gap at the origin', timeout: 30_000 }).toBeLessThan(0.005)
  const after = await channelRms(m1.page, t(0), t(2), [[t(0.05), t(0.15)], [t(0.65), t(0.95)]])
  expect(left(after, 0), 'the sound before the cut stays').toBeGreaterThan(0.3)
  expect(left(after, 1), 'the sound after the cut stays').toBeGreaterThan(0.3)
  await done(m1)

  await undoOnce(m1)
  await expect.poll(async () => {
    const levels = await channelRms(m1.page, t(0), t(2), [[t(0.25), t(0.55)], [t(1.25), t(1.55)]])
    return [left(levels, 0) > 0.3, left(levels, 1) < 0.005]
  }, { message: 'one Undo takes back paste and cut together', timeout: 30_000 }).toEqual([true, true])
})

test('INV4/audio-region-gain-fades: -12 dB on a phrase with fades shapes the PCM; Done is one undo step, Cancel changes nothing @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.tone)
  const t = (value: number) => audio.start + value
  const before = await timelineSnapshot(m1.page)
  await openRange(m1, audio.id)
  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'level')
  await typeSeconds(m1, REGION.gainInput, -12)
  await typeSeconds(m1, REGION.fadeInInput, 0.2)
  await typeSeconds(m1, REGION.fadeOutInput, 0.2)
  await expect.poll(async () => {
    const gain = (await edits(m1, audio.id)).filter(edit => edit.type === 'gain')
    return gain.map(edit => [edit.params.gainDb, edit.params.fadeInSeconds, edit.params.fadeOutSeconds])
  }, { message: 'one gain edit carries level and fades' }).toEqual([[-12, 0.2, 0.2]])

  const levels = await channelRms(m1.page, t(0), t(2), [[t(0.1), t(0.45)], [t(0.5), t(0.6)], [t(0.8), t(1.2)], [t(1.6), t(1.9)]])
  const ratio = left(levels, 2) / left(levels, 0)
  expect(ratio, 'the middle is 12 dB quieter').toBeGreaterThan(0.2)
  expect(ratio).toBeLessThan(0.3)
  expect(left(levels, 1), 'the fade-in starts louder than the middle').toBeGreaterThan(left(levels, 2))
  expect(left(levels, 3) / left(levels, 0), 'after the range: unchanged').toBeGreaterThan(0.95)

  await cancel(m1)
  await expect.poll(async () => timelineSnapshot(m1.page), { message: 'Cancel leaves the timeline as it was' }).toBe(before)

  await openRange(m1, audio.id)
  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'level')
  await typeSeconds(m1, REGION.gainInput, -12)
  await expect.poll(async () => (await edits(m1, audio.id)).length).toBe(1)
  await done(m1)
  await undoOnce(m1)
  await expect.poll(async () => (await edits(m1, audio.id)).length, { message: 'one Undo removes the gain edit' }).toBe(0)
})

test('INV4/audio-region-time-channel-operations: swap L/R, mono sum and polarity work by touch on a left-only file @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.leftOnly)
  const t = (value: number) => audio.start + value
  await openRange(m1, audio.id)
  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'time')

  await command(m1, 'swap-channels')
  await expect.poll(async () => {
    const [outside, inside] = await channelRms(m1.page, t(0), t(2), [[t(0.1), t(0.45)], [t(0.6), t(1.4)]])
    return [outside[0] > 0.3, outside[1] < 0.005, inside[0] < 0.005, inside[1] > 0.3]
  }, { message: 'inside the range the tone moved to the right channel', timeout: 30_000 }).toEqual([true, true, true, true])

  await command(m1, 'mono-sum')
  await expect.poll(async () => {
    const [inside] = await channelRms(m1.page, t(0), t(2), [[t(0.6), t(1.4)]])
    return Math.abs(inside[0] - inside[1]) < 0.01 && inside[0] > 0.1
  }, { message: 'mono sum: both channels carry the same sound', timeout: 30_000 }).toBe(true)

  await tapOn(m1, m1.page.getByTestId(`${REGION.channelPrefix}left`))
  await command(m1, 'invert-polarity')
  await expect.poll(async () => channelCorrelation(m1.page, t(0), t(2), t(0.6), t(1.4)), {
    message: 'inverting only the left channel makes the channels opposite', timeout: 30_000,
  }).toBeLessThan(-0.9)
  const types = (await edits(m1, audio.id)).map(edit => [edit.type, edit.channelMask])
  expect(types).toEqual([['swap-channels', null], ['mono-sum', null], ['invert-polarity', [0]]])
  const clip = (await regionState(m1.page)).clips.find(candidate => candidate.id === audio.id)!
  expect(clip.duration, 'the clip keeps its length').toBeCloseTo(audio.duration, 6)
  await cancel(m1)
})

test('INV4/audio-region-effects: every region preset is offered; the high-pass changes only the selected middle range of a 40 Hz rumble @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.rumble)
  const t = (value: number) => audio.start + value
  await openRange(m1, audio.id)
  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'fx')
  for (const key of ['fx-high-pass', 'fx-low-pass', 'fx-presence', 'fx-compressor', 'fx-de-esser', 'fx-noise-gate']) {
    await expect(m1.page.getByTestId(`${REGION.commandPrefix}${key}`), `${key} is offered`).toBeVisible()
  }
  await command(m1, 'fx-high-pass')
  await expect.poll(async () => (await edits(m1, audio.id)).map(edit => [edit.type, edit.params.effectDescriptorId])).toEqual([['effect', 'audio-high-pass']])
  await expect.poll(async () => {
    const levels = await channelRms(m1.page, t(0), t(2), [[t(0.1), t(0.45)], [t(0.7), t(1.3)], [t(1.6), t(1.9)]])
    return { cut: left(levels, 1) < left(levels, 0) * 0.5, before: left(levels, 0) > 0.3, after: left(levels, 2) / left(levels, 0) > 0.95 }
  }, { message: 'the high-pass removes most of the rumble only inside the range', timeout: 30_000 }).toEqual({ cut: true, before: true, after: true })
  await done(m1)
  await undoOnce(m1)
  await expect.poll(async () => (await edits(m1, audio.id)).length, { message: 'one Undo removes the effect' }).toBe(0)
})

test('INV4/audio-region-repair: Match RMS brings the range to -20 dB and Bypass in the stack restores it @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.tone)
  const t = (value: number) => audio.start + value
  await openRange(m1, audio.id)
  await setRange(m1, 0.5, 1.5, audio.start)
  await section(m1, 'repair')
  for (const key of ['hum-notch', 'de-click', 'splice-smooth', 'loudness-match']) {
    await expect(m1.page.getByTestId(`${REGION.commandPrefix}${key}`), `${key} is offered`).toBeVisible()
  }
  await command(m1, 'loudness-match')
  await expect.poll(async () => (await edits(m1, audio.id)).map(edit => [edit.type, edit.params.repairType])).toEqual([['repair', 'loudness-match']])
  await expect.poll(async () => left(await channelRms(m1.page, t(0), t(2), [[t(0.7), t(1.3)]]), 0), {
    message: 'the range RMS is near -20 dBFS (0.1)', timeout: 30_000,
  }).toBeLessThan(0.13)
  expect(left(await channelRms(m1.page, t(0), t(2), [[t(0.7), t(1.3)]]), 0)).toBeGreaterThan(0.07)

  await section(m1, 'stack')
  await tapOn(m1, m1.page.getByTestId(REGION.stackBypass))
  await expect(m1.page.getByTestId(REGION.stackRow)).toHaveAttribute('data-enabled', 'false')
  await expect.poll(async () => left(await channelRms(m1.page, t(0), t(2), [[t(0.7), t(1.3)]]), 0), {
    message: 'bypassed, the range sounds as before', timeout: 30_000,
  }).toBeGreaterThan(0.33)
  await cancel(m1)
  expect(await edits(m1, audio.id), 'Cancel removed the repair').toEqual([])
})

test('INV4/audio-room-tone-fill: a gap is filled from the quiet passage of the clip, and the sheet says where the tone came from @phone', async ({ m1 }) => {
  const audio = await importAudio(m1, media.quietThenTone)
  const t = (value: number) => audio.start + value
  await openRange(m1, audio.id)
  await setRange(m1, 1.0, 1.5, audio.start)
  await section(m1, 'repair')
  await tapOn(m1, m1.page.getByTestId(REGION.roomTone))
  await expect(m1.page.getByTestId(REGION.message), 'the sheet names the source').toContainText(/quiet passage|generated soft noise/, { timeout: 60_000 })
  const fill = (await edits(m1, audio.id)).find(edit => edit.type === 'room-tone-fill')
  expect(fill, 'a room tone edit is on the stack').toBeTruthy()
  expect(Number(fill!.params.roomToneSourceCount), 'the quiet first passage was found').toBeGreaterThan(0)
  await expect(m1.page.getByTestId(REGION.message)).toContainText('quiet passage')
  await expect.poll(async () => {
    const [inside, tone] = await channelRms(m1.page, t(0), t(2), [[t(1.05), t(1.45)], [t(1.6), t(1.9)]])
    return { quiet: inside[0] < 0.02, notSilent: inside[0] > 0.0005, toneStays: tone[0] > 0.3 }
  }, { message: 'the range now carries soft room tone instead of the tone', timeout: 30_000 }).toEqual({ quiet: true, notSilent: true, toneStays: true })
  await done(m1)
  await undoOnce(m1)
  await expect.poll(async () => (await edits(m1, audio.id)).length, { message: 'one Undo removes the fill' }).toBe(0)
})
