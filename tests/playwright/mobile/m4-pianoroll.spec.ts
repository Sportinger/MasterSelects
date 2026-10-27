import { PHONE_PIANO_ROLL_TEST_IDS as PR } from '../../../src/components/mobileSkin/pianoroll/phonePianoRollTestIds'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { expect, tapOn, test, type M1Session } from './m1Fixture'
import {
  boxOf, centreOf, closeWorkspaceIfOpen, historySettled, landscape, openEditor, reloadIntoProject, setSide, storeMidiClips, storeNotes,
  storeSelected, twoFinger, type ProbeNote,
} from './m4AudioFixture'

/**
 * M4 "Querformat-Editoren", packet R2: the piano roll (catalog INV-4/audio-piano-roll) on the
 * phone. The desktop opens it in its own window; the phone renders the same PianoRoll component
 * inline for the selected MIDI clip. One finger edits with the active tool, two fingers pan and
 * zoom (horizontal distance = time, vertical distance = pitch). Every action under test is real
 * touch; notes are read from the timeline store.
 */
test.describe.configure({ timeout: 180_000 })

const PHRASE = [
  { time: 0.5, pitch: 72, duration: 0.5 },
  { time: 1.25, pitch: 74, duration: 0.25 },
  { time: 2, pitch: 70, duration: 0.5 },
]

test.afterEach(async ({ m1 }) => { await closeWorkspaceIfOpen(m1) })

/** A MIDI track with a three-note phrase; the piano roll opens on it via the clip list (touch). */
async function openPhrase(m1: M1Session) {
  await landscape(m1.page)
  await m1.bridge.toolData('createTrack', { type: 'midi', instrument: 'pluck', name: 'Keys' })
  const created = await m1.bridge.toolData<{ clipId: string }>('createMidiClip', { start: 0, duration: 4, notes: PHRASE })
  await historySettled(m1.page)
  const root = await openEditor(m1, 'pianoRoll')
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', false)
  await expect(root.getByTestId(PR.empty), 'without a selected MIDI clip the piano roll explains itself').toBeVisible()
  await tapOn(m1, root.getByTestId(`${PR.pick}-${created.clipId}`))
  await expect(root.getByTestId(PR.root)).toHaveAttribute('data-clip-id', created.clipId)
  const notes = root.getByTestId('piano-roll-note')
  await expect(notes).toHaveCount(PHRASE.length)
  return { root, clipId: created.clipId, notes, grid: root.getByTestId('piano-roll-grid'), roll: root.getByTestId('piano-roll') }
}

function note(root: ReturnType<M1Session['page']['locator']>, id: string) {
  return root.locator(`[data-testid="piano-roll-note"][data-note-id="${id}"]`)
}

async function notesOf(m1: M1Session, clipId: string): Promise<ProbeNote[]> {
  const notes = await storeNotes(m1.page, clipId)
  if (!notes) throw new Error(`clip ${clipId} is gone`)
  return notes
}

async function undoInRoll(m1: M1Session, root: ReturnType<M1Session['page']['locator']>) {
  await historySettled(m1.page)
  await tapOn(m1, root.getByTestId('piano-roll-action-undo'))
}

test('piano roll opens from the Editors sheet, creates a MIDI clip when none is selected, and keeps its side panels after a reload @phone', async ({ m1 }) => {
  await landscape(m1.page)
  const root = await openEditor(m1, 'pianoRoll')
  await expect(root.getByTestId(PR.empty)).toContainText('Select a MIDI clip')
  await tapOn(m1, root.getByTestId(PR.create))
  await expect.poll(async () => (await storeMidiClips(m1.page)).length, { message: 'New MIDI clip created one' }).toBe(1)
  const [clip] = await storeMidiClips(m1.page)
  expect(await storeSelected(m1.page)).toEqual([clip.id])
  await expect(root.getByTestId(PR.root)).toHaveAttribute('data-clip-id', clip.id)
  await expect(root.getByTestId('piano-roll-grid')).toBeVisible()

  await setSide(m1, 'left', true)
  await setSide(m1, 'right', false)
  await reloadIntoProject(m1)
  await openEditor(m1, 'pianoRoll')
  await expect(m1.page.getByTestId(WS.sideLeft), 'the expanded Preview stays expanded after a reload').toBeVisible()
  await expect(m1.page.getByTestId(WS.sideRight), 'the collapsed Properties stay collapsed after a reload').toBeHidden()
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', true)
  await reloadIntoProject(m1)
  await openEditor(m1, 'pianoRoll')
  await expect(m1.page.getByTestId(WS.sideLeft)).toBeHidden()
  await expect(m1.page.getByTestId(WS.sideRight)).toBeVisible()
})

test('a tap draws a note on that pitch, and the piano roll Undo removes it @phone', async ({ m1 }) => {
  const { root, clipId, grid } = await openPhrase(m1)
  const before = await notesOf(m1, clipId)
  const anchor = before.find(item => item.pitch === 72)!
  const row = await boxOf(note(root, anchor.id))
  const gridBox = await boxOf(grid)
  // Same row, right of every phrase note (3 s into the 4 s clip).
  const x = gridBox.x + gridBox.width * 0.8
  expect(x, 'the tap point lies in the visible grid').toBeLessThan((await boxOf(root.getByTestId('piano-roll-scroll'))).x + (await boxOf(root.getByTestId('piano-roll-scroll'))).width)
  await m1.touch.tap({ x, y: row.y + row.height / 2 })
  await expect.poll(async () => (await notesOf(m1, clipId)).length, { message: 'the tap added one note' }).toBe(before.length + 1)
  const added = (await notesOf(m1, clipId)).find(item => !before.some(old => old.id === item.id))!
  expect(added.pitch, 'the new note sits on the tapped row').toBe(72)
  expect(added.start).toBeGreaterThan(2.5)
  await expect(root.getByTestId('piano-roll-note')).toHaveCount(before.length + 1)

  await undoInRoll(m1, root)
  await expect.poll(async () => (await notesOf(m1, clipId)).map(item => item.id), { message: 'Undo removed the drawn note' }).toEqual(before.map(item => item.id))
})

test('a finger moves a note to another pitch and time, the note end resizes it, Undo restores each @phone', async ({ m1 }) => {
  const { root, clipId, roll } = await openPhrase(m1)
  const before = await notesOf(m1, clipId)
  const target = before.find(item => item.pitch === 72)!
  const rowH = Number(await roll.getAttribute('data-row-height'))
  const pxPerSec = Number(await roll.getAttribute('data-px-per-sec'))
  const box = await boxOf(note(root, target.id))
  // Move: grab the body (left quarter), up a row (C#5, free) and right by half a second.
  await m1.touch.pan({ x: box.x + box.width * 0.25, y: box.y + box.height / 2 }, { x: pxPerSec * 0.5, y: -rowH })
  await expect.poll(async () => (await notesOf(m1, clipId)).find(item => item.id === target.id)?.pitch, { message: 'the note moved up a semitone' }).toBe(73)
  const moved = (await notesOf(m1, clipId)).find(item => item.id === target.id)!
  expect(moved.start, 'the note moved later').toBeGreaterThan(target.start + 0.3)
  expect(moved.duration).toBeCloseTo(target.duration, 6)

  // Resize: the last few pixels of the note grab its length (once the moved note is drawn there).
  await expect.poll(async () => (await boxOf(note(root, target.id))).y, { message: 'the moved note is drawn a row up' }).toBeLessThan(box.y - rowH * 0.5)
  const movedBox = await boxOf(note(root, target.id))
  await m1.touch.pan({ x: movedBox.x + movedBox.width - 4, y: movedBox.y + movedBox.height / 2 }, { x: pxPerSec * 0.5, y: 0 })
  await expect.poll(async () => (await notesOf(m1, clipId)).find(item => item.id === target.id)?.duration, { message: 'dragging the end made the note longer' }).toBeGreaterThan(target.duration + 0.3)
  const resized = (await notesOf(m1, clipId)).find(item => item.id === target.id)!

  expect(resized.start).toBeCloseTo(moved.start, 6)
  expect(resized.pitch).toBe(73)

  await undoInRoll(m1, root)
  await expect.poll(async () => (await notesOf(m1, clipId)).find(item => item.id === target.id)?.duration, { message: 'Undo restored the length' }).toBeCloseTo(target.duration, 6)
  await undoInRoll(m1, root)
  await expect.poll(async () => (await notesOf(m1, clipId)).find(item => item.id === target.id), { message: 'Undo restored pitch and time' }).toEqual(target)
})

test('the eraser and the select tool with Delete remove notes by touch @phone', async ({ m1 }) => {
  const { root, clipId } = await openPhrase(m1)
  const before = await notesOf(m1, clipId)
  await tapOn(m1, root.getByTestId('piano-roll-tool-eraser'))
  await expect(root.getByTestId('piano-roll')).toHaveAttribute('data-tool', 'eraser')
  const first = before.find(item => item.pitch === 72)!
  await m1.touch.tap(centreOf(await boxOf(note(root, first.id))))
  await expect.poll(async () => (await notesOf(m1, clipId)).length, { message: 'the eraser tap removed the note' }).toBe(before.length - 1)

  await tapOn(m1, root.getByTestId('piano-roll-tool-select'))
  const deleteButton = root.getByTestId('piano-roll-action-delete')
  await expect(deleteButton, 'Delete is greyed out without a selection').toBeDisabled()
  const second = before.find(item => item.pitch === 74)!
  await m1.touch.tap(centreOf(await boxOf(note(root, second.id))))
  await expect(note(root, second.id)).toHaveAttribute('data-selected', 'true')
  await historySettled(m1.page)
  await tapOn(m1, deleteButton)
  await expect.poll(async () => (await notesOf(m1, clipId)).map(item => item.pitch), { message: 'Delete removed the selected note' }).toEqual([70])

  await undoInRoll(m1, root)
  await expect.poll(async () => (await notesOf(m1, clipId)).length, { message: 'Undo brought the deleted note back' }).toBe(2)
})

test('two fingers zoom time and pitch separately and pan the roll without drawing @phone', async ({ m1 }) => {
  const { root, clipId, roll } = await openPhrase(m1)
  const scroll = root.getByTestId('piano-roll-scroll')
  const before = await notesOf(m1, clipId)
  const centre = centreOf(await boxOf(scroll))
  const px0 = Number(await roll.getAttribute('data-px-per-sec'))
  const row0 = Number(await roll.getAttribute('data-row-height'))

  await twoFinger(m1, { x: centre.x + 20, y: centre.y }, { axis: 'x', startGap: 80, endGap: 200 })
  await expect.poll(async () => Number(await roll.getAttribute('data-px-per-sec')), { message: 'spreading horizontally zoomed time in' }).toBeGreaterThan(px0 * 1.8)
  expect(Number(await roll.getAttribute('data-row-height')), 'a horizontal pinch leaves the pitch zoom').toBe(row0)

  await twoFinger(m1, { x: centre.x + 20, y: centre.y }, { axis: 'y', startGap: 50, endGap: 110 })
  await expect.poll(async () => Number(await roll.getAttribute('data-row-height')), { message: 'spreading vertically zoomed pitch in' }).toBeGreaterThan(row0 * 1.6)

  const top0 = await scroll.evaluate(element => element.scrollTop)
  const left0 = await scroll.evaluate(element => element.scrollLeft)
  await twoFinger(m1, { x: centre.x + 20, y: centre.y }, { axis: 'x', startGap: 90, endGap: 90, pan: { x: -60, y: -50 } })
  await expect.poll(() => scroll.evaluate(element => element.scrollTop), { message: 'dragging two fingers up scrolled to lower pitches' }).toBeGreaterThan(top0 + 30)
  expect(await scroll.evaluate(element => element.scrollLeft), 'dragging two fingers left scrolled later in time').toBeGreaterThan(left0 + 30)
  expect(await notesOf(m1, clipId), 'no gesture drew, moved or removed a note').toEqual(before)
})
