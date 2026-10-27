import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { IDS, expect, tapOn, test, type M1Session } from './m1Fixture'
import {
  boxOf, centreOf, closeWorkspaceIfOpen, historySettled, landscape, openEditor, reloadIntoProject, setSide, storeMaster, storeTracks, twoFinger,
} from './m4AudioFixture'

/**
 * M4 "Querformat-Editoren", packet R2: the Mixer (catalog INV-4/audio-mixer) on the phone. The
 * landscape editor shows the desktop audio-mixer panel between the collapsible Preview (left) and
 * Properties (right). Every action under test is real touch through Chrome's input pipeline
 * (phoneTouch.ts / CDP); results are read from the timeline store the panel writes.
 */
test.describe.configure({ timeout: 180_000 })

const STRIP = '.audio-mixer-track-scroll .audio-mixer-strip'

async function addAudioTracks(m1: M1Session, count: number): Promise<void> {
  // Every case has a fresh composition; its own tracks get unique names.
  for (let index = 0; index < count; index++) {
    await m1.bridge.toolData('createTrack', { type: 'audio', name: `Mix ${index + 1}` })
  }
  await expect.poll(async () => (await storeTracks(m1.page)).filter(track => /^Mix \d+$/.test(track.name)).length).toBe(count)
  await historySettled(m1.page)
}

async function openMixer(m1: M1Session, tracks = 6) {
  await landscape(m1.page)
  await addAudioTracks(m1, tracks)
  const root = await openEditor(m1, 'mixer')
  const panel = root.locator('.audio-mixer-panel')
  await expect(panel, 'the mixer panel did not render in the editor').toBeVisible()
  return { root, panel }
}

/** The strip of a track (strips render in track order; names are unique in this test). */
function stripOf(m1: M1Session, name: string) {
  return m1.page.locator(STRIP).filter({ has: m1.page.locator('.audio-mixer-strip-name strong', { hasText: new RegExp(`^${name}$`) }) })
}

async function trackByName(m1: M1Session, name: string) {
  const track = (await storeTracks(m1.page)).find(candidate => candidate.name === name)
  if (!track) throw new Error(`no track named ${name}`)
  return track
}

/** Back to the timeline, then the phone's own Undo; the same history as the desktop. */
async function undoFromTimeline(m1: M1Session): Promise<void> {
  await historySettled(m1.page)
  await closeWorkspaceIfOpen(m1)
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
}

test.afterEach(async ({ m1 }) => { await closeWorkspaceIfOpen(m1) })

test('mixer opens from the Editors sheet; its side panels collapse, expand and stay so after a reload @phone', async ({ m1 }) => {
  await openMixer(m1, 2)
  await setSide(m1, 'left', true)
  await setSide(m1, 'right', true)
  const main = m1.page.getByTestId(WS.main)
  const narrow = (await boxOf(main)).width
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', false)
  const wide = (await boxOf(main)).width
  expect(wide, 'the mixer grows when both side panels are collapsed').toBeGreaterThan(narrow + 100)

  await reloadIntoProject(m1)
  await openEditor(m1, 'mixer')
  await expect(m1.page.getByTestId(WS.sideLeft), 'the collapsed Preview stays collapsed after a reload').toBeHidden()
  await expect(m1.page.getByTestId(WS.sideRight), 'the collapsed Properties stay collapsed after a reload').toBeHidden()
  await setSide(m1, 'left', true)
  await reloadIntoProject(m1)
  await openEditor(m1, 'mixer')
  await expect(m1.page.getByTestId(WS.sideLeft), 'the expanded Preview stays expanded after a reload').toBeVisible()
  await expect(m1.page.getByTestId(WS.sideRight)).toBeHidden()
})

test('a finger drag on a track fader sets its level in the store and Undo restores it @phone', async ({ m1 }) => {
  await openMixer(m1)
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', false)
  const name = 'Mix 1'
  const strip = stripOf(m1, name)
  await expect(strip).toHaveCount(1)
  const before = (await trackByName(m1, name)).volumeDb
  const fader = strip.locator('.audio-mixer-strip-fader')
  const box = await boxOf(fader)
  expect(box.height, 'the fader has room to travel in landscape').toBeGreaterThan(60)
  // Lower half of the rail, not on the cap: on touch the whole fader is the handle.
  const from = { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }
  await m1.touch.pan(from, { x: 0, y: -box.height * 0.4 })
  await expect.poll(async () => (await trackByName(m1, name)).volumeDb, { message: 'dragging the fader up raised the level' }).toBeGreaterThan(before + 3)
  const raised = (await trackByName(m1, name)).volumeDb
  await expect(fader).toHaveAttribute('aria-valuenow', String(raised))

  await undoFromTimeline(m1)
  await expect.poll(async () => (await trackByName(m1, name)).volumeDb, { message: 'Undo restored the level' }).toBe(before)
})

test('the master fader follows a finger too @phone', async ({ m1 }) => {
  const { root } = await openMixer(m1, 2)
  const fader = root.locator('.audio-mixer-master-bay .audio-mixer-strip-fader')
  await expect(fader).toBeVisible()
  const before = (await storeMaster(m1.page)).volumeDb
  const box = await boxOf(fader)
  await m1.touch.pan({ x: box.x + box.width / 2, y: box.y + box.height * 0.3 }, { x: 0, y: box.height * 0.4 })
  await expect.poll(async () => (await storeMaster(m1.page)).volumeDb, { message: 'dragging the master down lowered it' }).toBeLessThan(before - 3)
  await undoFromTimeline(m1)
  await expect.poll(async () => (await storeMaster(m1.page)).volumeDb).toBe(before)
})

test('pan by drag, mute, solo and record-arm taps and a new send land on the track @phone', async ({ m1 }) => {
  await openMixer(m1, 2)
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', false)
  const name = 'Mix 2'
  const strip = stripOf(m1, name)
  const pan = strip.locator('.audio-mixer-pan-row input[type="range"]')
  const panBox = await boxOf(pan)
  await m1.touch.pan({ x: panBox.x + panBox.width / 2, y: panBox.y + panBox.height / 2 }, { x: panBox.width * 0.45, y: 0 })
  await expect.poll(async () => (await trackByName(m1, name)).pan, { message: 'dragging the pan right moved it right' }).toBeGreaterThan(0.3)

  await tapOn(m1, strip.getByRole('button', { name: 'Mute' }))
  await expect.poll(async () => (await trackByName(m1, name)).muted).toBe(true)
  await tapOn(m1, strip.getByRole('button', { name: 'Solo' }))
  await expect.poll(async () => (await trackByName(m1, name)).solo).toBe(true)
  await tapOn(m1, strip.getByRole('button', { name: 'R', exact: true }))
  await expect.poll(async () => (await trackByName(m1, name)).recordArm).toBe(true)
  await historySettled(m1.page)
  await tapOn(m1, strip.getByRole('button', { name: 'Send', exact: true }))
  await expect.poll(async () => (await trackByName(m1, name)).sends).toBe(1)
  // The insert slot opens the track's FX window by touch, and its close button shuts it.
  await tapOn(m1, strip.getByRole('button', { name: 'FX', exact: true }))
  const fx = m1.page.locator('.audio-mixer-floating-fx')
  await expect(fx, 'the FX window opened').toBeVisible()
  await tapOn(m1, fx.locator('.audio-mixer-floating-fx-header button').last())
  await expect(fx).toBeHidden()
  // Undo takes back the send alone: mute and solo stay (each tap is its own step).
  await undoFromTimeline(m1)
  await expect.poll(async () => (await trackByName(m1, name)).sends).toBe(0)
  const after = await trackByName(m1, name)
  expect(after.muted && after.solo, 'mute and solo survive undoing the send').toBe(true)
  expect(after.pan).toBeGreaterThan(0.3)
})

// Record arm is workspace state (not part of the undo history). It used to be cleared by undoing an
// unrelated content edit of the same track; the repository now keeps it in the track's workspace view
// (trackAudioWorkspaceViewKey), covered by tests/unit/phoneUndoDefects.test.ts.
test('undo-clears-record-arm: undoing a send keeps the track armed @phone', async ({ m1 }) => {
  await openMixer(m1, 1)
  await setSide(m1, 'left', false)
  await setSide(m1, 'right', false)
  const strip = stripOf(m1, 'Mix 1')
  await tapOn(m1, strip.getByRole('button', { name: 'R', exact: true }))
  await expect.poll(async () => (await trackByName(m1, 'Mix 1')).recordArm).toBe(true)
  await historySettled(m1.page)
  await tapOn(m1, strip.getByRole('button', { name: 'Send', exact: true }))
  await expect.poll(async () => (await trackByName(m1, 'Mix 1')).sends).toBe(1)
  await undoFromTimeline(m1)
  await expect.poll(async () => (await trackByName(m1, 'Mix 1')).sends).toBe(0)
  expect((await trackByName(m1, 'Mix 1')).recordArm, 'the track is still armed').toBe(true)
})

test('six strips scroll sideways under a finger while the master stays in place @phone', async ({ m1 }) => {
  const { root } = await openMixer(m1, 7)
  await setSide(m1, 'left', true)
  await setSide(m1, 'right', true)
  const scroller = root.locator('.audio-mixer-track-scroll')
  const master = root.locator('.audio-mixer-master-bay')
  const masterBefore = await boxOf(master)
  const overflow = await scroller.evaluate(element => element.scrollWidth - element.clientWidth)
  expect(overflow, 'seven strips do not fit the mixer at once').toBeGreaterThan(50)
  const name = root.locator(`${STRIP} .audio-mixer-strip-name`).first()
  const start = centreOf(await boxOf(name))
  await m1.touch.pan(start, { x: -Math.min(220, overflow + 40), y: 0 })
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft), { message: 'the strips scrolled left' }).toBeGreaterThan(40)
  expect(await boxOf(master), 'the master bay did not move').toEqual(masterBefore)
  // A two-finger touch is not a mixer gesture: nothing changes level.
  const levels = (await storeTracks(m1.page)).map(track => track.volumeDb)
  await twoFinger(m1, centreOf(await boxOf(scroller)), { axis: 'x', startGap: 80, endGap: 80, pan: { x: 0, y: 0 } })
  expect((await storeTracks(m1.page)).map(track => track.volumeDb)).toEqual(levels)
})
