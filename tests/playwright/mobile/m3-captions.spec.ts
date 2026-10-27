import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_CAPTIONS_TEST_IDS as CAP } from '../../../src/components/mobileSkin/captions/phoneCaptionsTestIds'
import {
  IDS, differingShare, expect, importViaSheet, previewPixels, seek, tapAction, tapOn, test, waitForIdle, type M1Session, type M1Timeline,
} from './m1Fixture'
import { generateM2AudioMedia, historyProbe, waitForSourcesVerified, type M2AudioMedia } from './m2AudioFixture'
import {
  captionClips, m3Snapshot, setTranscript, setTranscriptionProvider, transcriptWords, transcriptionProvider, type ProbeWord,
} from './m3CaptionsAudioFixture'

/**
 * M3 "Profi-Blätter" captions of the phone skin (packet Q3): the 'captions' sheet on the editor's own
 * caption clips. One catalog case per test in the shared M1 phone world (a fresh empty composition per
 * test). The speech recogniser is replaced by a fixed provider answer (three words on a 2 s frame-code
 * clip with sound) written through the editor's own transcript path; everything under test is real
 * touch. Truth: preview pixels for "captions are drawn", the store for words and settings, and a
 * timeline snapshot (clips, captions, effects, keyframes) for "unchanged" and "one Undo restores".
 */
test.describe.configure({ timeout: 180_000 })

const WORDS: ProbeWord[] = [
  { id: 'w1', text: 'hello', start: 0.3, end: 0.7 },
  { id: 'w2', text: 'phone', start: 0.8, end: 1.2 },
  { id: 'w3', text: 'world', start: 1.3, end: 1.7 },
]

let media: M2AudioMedia
test.beforeAll(async () => { media = await generateM2AudioMedia() })

const videoClipOf = (state: M1Timeline) => state.all.find(clip => clip.trackType === 'video')
const videoLength = (state: M1Timeline) => state.main.reduce((sum, clip) => sum + clip.duration, 0)

/** A 2 s frame-code video with sound and the fixed transcript on it. */
async function spokenVideo(m1: M1Session) {
  const state = await importViaSheet(m1, { visual: [media.videoWithTone] }, { total: 2 })
  const video = videoClipOf(state)
  expect(video, 'the video lands on a video track').toBeTruthy()
  await waitForSourcesVerified(m1.page)
  await setTranscript(m1.page, video!.id, WORDS)
  return video!
}

async function nothingSelected(m1: M1Session) {
  await m1.bridge.toolData('clearSelection')
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'root')
}

async function openCaptions(m1: M1Session) {
  await historyProbe(m1.page)
  await nothingSelected(m1)
  await tapAction(m1, phoneActionTestId('captions'))
  await expect(m1.sheet, 'the Captions sheet opened').toBeVisible()
}

/** Arrangement only: captions bound to the video through the editor tool (the creation itself is case 2). */
async function arrangeCaptions(m1: M1Session, videoId: string): Promise<string> {
  await m1.bridge.toolData('createCaptionClip', { sourceClipId: videoId })
  await expect.poll(async () => (await captionClips(m1.page)).length, { message: 'the caption clip exists' }).toBe(1)
  await waitForIdle(m1)
  return (await captionClips(m1.page))[0].id
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
  const history = await historyProbe(m1.page)
  const revision = history.revisionId
  test.info().annotations.push({ type: 'history-before-undo', description: JSON.stringify(history) })
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => (await historyProbe(m1.page)).revisionId, { message: 'Undo moved to another revision' }).not.toBe(revision)
  await waitForIdle(m1)
}

async function typeInto(m1: M1Session, testId: string, value: string) {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(value)
  await field.blur()
}

const word = (m1: M1Session, wordId: string) => m1.page.locator(`[data-testid="${CAP.word}"][data-word-id="${wordId}"]`)

test('INV6/transcription-provider-settings: signed out, hosted providers are greyed with a reason and "On this phone" makes transcription ready @phone', async ({ m1 }) => {
  await spokenVideo(m1)
  const original = await transcriptionProvider(m1.page)
  try {
    await setTranscriptionProvider(m1.page, 'hybrid')
    await openCaptions(m1)
    const account = m1.page.getByTestId(CAP.account)
    await expect(account).toHaveAttribute('data-signed-in', 'false')
    await expect(account).toHaveAttribute('data-ready', 'false')
    const hosted = m1.page.locator(`[data-testid="${CAP.provider}"][data-provider="deepgram"]`)
    await expect(hosted).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, hosted)
    const notice = m1.page.getByTestId(IDS.unavailableNotice)
    await expect(notice, 'a hosted provider explains what it needs').toContainText('signed-in account')
    await tapOn(m1, notice.getByRole('button').last())
    await expect(m1.page.getByTestId(CAP.sourceTranscribe).first()).toHaveAttribute('aria-disabled', 'true')

    await tapOn(m1, m1.page.getByTestId(CAP.useLocal))
    await expect(account).toHaveAttribute('data-ready', 'true')
    expect(await transcriptionProvider(m1.page), 'the editor setting the transcriber reads').toBe('local')
    await expect(m1.page.locator(`[data-testid="${CAP.provider}"][data-provider="local"]`)).toHaveAttribute('aria-pressed', 'true')
    await expect(m1.page.getByTestId(CAP.sourceState).first(), 'the fixed transcript shows on its source').toContainText('3 words')
    await cancel(m1)
  } finally {
    await setTranscriptionProvider(m1.page, original)
  }
})

test('INV4/audio-dynamic-captions: a transcript becomes captions drawn over the spoken frames; Done adds them, one Undo removes them @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await seek(m1, 0.5)
  await nothingSelected(m1)
  const before = await m3Snapshot(m1.page)
  const pixelsBefore = await previewPixels(m1.probe)

  await openCaptions(m1)
  const source = m1.page.locator(`[data-testid="${CAP.source}"][data-clip-id="${video.id}"]`)
  await expect(source).toHaveAttribute('data-transcript', 'ready')
  await tapOn(m1, source.getByTestId(CAP.sourceCreate))
  await expect(m1.page.getByTestId(CAP.group), 'the words tab lists the caption').toHaveCount(1)
  await expect(m1.page.getByTestId(CAP.word)).toHaveText(['hello', 'phone', 'world'])
  await done(m1)

  const captions = await captionClips(m1.page)
  expect(captions.map(caption => caption.sourceClipId), 'one caption clip bound to the spoken clip').toEqual([video.id])
  await seek(m1, 0.5)
  await expect.poll(async () => differingShare(pixelsBefore, await previewPixels(m1.probe)), { message: 'the caption is drawn over the spoken frame', timeout: 20_000 })
    .toBeGreaterThan(0.002)

  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo removes the captions exactly' }).toBe(before)
  await seek(m1, 0.5)
  await expect.poll(async () => differingShare(pixelsBefore, await previewPixels(m1.probe)), { message: 'the frame is clean again', timeout: 20_000 }).toBeLessThan(0.001)
  await setTranscript(m1.page, video.id, null)
})

test('INV5/captions-word-correction: Save corrects the shared word and keeps its time; Cancel writes the old word back @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await arrangeCaptions(m1, video.id)

  await openCaptions(m1)
  await expect(m1.page.getByTestId(`${CAP.sectionPrefix}words`)).toHaveAttribute('aria-selected', 'true')
  await tapOn(m1, word(m1, 'w2'))
  await typeInto(m1, CAP.wordInput, 'two words')
  await tapOn(m1, m1.page.getByTestId(CAP.wordSave))
  await expect(m1.page.getByTestId(CAP.wordError), 'two words are refused with a reason').toContainText('One word')
  await typeInto(m1, CAP.wordInput, 'Phone')
  await tapOn(m1, m1.page.getByTestId(CAP.wordSave))
  await expect(word(m1, 'w2')).toHaveText('Phone')
  expect((await transcriptWords(m1.page, video.id)).find(entry => entry.id === 'w2'), 'the transcript word changes, its time stays')
    .toEqual({ id: 'w2', text: 'Phone', start: 0.8, end: 1.2 })
  await cancel(m1)
  expect((await transcriptWords(m1.page, video.id)).map(entry => entry.text), 'Cancel writes the old word back').toEqual(['hello', 'phone', 'world'])

  await openCaptions(m1)
  await tapOn(m1, word(m1, 'w3'))
  await typeInto(m1, CAP.wordInput, 'World!')
  await tapOn(m1, m1.page.getByTestId(CAP.wordSave))
  await done(m1)
  expect((await transcriptWords(m1.page, video.id)).map(entry => entry.text), 'Done keeps the correction').toEqual(['hello', 'phone', 'World!'])
  await setTranscript(m1.page, video.id, null)
})

test('INV4/audio-caption-style-highlighting: the Pop preset sets capitals and a word box; Done is one undo step @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await arrangeCaptions(m1, video.id)
  await nothingSelected(m1)
  const before = await m3Snapshot(m1.page)

  await openCaptions(m1)
  await tapOn(m1, m1.page.getByTestId(`${CAP.sectionPrefix}style`))
  await expect(m1.page.locator(`[data-testid="${CAP.preset}"][data-preset="clean"]`), 'a new caption matches Clean').toHaveAttribute('aria-pressed', 'true')
  await tapOn(m1, m1.page.locator(`[data-testid="${CAP.preset}"][data-preset="pop"]`))
  await expect(m1.page.locator(`[data-testid="${CAP.preset}"][data-preset="pop"]`)).toHaveAttribute('aria-pressed', 'true')
  await typeInto(m1, CAP.fontSize, '90')
  await expect.poll(async () => (await captionClips(m1.page))[0]?.fontSize).toBe(90)
  await done(m1)

  expect(await captionClips(m1.page), 'the caption carries the preset').toEqual([expect.objectContaining({ textTransform: 'uppercase', highlightStyle: 'background', fontSize: 90 })])
  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo restores the whole style' }).toBe(before)
  await setTranscript(m1.page, video.id, null)
})

test('INV4/audio-caption-timing-layout: one word per caption gives three captions live; Cancel restores five @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await arrangeCaptions(m1, video.id)
  await nothingSelected(m1)
  const before = await m3Snapshot(m1.page)

  await openCaptions(m1)
  await expect(m1.page.getByTestId(CAP.group)).toHaveCount(1)
  await tapOn(m1, m1.page.getByTestId(`${CAP.sectionPrefix}timing`))
  await typeInto(m1, CAP.wordsPerCaption, '1')
  await expect.poll(async () => (await captionClips(m1.page))[0]?.wordsPerCaption).toBe(1)
  await tapOn(m1, m1.page.getByTestId(`${CAP.sectionPrefix}words`))
  await expect(m1.page.getByTestId(CAP.group), 'each word is its own caption').toHaveCount(3)
  await cancel(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'Cancel restores the grouping exactly' }).toBe(before)
  await setTranscript(m1.page, video.id, null)
})

test('INV8/transcript-based-editing: Cut word removes the word from the video; one Undo restores @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await arrangeCaptions(m1, video.id)
  await nothingSelected(m1)
  const before = await m3Snapshot(m1.page)
  const durationBefore = videoLength(await m1.timeline())

  await openCaptions(m1)
  await tapOn(m1, word(m1, 'w2'))
  await tapOn(m1, m1.page.getByTestId(CAP.wordCut))
  await expect(m1.page.getByTestId(CAP.word), 'the cut word is gone from the captions').toHaveText(['hello', 'world'])
  await done(m1)
  await expect.poll(async () => videoLength(await m1.timeline()), { message: 'the video is shorter by the word' }).toBeLessThan(durationBefore - 0.3)

  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo puts the word back' }).toBe(before)
  await setTranscript(m1.page, video.id, null)
})

test('INV4/audio-dynamic-captions: Delete removes the captions; later tools are greyed and explain themselves @phone', async ({ m1 }) => {
  const video = await spokenVideo(m1)
  await arrangeCaptions(m1, video.id)
  await nothingSelected(m1)
  const before = await m3Snapshot(m1.page)

  await openCaptions(m1)
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  for (const id of ['word-timing', 'preview-edit', 'subtitle-file']) {
    const control = m1.page.getByTestId(`${CAP.unavailablePrefix}${id}`)
    await expect(control).toHaveAttribute('aria-disabled', 'true')
    await tapOn(m1, control)
    await expect(notice, `${id} explains itself`).toBeVisible()
    expect((await notice.innerText()).trim().length).toBeGreaterThan(20)
    await tapOn(m1, notice.getByRole('button').last())
    await expect(notice).toBeHidden()
  }
  await tapOn(m1, m1.page.getByTestId(CAP.deleteCaptions))
  await expect(m1.page.getByTestId(`${CAP.sectionPrefix}words`), 'without captions the Words tab is greyed').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(`${CAP.sectionPrefix}style`))
  await expect(notice).toContainText('Generate')
  await tapOn(m1, notice.getByRole('button').last())
  await done(m1)
  expect(await captionClips(m1.page), 'the caption clip is gone').toEqual([])
  await undoOnce(m1)
  await expect.poll(async () => m3Snapshot(m1.page), { message: 'one Undo brings the captions back' }).toBe(before)
  await setTranscript(m1.page, video.id, null)
})
