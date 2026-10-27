import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_AUDIO_TEST_IDS as AUDIO } from '../../../src/components/mobileSkin/audio/phoneAudioTestIds'
import { PHONE_SCORE_TEST_IDS as SCORE } from '../../../src/components/mobileSkin/audioRegions/phoneScoreTestIds'
import { IDS, expect, tapAction, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { historyProbe } from './m2AudioFixture'
import { scoreState } from './m7AudioRegionsFixture'

/**
 * G4 phone journeys of the Notation sheet: the desktop score editor inline on the phone with a
 * touch bar for the keyboard-only commands. Truth: the clip's stored scoreData read back through
 * the editor's ScoreModel, the rendered VexFlow SVG, and scoreToEvents for playback timing.
 */
test.describe.configure({ timeout: 180_000 })

async function openNotationWithNewClip(m1: M1Session): Promise<string> {
  await m1.bridge.toolData('clearSelection')
  await tapAction(m1, phoneActionTestId('audio'))
  await expect(m1.sheet).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(AUDIO.notation))
  await expect(m1.page.getByTestId(SCORE.empty), 'without a score clip the sheet offers to add one').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(SCORE.create))
  const root = m1.page.getByTestId(SCORE.root)
  await expect(root).not.toHaveAttribute('data-clip-id', '')
  await expect(m1.page.getByTestId(SCORE.touchBar), 'the editor and its touch bar are up').toBeVisible({ timeout: 30_000 })
  return (await root.getAttribute('data-clip-id'))!
}

/** Taps the staff of the first measure (entry mode places a quarter note there). */
async function tapStaff(m1: M1Session) {
  const svg = m1.page.locator('.se-sheet svg').first()
  await expect(svg).toBeVisible()
  const staff = m1.page.locator('.se-sheet svg .vf-stave').first()
  const box = (await (await staff.count() > 0 ? staff : svg).boundingBox())!
  // Past clef and time signature of the first measure, on the middle staff line.
  const point = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 }
  await m1.touch.tap(point)
}

const key = (m1: M1Session, testId: string) => tapOn(m1, m1.page.getByTestId(testId))
const sounding = (notes: Array<{ rest: boolean }>) => notes.filter(note => !note.rest)

test('INV4/audio-score-editing: notes, chord, rest, stem and tie are written by touch only; the SVG and stored notation follow; Undo takes back one step @phone', async ({ m1 }) => {
  const clipId = await openNotationWithNewClip(m1)
  await tapStaff(m1)
  await expect.poll(async () => sounding((await scoreState(m1.page, clipId))?.notes ?? []).length, { message: 'a staff tap enters a note' }).toBe(1)

  await key(m1, `${SCORE.letterPrefix}d`)
  await key(m1, `${SCORE.letterPrefix}e`)
  await key(m1, SCORE.chordMode)
  await key(m1, `${SCORE.letterPrefix}g`)
  await key(m1, SCORE.chordMode)
  await key(m1, `${SCORE.actionPrefix}enterRest`)
  await expect.poll(async () => {
    const notes = (await scoreState(m1.page, clipId))?.notes ?? []
    const steps = sounding(notes).map(note => note.step)
    const e = notes.find(note => note.step === 'E')
    const g = notes.find(note => note.step === 'G')
    return { d: steps.includes('D'), chord: Boolean(e && g && e.beat === g.beat && e.measure === g.measure), rest: notes.some(note => note.rest && note.beat > 0) }
  }, { message: 'letters, chord note and rest are in the stored notation' }).toEqual({ d: true, chord: true, rest: true })

  // Every stored slot (a note, chord or rest at one measure/beat) is drawn as one VexFlow stave note.
  const stored = (await scoreState(m1.page, clipId))!.notes
  const slots = new Set(stored.map(note => `${note.measure}:${note.beat}`)).size
  test.info().annotations.push({ type: 'score-notes', description: JSON.stringify(stored) })
  await expect(m1.page.locator('.se-sheet svg .vf-stavenote'), 'the SVG draws every stored slot').toHaveCount(slots)

  await key(m1, `${SCORE.actionPrefix}selectPreviousNote`)
  await key(m1, `${SCORE.actionPrefix}selectPreviousNote`)
  await key(m1, `${SCORE.actionPrefix}flipStemDirection`)
  await expect.poll(async () => ((await scoreState(m1.page, clipId))?.notes ?? []).some(note => note.stem !== 'auto'), { message: 'Flip stem stores a stem direction' }).toBe(true)

  await tapOn(m1, m1.page.locator('.se-toolbar button[title^="Tie to next note"]'))
  await expect.poll(async () => ((await scoreState(m1.page, clipId))?.notes ?? []).some(note => note.tied), { message: 'the tie is stored' }).toBe(true)

  const revision = (await historyProbe(m1.page)).revisionId
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  await m1.bridge.toolData('clearSelection')
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => (await historyProbe(m1.page)).revisionId).not.toBe(revision)
  await waitForIdle(m1)
  await expect.poll(async () => ((await scoreState(m1.page, clipId))?.notes ?? []).some(note => note.tied), { message: 'one Undo takes back the tie only' }).toBe(false)
  expect(sounding((await scoreState(m1.page, clipId))?.notes ?? []).length, 'the notes stay').toBeGreaterThanOrEqual(3)
})

test('INV4/audio-score-audition: Play sounds the notation with exact note times and the sheet states that score clips do not sound in timeline or export @phone', async ({ m1 }) => {
  const clipId = await openNotationWithNewClip(m1)
  await expect(m1.page.getByTestId(SCORE.limit)).toContainText('do not sound in the timeline or the export')
  await tapStaff(m1)
  await expect.poll(async () => sounding((await scoreState(m1.page, clipId))?.notes ?? []).length).toBe(1)
  await key(m1, `${SCORE.letterPrefix}d`)
  await key(m1, `${SCORE.letterPrefix}e`)
  const state = await scoreState(m1.page, clipId)
  expect(state!.events.length, 'three sounding notes').toBe(3)
  const quarter = 60 / state!.tempo
  expect(state!.events[1].start - state!.events[0].start).toBeCloseTo(quarter, 6)
  expect(state!.events[2].start - state!.events[1].start).toBeCloseTo(quarter, 6)

  const play = m1.page.locator('.se-toolbar button[title="Play the score"]')
  await tapOn(m1, play)
  await expect(m1.page.locator('.se-toolbar button[title="Stop"]'), 'the score plays').toBeVisible({ timeout: 15_000 })
  await expect(m1.page.locator('.se-toolbar button[title="Play the score"]'), 'and stops by itself after the last note').toBeVisible({ timeout: 30_000 })
})
