import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_LIBRARY_TEST_IDS as LIB, PHONE_LIBRARY_WEB_TEST_IDS as WEB, PHONE_MEDIA_JOBS_TEST_IDS as JOBS } from '../../../src/components/mobileSkin/library/phoneLibraryTestIds'
import { PHONE_SOURCE_TEST_IDS as SRC } from '../../../src/components/mobileSkin/source/phoneSourceTestIds'
import { A_TAG, IDS, expect, seek, tapForDownload, tapOn, test, waitForIdle, type M1Session } from './m1Fixture'
import { closeSheets, sheetSettled } from './m3LibraryFixture'
import { importClipA } from './m2DesignFixture'
import { expectExplained } from './m6Fixture'
import {
  g6Clips, g6Files, g6Signature, g6Source, importToLibrary, openLibrary, openLibraryItem, openSource, type G6Clip,
} from './m7MediaFixture'

/**
 * G6 media journeys of the phone skin, one catalog case per test in the shared M1 world: the source
 * monitor (view, frame marks, the editor's seven placement modes with one undo each), the media job
 * list, saving a source file, pasting from the clipboard and the locked OCR row. Truth is the
 * timeline store, the media store, the downloaded bytes and the preview's frame codes.
 */
test.describe.configure({ timeout: 180_000 })

test.afterEach(async ({ m1 }) => {
  await closeSheets(m1)
})

const SHORT_TAG = '-30f-'
const mode = (m1: M1Session, id: string) => m1.page.locator(`[data-testid="${SRC.mode}"][data-mode="${id}"]`)
const isA = (clip: G6Clip) => clip.name.includes(A_TAG)
const isShort = (clip: G6Clip) => clip.name.includes(SHORT_TAG)

async function aFileId(m1: M1Session): Promise<string> {
  const file = (await g6Files(m1.page)).find(entry => entry.name.includes(A_TAG))
  expect(file, 'clip A is in the library').toBeTruthy()
  return file!.id
}

async function typeMark(m1: M1Session, testId: string, frame: number): Promise<void> {
  const field = m1.page.getByTestId(testId)
  await tapOn(m1, field)
  await field.fill(String(frame))
  await field.press('Enter')
}

async function place(m1: M1Session): Promise<void> {
  await expect(m1.page.getByTestId(SRC.preview)).toHaveAttribute('data-ok', 'true')
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the source sheet closes after Place').toBeHidden({ timeout: 30_000 })
  await waitForIdle(m1)
}

async function undoTo(m1: M1Session, signature: string): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.undo))
  await expect.poll(async () => g6Signature(await g6Clips(m1.page)), { message: 'one undo restores the timeline' }).toBe(signature)
}

async function expectPreviewFrame(m1: M1Session, time: number, frame: number): Promise<void> {
  await seek(m1, time)
  m1.probe.mark()
  await m1.probe.waitForFrame(frame, { allowed: () => true, timeoutMs: 20_000 })
}

test('INV6/source-monitor: a library file plays and steps frame by frame in the source sheet without touching the composition @phone', async ({ m1 }) => {
  await importClipA(m1)
  const base = g6Signature(await g6Clips(m1.page))
  await openSource(m1, await aFileId(m1))
  const video = m1.page.getByTestId(SRC.media)
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { message: 'the source video loads' }).toBeGreaterThanOrEqual(2)
  for (let step = 0; step < 3; step++) await tapOn(m1, m1.page.getByTestId(SRC.stepForward))
  await expect(m1.page.getByTestId(SRC.frame)).toHaveAttribute('data-frame', '3')
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => Math.floor(el.currentTime * 30 + 1e-6)), { message: 'the video element shows frame 3' }).toBe(3)
  await tapOn(m1, m1.page.getByTestId(SRC.stepBack))
  await expect(m1.page.getByTestId(SRC.frame)).toHaveAttribute('data-frame', '2')
  // Play moves the source on; pause stops it.
  await tapOn(m1, m1.page.getByTestId(SRC.play))
  await expect.poll(async () => Number(await m1.page.getByTestId(SRC.frame).getAttribute('data-frame')), { message: 'playing advances the source', timeout: 15_000 }).toBeGreaterThan(5)
  await tapOn(m1, m1.page.getByTestId(SRC.play))
  await expect(m1.page.getByTestId(SRC.play)).toHaveAttribute('aria-pressed', 'false')
  expect(g6Signature(await g6Clips(m1.page)), 'viewing never changes the composition').toBe(base)
  await tapOn(m1, m1.page.getByTestId(PHONE_TEST_IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  expect((await g6Source(m1.page)).fileId, 'closing ends the source monitor').toBeNull()
  expect(g6Signature(await g6Clips(m1.page))).toBe(base)
})

test('INV6/source-in-out: In and Out set at the shown frames place exactly frames 10–29; Clear brings back the whole source @phone', async ({ m1 }) => {
  await importClipA(m1)
  await seek(m1, 0)
  const base = g6Signature(await g6Clips(m1.page))
  await openSource(m1, await aFileId(m1))
  for (let step = 0; step < 10; step++) await tapOn(m1, m1.page.getByTestId(SRC.stepForward))
  await expect(m1.page.getByTestId(SRC.frame)).toHaveAttribute('data-frame', '10')
  await tapOn(m1, m1.page.getByTestId(SRC.markIn))
  for (let step = 0; step < 19; step++) await tapOn(m1, m1.page.getByTestId(SRC.stepForward))
  await expect(m1.page.getByTestId(SRC.frame)).toHaveAttribute('data-frame', '29')
  await tapOn(m1, m1.page.getByTestId(SRC.markOut))
  await expect(m1.page.getByTestId(SRC.range)).toHaveText('Frames 10–29 · 20 frames (0.67 s)')
  const marks = await g6Source(m1.page)
  expect(marks.inPoint).toBeCloseTo(10 / 30, 6)
  expect(marks.outPoint).toBeCloseTo(30 / 30, 6)
  await tapOn(m1, mode(m1, 'insert'))
  await place(m1)
  const placed = (await g6Clips(m1.page)).filter(clip => clip.trackType === 'video').toSorted((x, y) => x.start - y.start)
  expect(placed[0].start).toBeCloseTo(0, 3)
  expect(placed[0].inPoint).toBeCloseTo(10 / 30, 3)
  expect(placed[0].duration).toBeCloseTo(20 / 30, 3)
  expect(placed[1].start, 'insert moves the old clip right').toBeCloseTo(20 / 30, 3)
  await expectPreviewFrame(m1, 0.5 / 30, 10)
  await expectPreviewFrame(m1, 19.5 / 30, 29)
  await undoTo(m1, base)
  // Clear: the source is whole again.
  await openSource(m1, await aFileId(m1))
  await typeMark(m1, SRC.inFrame, 10)
  await expect(m1.page.getByTestId(SRC.range)).toContainText('Frames 10–119')
  await tapOn(m1, m1.page.getByTestId(SRC.clearMarks))
  await expect(m1.page.getByTestId(SRC.range)).toHaveText('Whole source · 120 frames (4.00 s)')
  expect(await g6Source(m1.page)).toMatchObject({ inPoint: null, outPoint: null })
})

test('INV1/source-monitor-marks: typed marks 30–59 append exactly those frames; cleared marks append the whole source @phone', async ({ m1 }) => {
  await importClipA(m1)
  const base = g6Signature(await g6Clips(m1.page))
  await openSource(m1, await aFileId(m1))
  await typeMark(m1, SRC.inFrame, 30)
  await typeMark(m1, SRC.outFrame, 59)
  await expect(m1.page.getByTestId(SRC.range)).toHaveText('Frames 30–59 · 30 frames (1.00 s)')
  await tapOn(m1, mode(m1, 'append-at-end'))
  await expect(m1.page.getByTestId(SRC.preview)).toContainText('Append: 0:04.00–0:05.00')
  await place(m1)
  const appended = (await g6Clips(m1.page)).filter(clip => clip.trackType === 'video').find(clip => clip.start > 3.9)
  expect(appended, 'the marked part is appended after A').toBeTruthy()
  expect(appended!.inPoint).toBeCloseTo(1, 3)
  expect(appended!.duration).toBeCloseTo(1, 3)
  await expectPreviewFrame(m1, 4 + 0.5 / 30, 30)
  await expectPreviewFrame(m1, 4 + 29.5 / 30, 59)
  await undoTo(m1, base)
  await openSource(m1, await aFileId(m1))
  await typeMark(m1, SRC.inFrame, 30)
  await tapOn(m1, m1.page.getByTestId(SRC.clearMarks))
  await tapOn(m1, mode(m1, 'append-at-end'))
  await place(m1)
  const whole = (await g6Clips(m1.page)).filter(clip => clip.trackType === 'video').find(clip => clip.start > 3.9)
  expect(whole!.inPoint).toBeCloseTo(0, 3)
  expect(whole!.duration, 'without marks the whole source is used').toBeCloseTo(4, 3)
  await undoTo(m1, base)
})

test('INV6/source-placement-modes: all seven editor placement modes change the timeline as named and each is one undo step @phone', async ({ m1 }) => {
  await importClipA(m1)
  const short = await importToLibrary(m1, m1.media.short.path)
  const base = g6Signature(await g6Clips(m1.page))
  const run = async (id: string, check: (clips: G6Clip[]) => void, { target = false } = {}) => {
    await seek(m1, 2)
    await openSource(m1, short.id)
    if (target) {
      await expect(mode(m1, id), `${id} needs a target first`).toHaveAttribute('aria-disabled', 'true')
      await tapOn(m1, m1.page.getByTestId(SRC.useClipUnderPlayhead))
      await expect(m1.page.getByTestId(SRC.target)).toContainText(A_TAG)
    }
    await tapOn(m1, mode(m1, id))
    await expect(mode(m1, id)).toHaveAttribute('aria-checked', 'true')
    await place(m1)
    const video = (await g6Clips(m1.page)).filter(clip => clip.trackType === 'video')
    check(video)
    await undoTo(m1, base)
    await m1.bridge.toolData('clearSelection')
  }
  await run('insert', clips => {
    const [first, placed, rest] = clips.toSorted((x, y) => x.start - y.start)
    expect([isA(first), isShort(placed), isA(rest)]).toEqual([true, true, true])
    expect([first.duration, placed.start, rest.start, rest.duration].map(v => +v.toFixed(3))).toEqual([2, 2, 3, 2])
  })
  await run('overwrite', clips => {
    const sorted = clips.toSorted((x, y) => x.start - y.start)
    expect(sorted.map(clip => [isShort(clip), +clip.start.toFixed(3), +clip.duration.toFixed(3)])).toEqual([[false, 0, 2], [true, 2, 1], [false, 3, 1]])
  })
  await run('append-at-end', clips => {
    const placed = clips.find(isShort)!
    expect([+placed.start.toFixed(3), +placed.duration.toFixed(3)]).toEqual([4, 1])
    expect(clips.filter(isA).map(clip => +clip.duration.toFixed(3))).toEqual([4])
  })
  await run('place-on-top', clips => {
    const placed = clips.find(isShort)!
    const a = clips.find(isA)!
    expect(placed.trackId, 'on top goes to another track').not.toBe(a.trackId)
    expect([+placed.start.toFixed(3), +a.duration.toFixed(3)]).toEqual([2, 4])
  })
  await run('replace', clips => {
    expect(clips.filter(isA)).toHaveLength(0)
    const placed = clips.find(isShort)!
    expect([+placed.start.toFixed(3), +placed.duration.toFixed(3)]).toEqual([0, 4])
  }, { target: true })
  await run('fit-to-fill', clips => {
    expect(clips.filter(isA)).toHaveLength(0)
    const placed = clips.find(isShort)!
    expect([+placed.start.toFixed(3), +placed.duration.toFixed(3), +placed.speed.toFixed(3)]).toEqual([0, 4, 0.25])
  }, { target: true })
  await run('ripple-overwrite', clips => {
    expect(clips.filter(isA)).toHaveLength(0)
    const placed = clips.find(isShort)!
    expect([+placed.start.toFixed(3), +placed.duration.toFixed(3)]).toEqual([0, 1])
  }, { target: true })
})

test('INV6/media-job-queue: the job list follows the media store, renews a waveform, hides finished jobs and shows the result @phone', async ({ m1 }) => {
  const tone = await importToLibrary(m1, m1.media.audio)
  await expect.poll(async () => (await g6Files(m1.page)).find(file => file.id === tone.id)?.waveformStatus, { timeout: 60_000, message: 'the waveform job finishes' }).toBe('ready')
  await openLibrary(m1)
  await tapOn(m1, m1.page.getByTestId(LIB.jobsEntry))
  await expect(m1.page.getByTestId(JOBS.root)).toBeVisible()
  const row = m1.page.locator(`[data-testid="${JOBS.row}"][data-file-id="${tone.id}"][data-job-kind="waveform"]`)
  await expect(row).toHaveAttribute('data-job-state', 'done')
  await expect(row.locator(`[data-testid="${JOBS.action}"]`)).toHaveText(['Again', 'Show'])
  await tapOn(m1, row.locator(`[data-testid="${JOBS.action}"][data-action="retry"]`))
  await expect(m1.page.getByTestId(JOBS.status)).toContainText(/Waveform renewed|still being drawn/, { timeout: 60_000 })
  await expect(row, 'renewing never adds a second row').toHaveCount(1)
  await expect(row).toHaveAttribute('data-job-state', 'done', { timeout: 60_000 })
  await tapOn(m1, m1.page.getByTestId(JOBS.hideDone))
  await expect(row, 'Hide finished hides the done job').toHaveCount(0)
  await tapOn(m1, m1.page.getByTestId(JOBS.hideDone))
  await tapOn(m1, row.locator(`[data-testid="${JOBS.action}"][data-action="show"]`))
  await expect(m1.page.getByTestId(SRC.root), 'Show opens the finished file in the source monitor').toHaveAttribute('data-source-id', tone.id)
})

test('INV6/download-source-file: Save file hands back the exact imported bytes under the file name @phone', async ({ m1 }, testInfo) => {
  await importClipA(m1)
  const id = await aFileId(m1)
  const name = (await g6Files(m1.page)).find(file => file.id === id)!.name
  await openLibraryItem(m1, id)
  const { file, suggested } = await tapForDownload(m1, m1.page.getByTestId(LIB.saveFile), testInfo, 'source-file')
  expect(suggested).toBe(name)
  const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
  expect(await hash(file), 'the saved bytes are the source file').toBe(await hash(m1.media.a.path))
  await expect(m1.page.getByTestId(LIB.status)).toContainText('saved to your downloads')
})

test('INV6/import-clipboard: a pasted image lands in the library and a pasted link opens Web sources @phone', async ({ m1 }) => {
  const png = await readFile(m1.media.image)
  await openLibrary(m1)
  const before = (await g6Files(m1.page)).length
  await m1.page.getByTestId(LIB.root).evaluate((root, bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }))
    root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [...png])
  await expect.poll(async () => (await g6Files(m1.page)).length, { timeout: 60_000, message: 'the pasted image is imported' }).toBe(before + 1)
  expect((await g6Files(m1.page)).find(file => file.name === 'pasted.png')?.type).toBe('image')
  await expect(m1.page.getByTestId(LIB.status)).toContainText('Pasted 1 file')
  // The Paste button reads the system clipboard: a lone link opens Web sources with it.
  await m1.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await m1.page.evaluate(() => navigator.clipboard.writeText('www.youtube.com/watch?v=g6paste'))
  await tapOn(m1, m1.page.getByTestId(LIB.paste))
  await expect(m1.page.getByTestId(WEB.root)).toBeVisible()
  await expect(m1.page.getByTestId(WEB.link)).toHaveValue('https://www.youtube.com/watch?v=g6paste')
  await m1.context.clearPermissions()
})

test('INV8/optional-ocr: reading text in pictures stays visible, locked, and says it is not available yet @phone', async ({ m1 }) => {
  await importClipA(m1)
  await openLibraryItem(m1, await aFileId(m1))
  const ocr = m1.page.getByTestId(LIB.ocr)
  await expect(ocr).toHaveAttribute('aria-disabled', 'true')
  await expect(ocr).toContainText('not available yet')
  await tapOn(m1, ocr)
  await expectExplained(m1, /OCR is not available yet/)
  await sheetSettled(m1)
})
