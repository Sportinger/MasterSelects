import { chromium } from '@playwright/test'
import { readVideoFrameCodes } from '../assertions/frameCodeOracle'
import { chromeLaunchArgs, resolveRuntimeProfile } from '../config/runtimeProfile'
import { visibleCentre } from './phoneFixture'
import { readPreviewFrame } from './phoneTouch'
import {
  A_TAG, ACTION_DELETE, ACTION_RIPPLE_DELETE, ACTION_SPLIT, ACTION_TEXT, B_TAG, COMP_HEIGHT, COMP_WIDTH, FPS, IDS, M1_IDS,
  createProjectViaHome, differingShare, expect, exportToReady, frameAt, importViaSheet, longPressDrag, previewPixels,
  probeVideo, readM1Timeline, rowPoint, seek, settled, signatureOf, tapAction, tapClip, tapForDownload, tapOn, test,
  type M1Session, type M1Timeline,
} from './m1Fixture'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'

/**
 * M1 "Schneiden" acceptance of the phone skin (PLAN.md section 5), one case per
 * test, in one phone context (m1Fixture.ts). Same pattern as the M0 suite and
 * foundation/preview-truth.spec.ts: the preview's real pixels (frame codes) and
 * decoded export files are the truth, conditions are awaited and never slept
 * on, every action under test is a real touch on the phone UI, files come in
 * through `setInputFiles` on the hidden phone inputs. A real product defect stays
 * visible as `test.fail(true, '<defect>')`, never as a weaker oracle.
 *
 * Frame arithmetic used below (clips A = 4 s = frames 0..119, B = 3 s = frames
 * 0..89, 30 fps, 360x640 in a 1080x1920 composition, 60 px per second default zoom):
 * a clip shows source frame floor((t - start + inPoint) * 30) at time t.
 */
test.describe.configure({ timeout: 150_000 })

const TOLERANCE = 1.5 / FPS

/** The frame code under the fixed playhead must be the one the clips say for the playhead's time. */
async function expectPreviewAt(m1: M1Session, time: number, clips: M1Timeline['main']): Promise<number> {
  const expected = frameAt(clips, time)
  expect(expected, `the time ${time.toFixed(4)} s lies outside every clip`).not.toBeNull()
  m1.probe.mark()
  await m1.probe.waitForFrame(expected!.frame, { allowed: () => true, timeoutMs: 15_000 })
  for (let read = 0; read < 2; read++) {
    expect((await readPreviewFrame(m1.probe)).frame, `preview at ${time.toFixed(4)} s. ${m1.probe.summary()}`).toBe(expected!.frame)
  }
  return expected!.frame
}

/** The preview shows no frame code at `time` (a gap: nothing under the playhead). */
async function expectEmptyPreviewAt(m1: M1Session, time: number): Promise<void> {
  await seek(m1, time)
  m1.probe.mark()
  await expect.poll(async () => (await readPreviewFrame(m1.probe)).frame, { message: `the preview should be empty at ${time.toFixed(3)} s (gap). ${m1.probe.summary()}`, timeout: 10_000 }).toBeNull()
}

async function importAB(m1: M1Session): Promise<M1Timeline> {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  expect(state.main[0].name, 'first pick is A').toContain(A_TAG)
  expect(state.main[1].name, 'second pick is B').toContain(B_TAG)
  await seek(m1, 0)
  return state
}

const mainSignature = async (m1: M1Session) => signatureOf((await m1.timeline()).main)

// ---------------------------------------------------------------------------

test('1 new project from the home with format 9:16 creates a 1080x1920 composition and shows the shell @phone', async ({ world }) => {
  const { page, bridge } = world
  await expect(page.getByTestId(M1_IDS.home)).toBeVisible()
  await createProjectViaHome(world, { name: `Phone M1 ${world.tabId.slice(0, 8)}`, format: '9:16' })
  for (const id of [IDS.topBar, IDS.previewRegion, IDS.transport, IDS.timeline, IDS.toolbar]) {
    await expect(page.getByTestId(id), `strip ${id}`).toBeVisible()
  }
  const state = await readM1Timeline(bridge)
  expect(state.activeCompositionId, 'a composition is open').not.toBeNull()
  const items = await bridge.toolData<{ compositions: Array<{ id: string; width: number; height: number; frameRate: number }> }>('getMediaItems')
  const composition = items.compositions.find(item => item.id === state.activeCompositionId)
  expect(composition, 'the active composition is listed').toBeTruthy()
  expect({ width: composition!.width, height: composition!.height, fps: composition!.frameRate }, 'composition of a 9:16 phone project').toEqual({ width: COMP_WIDTH, height: COMP_HEIGHT, fps: FPS })
})

test('1b the top bar shows the name of the new project @phone', async ({ m1 }) => {
  // Regression guard (found by this suite, fixed 2026-10-27): createBlankProject now sets the media store's
  // project name, which the phone top bar reads; it used to show "Untitled Project" after creating.
  await expect(m1.page.getByTestId(IDS.projectName)).toContainText(m1.projectName!, { timeout: 5_000 })
})

test('2 the media sheet adds two picked frame-code clips to the main track in pick order @phone', async ({ m1 }) => {
  const { page } = m1
  await tapAction(m1, phoneActionTestId('media'))
  await expect(m1.sheet).toBeVisible()
  await expect(page.getByTestId(M1_IDS.mediaPickVisual), 'a visible Photos/Videos pick button').toBeVisible()
  await expect(page.getByTestId(M1_IDS.mediaPickAudio), 'a visible Audio pick button').toBeVisible()
  const accept = await page.getByTestId(M1_IDS.mediaInputVisual).getAttribute('accept')
  expect(accept, 'the visual input accepts video and images').toMatch(/video/)
  expect(accept).toMatch(/image/)
  await expect(page.getByTestId(M1_IDS.mediaInputVisual)).toHaveAttribute('multiple', '')
  await tapOn(m1, page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  expect((await m1.timeline()).all, 'Cancel adds nothing').toHaveLength(0)

  // Pick A, then B (two separate picks, as a person would).
  const state = await importAB(m1)
  const [a, b] = state.main
  expect(a.start, 'A starts at 0').toBeCloseTo(0, 2)
  expect(a.duration, 'A is 4 s').toBeCloseTo(4, 1)
  expect(b.start, 'B starts where A ends').toBeCloseTo(a.start + a.duration, 2)
  expect(b.duration, 'B is 3 s').toBeCloseTo(3, 1)
  expect(b.trackId, 'both clips sit on the same (main) track').toBe(a.trackId)
  await expect(m1.clip(a.id)).toBeVisible()

  // Frame 0 of A at time 0; A's last frame just before B, B's frame 0 at the boundary (the order proof:
  // frame 119 can only come from A).
  await seek(m1, 0)
  expect(await expectPreviewAt(m1, 0, state.main)).toBe(0)
  await seek(m1, b.start - 0.5 / FPS)
  expect(await expectPreviewAt(m1, b.start - 0.5 / FPS, state.main), 'last frame of A').toBe(119)
  await seek(m1, b.start + 0.5 / FPS)
  expect(await expectPreviewAt(m1, b.start + 0.5 / FPS, state.main), 'first frame of B').toBe(0)
})

test('2b an image and an audio file picked in the media sheet land on the timeline @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.image], audio: [m1.media.audio] }, { total: 2 })
  const image = state.all.find(clip => clip.name.includes('m1-image'))
  const audio = state.all.find(clip => clip.name.includes('m1-tone'))
  expect(image, `image clip among ${state.all.map(clip => clip.name).join(', ')}`).toBeTruthy()
  expect(image!.trackType, 'an image goes on a video track').toBe('video')
  expect(image!.duration, 'an image has a visible duration').toBeGreaterThan(0.5)
  expect(audio, 'audio clip').toBeTruthy()
  expect(audio!.trackType, 'audio goes on an audio track').toBe('audio')
  expect(audio!.duration, 'the 1 s tone').toBeCloseTo(1, 1)
})

test('3 scrubbing by touch shows the frame code of the frame under the playhead @phone', async ({ m1 }) => {
  await importAB(m1)
  const start = await rowPoint(m1)
  let last = (await m1.timeline()).playhead
  for (const dx of [-120, -150, 90, -60]) {
    await m1.touch.pan(start, { x: dx, y: 0 })
    const state = await settled(m1)
    expect(Math.sign(state.playhead - last), `a pan by ${dx} px moved time from ${last.toFixed(3)} to ${state.playhead.toFixed(3)} s`).toBe(Math.sign(-dx))
    last = state.playhead
    await expectPreviewAt(m1, state.playhead, state.main)
    expect(state.selectedIds, 'scrubbing selected a clip').toEqual([])
  }
})

test('4 trim handles change the in and out point and the preview shows the new first and last frame @phone', async ({ m1 }) => {
  const { page } = m1
  const base = await importAB(m1)
  const b = base.main[1]
  await seek(m1, b.start + 0.5)
  await settled(m1)
  await tapClip(m1, b.id)
  const startHandle = page.getByTestId(M1_IDS.trimHandleStart)
  const endHandle = page.getByTestId(M1_IDS.trimHandleEnd)
  await expect(startHandle, 'a selected clip shows its start trim handle').toBeVisible()
  await expect(endHandle, 'a selected clip shows its end trim handle').toBeVisible()
  for (const handle of [startHandle, endHandle]) {
    const box = (await handle.boundingBox())!
    expect(Math.min(box.width, box.height), 'trim handle touch target').toBeGreaterThanOrEqual(43.5)
  }
  const tileWidth = (await m1.clip(b.id).boundingBox())!.width
  const pxPerSecond = tileWidth / b.duration

  // Start handle: drag right by one second of timeline.
  await m1.touch.pan(await visibleCentre(startHandle, m1.surface), { x: pxPerSecond, y: 0 })
  let state = await settled(m1)
  const afterStart = state.main[1]
  const cutIn = afterStart.inPoint - b.inPoint
  expect(cutIn, `dragging the start handle by 1 s changed the in point by ${cutIn.toFixed(3)} s`).toBeGreaterThan(0.8)
  expect(cutIn).toBeLessThan(1.2)
  expect(afterStart.start + afterStart.duration, 'the end of B does not move when its start is trimmed').toBeCloseTo(b.start + b.duration, 1)
  expect(afterStart.duration, 'B got shorter by what was cut').toBeCloseTo(b.duration - cutIn, 1)
  await seek(m1, afterStart.start + 0.5 / FPS)
  const firstFrame = await expectPreviewAt(m1, afterStart.start + 0.5 / FPS, state.main)
  expect(firstFrame, 'the first frame of the trimmed B is the frame at its new in point').toBe(Math.round(afterStart.inPoint * FPS))
  expect(firstFrame, 'the first frame of B changed').toBeGreaterThanOrEqual(24)

  // End handle: drag left by one second.
  await seek(m1, afterStart.start + 0.5)
  await settled(m1)
  await expect(m1.clip(afterStart.id)).toHaveAttribute('aria-selected', 'true')
  await expect(endHandle).toBeVisible()
  await m1.touch.pan(await visibleCentre(endHandle, m1.surface), { x: -pxPerSecond, y: 0 })
  state = await settled(m1)
  const afterEnd = state.main[1]
  const cutOut = (afterStart.start + afterStart.duration) - (afterEnd.start + afterEnd.duration)
  expect(cutOut, `dragging the end handle by 1 s shortened B by ${cutOut.toFixed(3)} s`).toBeGreaterThan(0.8)
  expect(cutOut).toBeLessThan(1.2)
  expect(afterEnd.inPoint, 'the in point stays').toBeCloseTo(afterStart.inPoint, 2)
  const lastTime = afterEnd.start + afterEnd.duration - 0.5 / FPS
  await seek(m1, lastTime)
  const lastFrame = await expectPreviewAt(m1, lastTime, state.main)
  expect(lastFrame, 'the last frame of B is the frame before its new out point').toBe(Math.round((afterEnd.inPoint + afterEnd.duration) * FPS) - 1)
  expect(lastFrame, 'the last frame of B changed').toBeLessThan(80)
  // Beyond the new end the preview no longer shows B.
  await expectEmptyPreviewAt(m1, afterEnd.start + afterEnd.duration + 0.5)
})

test('5 split, delete (gap stays), delete and close gap and long-press reorder give the expected frame sequence @phone', async ({ m1 }) => {
  const base = await importAB(m1)
  const [a, b] = base.main

  // Split A at 2 s.
  await seek(m1, 2)
  await settled(m1)
  await tapClip(m1, a.id)
  await tapAction(m1, ACTION_SPLIT)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'Split made no second clip' }).toBe(3)
  let state = await m1.timeline()
  const [a1, a2] = state.main
  expect(a1.duration, 'left part is 2 s').toBeCloseTo(2, 1)
  expect(a2.start, 'right part starts at the cut').toBeCloseTo(2, 1)
  expect(a2.inPoint, 'right part continues at source second 2').toBeCloseTo(2, 1)

  // Delete the left part: the gap stays, nothing moves.
  await tapClip(m1, a1.id)
  await tapAction(m1, ACTION_DELETE)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'Delete did not remove the clip' }).toBe(2)
  state = await m1.timeline()
  expect(state.main.map(clip => clip.id), 'A1 is gone, A2 and B stay').toEqual([a2.id, b.id])
  expect(state.main[0].start, 'A2 did not move (gap stays)').toBeCloseTo(2, 2)
  expect(state.main[1].start, 'B did not move (gap stays)').toBeCloseTo(4, 2)
  await expectEmptyPreviewAt(m1, 1)
  await seek(m1, 2 + 0.5 / FPS)
  expect(await expectPreviewAt(m1, 2 + 0.5 / FPS, state.main), 'A2 shows source frame 60 at its start').toBe(60)

  // Delete A2 and close the gap: B follows A2's span.
  await seek(m1, 3)
  await settled(m1)
  await tapClip(m1, a2.id)
  await tapAction(m1, ACTION_RIPPLE_DELETE)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'Delete & close gap did not remove the clip' }).toBe(1)
  state = await m1.timeline()
  expect(state.main[0].id).toBe(b.id)
  expect(state.main[0].start, 'B moved left by the deleted 2 s').toBeCloseTo(2, 1)
  await seek(m1, state.main[0].start + 0.5 / FPS)
  expect(await expectPreviewAt(m1, state.main[0].start + 0.5 / FPS, state.main), 'B begins right where A2 began').toBe(0)

  // Cut B in two (frame 45) and reorder the parts by long-press + drag.
  const bStart = state.main[0].start
  await seek(m1, bStart + 1.5)
  await settled(m1)
  await tapClip(m1, b.id)
  await tapAction(m1, ACTION_SPLIT)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'Split of B made no second clip' }).toBe(2)
  state = await m1.timeline()
  const [b1, b2] = state.main
  expect(b2.inPoint, 'B2 continues at source second 1.5').toBeCloseTo(1.5, 1)
  const row = await rowPoint(m1)
  const from = { x: (await visibleCentre(m1.clip(b2.id), m1.surface)).x, y: row.y }
  const target = (await visibleCentre(m1.clip(b1.id), m1.surface)).x - 20
  await longPressDrag(m1, from, { x: target, y: row.y })
  await expect.poll(async () => (await m1.timeline()).main.map(clip => clip.id), { message: 'long-press + drag did not reorder the parts' }).toEqual([b2.id, b1.id])
  state = await settled(m1)
  const [first, second] = state.main
  expect(second.start, 'the parts do not overlap').toBeGreaterThanOrEqual(first.start + first.duration - 1e-3)
  await seek(m1, first.start + 0.5 / FPS)
  expect(await expectPreviewAt(m1, first.start + 0.5 / FPS, state.main), 'former B2 comes first: source frame 45').toBe(45)
  await seek(m1, second.start + 0.5 / FPS)
  expect(await expectPreviewAt(m1, second.start + 0.5 / FPS, state.main), 'former B1 comes second: source frame 0').toBe(0)
})

test('6 undo and redo by touch reverse and replay each step individually @phone', async ({ m1 }) => {
  const { page } = m1
  const base = await importAB(m1)
  const sig0 = signatureOf(base.main)
  const undo = page.getByTestId(IDS.undo)
  const redo = page.getByTestId(IDS.redo)
  await seek(m1, 2)
  await settled(m1)
  await tapClip(m1, base.main[0].id)
  await tapAction(m1, ACTION_SPLIT)
  await expect.poll(async () => (await m1.timeline()).main.length).toBe(3)
  const sig1 = await mainSignature(m1)
  const a2 = (await m1.timeline()).main[1]
  await tapClip(m1, a2.id)
  await tapAction(m1, ACTION_DELETE)
  await expect.poll(async () => (await m1.timeline()).main.length).toBe(2)
  const sig2 = await mainSignature(m1)
  expect(new Set([sig0, sig1, sig2]).size, 'the three states differ').toBe(3)

  const step = async (button: typeof undo, expected: string, what: string) => {
    await tapOn(m1, button)
    await expect.poll(() => mainSignature(m1), { message: what }).toBe(expected)
  }
  await step(undo, sig1, 'first undo brings the deleted clip back (still split)')
  await step(undo, sig0, 'second undo removes the split')
  await step(redo, sig1, 'first redo splits again')
  await step(redo, sig2, 'second redo deletes again')
  await expect(redo, 'nothing left to redo').toHaveAttribute('aria-disabled', 'true')
})

test('7 the Text tool adds a title at the playhead that is visible in the preview; Cancel adds nothing @phone', async ({ m1 }) => {
  const { page } = m1
  const base = await importAB(m1)
  await seek(m1, 1)
  await settled(m1)
  await expectPreviewAt(m1, 1, base.main)
  const withoutTitle = await previewPixels(m1.probe)
  const clipsBefore = (await m1.timeline()).all.length

  // Cancel: nothing added, no pixel change.
  await tapAction(m1, ACTION_TEXT)
  await expect(m1.sheet).toBeVisible()
  await page.getByTestId(M1_IDS.titleInput).fill('Cancelled title')
  await tapOn(m1, page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  expect((await m1.timeline()).all.length, 'Cancel added a clip').toBe(clipsBefore)
  expect(differingShare(withoutTitle, await previewPixels(m1.probe)), 'Cancel changed the preview').toBeLessThan(0.0005)

  // Done: a text clip at the playhead.
  await tapAction(m1, ACTION_TEXT)
  await expect(m1.sheet).toBeVisible()
  const input = page.getByTestId(M1_IDS.titleInput)
  await input.fill('Hello M1')
  await expect(input).toHaveValue('Hello M1')
  await tapOn(m1, page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet).toBeHidden()
  await expect.poll(async () => (await m1.timeline()).all.length, { message: 'Done added no text clip' }).toBe(clipsBefore + 1)
  const title = (await m1.timeline()).all.find(clip => clip.sourceType === 'text' || /text|title|hello/i.test(clip.name))
  expect(title, 'the new clip is a text clip').toBeTruthy()
  expect(Math.abs(title!.start - 1), `the title starts at the playhead (1 s), not at ${title!.start}`).toBeLessThanOrEqual(TOLERANCE)
  expect(title!.duration, 'the title has a visible duration').toBeGreaterThan(0.5)
  expect((await m1.timeline()).playhead, 'the playhead did not move').toBeCloseTo(1, 2)
  // The preview shows the title: many pixels below the frame-code band differ from the picture without it.
  await expect.poll(async () => differingShare(withoutTitle, await previewPixels(m1.probe)), {
    message: 'the title is not visible in the preview (pixels below the code band did not change)', timeout: 15_000,
  }).toBeGreaterThan(0.003)
})

test('8 export gives a 1080x1920 file of the edited length with the expected frames at the cut @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(420_000)
  const base = await importAB(m1)
  const [a, b] = base.main
  // Edit: keep the first second of A, then B (A is cut at 1 s, the rest deleted, B moved up to the cut).
  await m1.bridge.toolData('splitClip', { clipId: a.id, splitTime: 1 })
  const parts = (await m1.timeline()).main
  expect(parts, 'A was split').toHaveLength(3)
  await m1.bridge.toolData('deleteClip', { clipId: parts[1].id })
  await m1.bridge.toolData('moveClip', { clipId: b.id, newStartTime: 1 })
  const edited = (await m1.timeline()).main
  expect(edited.map(clip => [Math.round(clip.start * 1000), Math.round(clip.duration * 1000)]), 'edited timeline: A 0-1 s, B 1-4 s').toEqual([[0, 1000], [1000, 3000]])
  await seek(m1, 0)

  await exportToReady(m1)
  const { file, suggested } = await tapForDownload(m1, m1.page.getByTestId(M1_IDS.exportSave), testInfo, 'export')
  expect(suggested, 'a video file name').toMatch(/\.(mp4|webm|mov)$/i)
  const info = await probeVideo(file)
  expect({ width: info.width, height: info.height }, 'exported picture size').toEqual({ width: COMP_WIDTH, height: COMP_HEIGHT })
  expect(info.duration, `export duration ${info.duration.toFixed(3)} s is the edited 4 s, not the 60 s composition`).toBeGreaterThan(3.8)
  expect(info.duration).toBeLessThan(4.3)
  const decoded = await readVideoFrameCodes(file)
  const frames = decoded.readings.map(reading => reading.frame)
  const expectedFrames = [...Array.from({ length: 30 }, (_, index) => index), ...Array.from({ length: 90 }, (_, index) => index)]
  expect(frames.length, 'frame count of the edited 4 s at 30 fps').toBe(expectedFrames.length)
  const wrong = expectedFrames.flatMap((frame, index) => frames[index] === frame ? [] : [`#${index}: ${frames[index] ?? 'unreadable'} (expected ${frame})`])
  expect(wrong.slice(0, 12), 'exported frames deviating from the expected sequence 0..29, 0..89').toEqual([])
})

test('9 Share hands the exported file to navigator.share when present and downloads it otherwise @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(300_000)
  const { page } = m1
  await importViaSheet(m1, { visual: [m1.media.short.path] }, { main: 1, total: 1 })
  await seek(m1, 0)
  await exportToReady(m1)

  // navigator.share present: called with a File.
  await page.evaluate(() => {
    const holder = window as Window & { __shared?: Array<{ files: Array<{ isFile: boolean; name: string; size: number; type: string }> }> }
    holder.__shared = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data?: ShareData) => Array.isArray(data?.files) && data.files.length > 0 })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => { holder.__shared!.push({ files: (data.files ?? []).map(file => ({ isFile: file instanceof File, name: file.name, size: file.size, type: file.type })) }) },
    })
  })
  await tapOn(m1, page.getByTestId(M1_IDS.exportShare))
  await expect.poll(() => page.evaluate(() => (window as Window & { __shared?: unknown[] }).__shared?.length ?? 0), { message: 'navigator.share was not called' }).toBe(1)
  const shared = await page.evaluate(() => (window as Window & { __shared?: Array<{ files: Array<{ isFile: boolean; name: string; size: number; type: string }> }> }).__shared![0])
  expect(shared.files, 'one file is shared').toHaveLength(1)
  expect(shared.files[0].isFile, 'a real File object').toBe(true)
  expect(shared.files[0].size, 'a non-empty video').toBeGreaterThan(1000)
  expect(shared.files[0].type, 'a video mime type').toMatch(/^video\//)
  expect(shared.files[0].name).toMatch(/\.(mp4|webm|mov)$/i)

  // navigator.share and canShare missing: the same button saves a download instead.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })
  await expect(page.getByTestId(M1_IDS.exportShare), 'Share is still there after a share').toBeVisible()
  const { file, suggested } = await tapForDownload(m1, page.getByTestId(M1_IDS.exportShare), testInfo, 'shared-fallback')
  expect(suggested).toMatch(/\.(mp4|webm|mov)$/i)
  expect((await probeVideo(file)).frames, 'the fallback download is the 1 s video').toBeGreaterThanOrEqual(28)
})

test('10 after a reload of /m the project is restored with the same clips @phone', async ({ m1 }) => {
  const { page } = m1
  const base = await importAB(m1)
  await seek(m1, 2)
  await tapClip(m1, base.main[0].id)
  await tapAction(m1, ACTION_SPLIT)
  await expect.poll(async () => (await m1.timeline()).main.length).toBe(3)
  const before = await mainSignature(m1)
  const storage = page.getByTestId(M1_IDS.storageStatus)
  if (await storage.isVisible()) {
    await expect(storage, 'the project is saved before the reload').not.toContainText(/pending|saving|unsaved|fail|error/i, { timeout: 30_000 })
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  const home = page.getByTestId(M1_IDS.home)
  const root = page.getByTestId(IDS.root)
  await expect(home.or(root).first()).toBeVisible({ timeout: 90_000 })
  if (await home.isVisible()) {
    const row = page.getByTestId(M1_IDS.projectRow).filter({ hasText: m1.projectName! }).first()
    await expect(row, 'the project is listed under recent projects').toBeVisible()
    await tapOn(m1, row)
  }
  await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
  await expect.poll(async () => (await m1.bridge.toolData<{ totalClips: number }>('getTimelineState').catch(() => ({ totalClips: -1 }))).totalClips, {
    timeout: 60_000, message: 'the restored timeline has no clips',
  }).toBe(3)
  expect(await mainSignature(m1), 'same clips, same cut, same positions after the reload').toBe(before)
  await expect(m1.clips.first()).toBeVisible({ timeout: 30_000 })
  await seek(m1, 0)
  await expectPreviewAt(m1, 0, (await m1.timeline()).main)
})

test('11 a tool that does not apply is visible, greyed out, and tapping it shows the reason @phone', async ({ m1 }) => {
  const { page } = m1
  const state = await importViaSheet(m1, { visual: [m1.media.short.path] }, { main: 1, total: 1 })
  await tapClip(m1, state.main[0].id)
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'clip')
  // Every milestone action has shipped; Edit text only applies to titles, so on a video clip it stays
  // visible on the clip toolbar, greyed out, with its reason (owner rule: grey out, never hide).
  const speed = page.getByTestId(phoneActionTestId('edit-text'))
  await expect(speed, 'Edit text stays visible on the clip toolbar of a video clip').toBeVisible()
  await expect(speed).toHaveAttribute('aria-disabled', 'true')
  expect(await speed.evaluate(element => (element as HTMLButtonElement).disabled), 'greyed out but focusable').toBe(false)
  await expect(page.getByTestId(IDS.unavailableNotice)).toHaveCount(0)
  await tapOn(m1, speed)
  const notice = page.getByTestId(IDS.unavailableNotice)
  await expect(notice, 'tapping a greyed tool explains why').toBeVisible()
  expect((await notice.innerText()).trim().length, 'the notice carries a reason').toBeGreaterThan(10)
  await expect(speed).toBeVisible()
  // OK closes the notice. Left open, its backdrop would swallow the next spec's first tap in the shared phone world.
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice, 'OK dismisses the notice').toBeHidden()
})

test('12 regression: /editor still boots the desktop layout in a desktop-sized context @phone', async ({ browserName: _browserName }, testInfo) => {
  const runtime = resolveRuntimeProfile()
  const baseURL = testInfo.project.use.baseURL
  if (!baseURL) throw new Error('Playwright baseURL must be configured')
  const browser = await chromium.launch({ channel: runtime.browserChannel, headless: runtime.headless, args: chromeLaunchArgs(process.platform, runtime.headless) })
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await context.newPage()
    await page.goto(new URL('/editor', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.app--editor-layout'), '/editor lost the desktop layout').toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId(IDS.root), 'the phone skin leaked into /editor').toHaveCount(0)
    await expect(page.locator('.mobile-skin')).toHaveCount(0)
    await expect(page.getByTestId(M1_IDS.home)).toHaveCount(0)
  } finally {
    await browser.close()
  }
})
