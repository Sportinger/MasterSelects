import { UI_WAIT_MS, deviceProjectName, isDeviceProjectName, resolveDeviceEnv } from './deviceEnv'
import {
  ACTION_SPLIT, ACTION_TEXT, IDS, M1_IDS, clearFrameNear, expect, expectedFrameAt, footageTimelineFrames, isClearFrame, needs, readAllTiles,
  record, segmentsFromTiles, tapDeviceProjectRow, tapOn, tapTile, test, tileSignature, waitForSaved, type DeviceWorld,
} from './deviceFixture'
import { createDeviceProject, decodeExport, differingShare, exportAndPull, importFootage, openNewProjectForm, previewPixels, waitForFirstScreen } from './deviceJourney'
import { describeActionPhases, describeLoadReport, describeMediaImport, judgeFrames, loadBudgetProblems, seekPathPictures, sourceSecondsAt, transportMs, type BootMark, type TimelineSegment } from './deviceParsing'
import { describeExportEvidence, describeProgress, readBootMarks, takeProgress, waitForLoadReport } from './deviceTelemetry'
import { COMP_FPS, expectContentAt, readPlayheadFrame, readTiles, seekToFrame, tile, type TileState } from './deviceTimeline'

/**
 * Journeys on a real Android phone (tested on a Pixel 10 Pro, Android 16, Chrome) over wireless adb: one
 * catalog case per test, in order, on one "Device test" project built through the phone UI with a
 * generated phone recording (fixtures/phoneFootage.ts). The oracles are the preview's real pixels
 * (frame codes in device screenshots), the exported file decoded on the PC, and the sanitized load
 * telemetry. Run with `MASTERSELECTS_DEVICE=1 npm run test:e2e:device` (tests/playwright/README.md,
 * "Real device"); the normal suites never pick this file up (it is not a *.spec.ts).
 */
test.describe.configure({ mode: 'serial' })
test.skip(!resolveDeviceEnv().enabled, 'real-device journeys run only with MASTERSELECTS_DEVICE=1')

const model = (dev: DeviceWorld) => dev.footage.model

/** Every editing case first proves the open project is the harness's own: the phone user's projects are never edited. */
async function expectDeviceProjectOpen(dev: DeviceWorld): Promise<void> {
  const name = needs(dev.journey.projectName, 'the Device test project')
  await expect(dev.page.getByTestId(IDS.timeline), 'the editor is not showing').toBeVisible({ timeout: 30_000 })
  const shown = (await dev.page.getByTestId(IDS.projectName).textContent({ timeout: UI_WAIT_MS }))?.trim() ?? ''
  if (!isDeviceProjectName(shown) || !shown.includes(name)) throw new Error(`The open project is not the run's Device test project; refusing to edit it.`)
}

function bootProblems(marks: BootMark[], budgetMs: number): string[] {
  return marks.filter(mark => mark.atMs > budgetMs && mark.phase !== 'gpu-failed').map(mark => `${mark.phase} at ${mark.atMs} ms (budget ${budgetMs})`)
}

/**
 * Seeks to `frame` and waits until the preview shows what the edit puts there. On the way only the
 * picture of the frame the playhead came from and of the frames it stepped through (not those on a cut)
 * may show (expectContentAt's rule).
 */
async function showsAt(dev: DeviceWorld, segments: readonly TimelineSegment[], frame: number, timeoutMs = 30_000): Promise<void> {
  const start = await readPlayheadFrame(dev.page)
  const previous = expectedFrameAt(model(dev), segments, start)
  // Pictures of the timeline frames the keyboard seek steps through on its way, strictly between start and
  // target and never at a cut (seekPathPictures). The target itself must still show in the end.
  // At a step whose source time is not clear (jitter puts a timestamp within 2 ms, or the last-timestamp
  // rule and the nominal grid disagree) either policy's picture may pass by.
  const passed = seekPathPictures(segments, start, frame, step => {
    const expected = expectedFrameAt(model(dev), segments, step)
    if (expected === null || isClearFrame(model(dev), segments, step)) return expected
    const seconds = sourceSecondsAt(segments, step, COMP_FPS)
    const { timing } = model(dev).profile
    const nominal = seconds !== null && timing.kind === 'grid' ? Math.round(seconds * timing.fps[0] / timing.fps[1]) : null
    return [expected, expected - 1, expected + 1].filter(picture => picture >= 0 && (nominal === null || picture === expected || picture === nominal))
  })
  await expectContentAt(dev.page, dev.probe, frame, expectedFrameAt(model(dev), segments, frame), { previous, passed, timeoutMs })
}

const describeBoot = (marks: BootMark[]) => marks.map(mark => `${mark.phase} ${mark.atMs}${mark.detail ? ` [${mark.detail}]` : ''}`).join(' · ')

test('D1 create: a new Device test project opens in browser storage without a folder dialog, every load phase measured @device', async ({ dev }, testInfo) => {
  test.setTimeout(420_000)
  const { page, env } = dev
  const first = await waitForFirstScreen(dev)
  const boot = await readBootMarks(page)
  await record(testInfo, 'initial-boot', { firstScreen: first, boot, progress: await takeProgress(page), wallMs: Date.now() - dev.navigationStartedAt },
    `${first} after ${Date.now() - dev.navigationStartedAt} ms · ${describeBoot(boot)}`)
  expect.soft(bootProblems(boot, env.budgets.bootMs), 'the first boot of /m stays within its budget').toEqual([])

  // Folder pickers of this tab only count and refuse: a native dialog would block the phone.
  await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>
    win.__msDevicePickerCalls = 0
    for (const name of ['showDirectoryPicker', 'showSaveFilePicker', 'showOpenFilePicker']) {
      if (typeof win[name] !== 'function') continue
      Object.defineProperty(window, name, { configurable: true, value: async () => {
        win.__msDevicePickerCalls = (win.__msDevicePickerCalls as number) + 1
        throw new DOMException('The user aborted a request.', 'AbortError')
      } })
    }
  })
  await openNewProjectForm(dev)
  const name = deviceProjectName()
  const created = await createDeviceProject(dev, name)
  dev.journey.projectName = name
  await expectDeviceProjectOpen(dev)
  await record(testInfo, 'create-load', created, `${describeLoadReport(created.report)} · wall ${created.wallMs} ms · ${describeActionPhases(created.page)} · ${describeProgress(created.progress)}`)
  expect(await page.evaluate(() => (window as unknown as { __msDevicePickerCalls: number }).__msDevicePickerCalls), 'New project asked for a folder').toBe(0)
  expect(created.report.outcome, 'the create load finished').toBe('ready')
  expect(created.report.storage, 'the project lives in browser storage').toMatch(/^(opfs|indexeddb)$/)
  expect.soft(loadBudgetProblems(created.report, env.budgets), 'every create phase stays within its budget').toEqual([])
  // The page's own clock: tap to the editor without the DevTools transport and without the storage worker's
  // script fetch over the adb link (transport stalls are reported, not judged).
  expect.soft(created.page.pageMs, 'the page saw the Create tap through to the editor').not.toBeNull()
  expect.soft((created.page.pageMs ?? 0) - transportMs(created.report), 'Create tap to editor, page clock').toBeLessThanOrEqual(env.budgets.totalMs)
})

test('D2 import: a generated phone recording picked in the media sheet becomes one clip of its full length, preview shows its frames @device', async ({ dev }, testInfo) => {
  const timeoutMs = 180_000 + Math.round(dev.footage.bytes / 2e6) * 1000
  test.setTimeout(timeoutMs + 240_000)
  await expectDeviceProjectOpen(dev)
  const { env } = dev
  const imported = await importFootage(dev, timeoutMs)
  const frames = footageTimelineFrames(model(dev))
  await record(testInfo, 'import', { profile: dev.profileId, injected: imported.injected, wallMs: imported.wallMs, page: imported.page, imports: imported.imports,
    clip: { startFrame: imported.clip.startFrame, durationFrames: imported.clip.durationFrames } },
    `${dev.profileId} ${(imported.injected.bytes / 1e6).toFixed(1)} MB via ${imported.injected.transport} in ${imported.injected.fetchMs} ms; on the timeline ${imported.wallMs} ms after Done · `
    + `${describeActionPhases(imported.page)}${imported.imports.length ? ` · ${imported.imports.map(describeMediaImport).join(' · ')}` : ' · no import phase reports (build without __MS_MEDIA_IMPORT__)'}`)
  expect.soft(imported.page.pageMs, 'the page saw Done through to the clip tile').not.toBeNull()
  expect.soft(imported.page.pageMs ?? 0, 'Done to clip tile, page clock').toBeLessThanOrEqual(env.budgets.importMs)
  expect(imported.copySettled, 'the background copy into the project finished').toBe(true)
  const copy = imported.imports.find(report => report.kind === 'background-copy')
  if (copy) expect(copy.outcome, `the background copy into the project: ${describeMediaImport(copy)}`).toBe('ok')
  expect(imported.clip.startFrame, 'the clip starts at 0').toBe(0)
  expect(Math.abs(imported.clip.durationFrames - frames), `clip length ${imported.clip.durationFrames} frames, recording ${frames}`).toBeLessThanOrEqual(1)
  const segments: TimelineSegment[] = [{ startFrame: 0, endFrame: imported.clip.durationFrames, sourceStartSeconds: 0 }]
  dev.journey.clip = imported.clip
  dev.journey.segments = segments
  dev.journey.endFrame = imported.clip.durationFrames
  for (const target of [0, Math.round(imported.clip.durationFrames / 3)]) {
    await showsAt(dev, segments, clearFrameNear(model(dev), segments, target, 1), 60_000)
  }
})

test('D3 split: Split at a frame-exact playhead cuts the clip there; the preview shows the right frames on both sides of the cut @device', async ({ dev }, testInfo) => {
  test.setTimeout(300_000)
  await expectDeviceProjectOpen(dev)
  const clip = needs(dev.journey.clip, 'the imported clip')
  const segments = needs(dev.journey.segments, 'the imported clip')
  const { page } = dev
  let split = Math.round(clip.durationFrames / 2)
  while (!isClearFrame(model(dev), segments, split - 1) || !isClearFrame(model(dev), segments, split)) split++
  await seekToFrame(page, split)
  await tapTile(dev, clip.id)
  await seekToFrame(page, split)
  await expect(tile(page, clip.id), 'the clip is selected').toHaveAttribute('aria-selected', 'true')
  await tapOn(dev, page.getByTestId(ACTION_SPLIT))
  let parts: TileState[] = []
  await expect.poll(async () => { parts = (await readTiles(page)).filter(item => item.lane === 'video'); return parts.length },
    { timeout: 30_000, message: 'Split did not make two clips' }).toBe(2)
  const [left, right] = parts
  await record(testInfo, 'split', { split, left, right }, `split at frame ${split}: [${left.startFrame}, +${left.durationFrames}] [${right.startFrame}, +${right.durationFrames}]`)
  expect([left.startFrame, left.durationFrames], 'the first part ends at the playhead').toEqual([0, split])
  expect([right.startFrame, right.durationFrames], 'the second part starts at the playhead and keeps the rest').toEqual([split, clip.durationFrames - split])
  expect(await readPlayheadFrame(page), 'Split did not move the playhead').toBe(split)
  const after = segmentsFromTiles(parts, item => item.startFrame / COMP_FPS)
  dev.journey.splitFrame = split
  dev.journey.segments = after
  await showsAt(dev, after, split - 1)
  await showsAt(dev, after, split)
})

test('D4 trim: dragging the start and end handle of the second part by touch moves its in and out point; first, last and gap frames are right @device', async ({ dev }, testInfo) => {
  test.setTimeout(300_000)
  await expectDeviceProjectOpen(dev)
  const split = needs(dev.journey.splitFrame, 'the split')
  const segments = needs(dev.journey.segments, 'the split')
  const { page } = dev
  const lastVideo = async () => (await readTiles(page)).filter(item => item.lane === 'video' && item.startFrame >= split).at(-1)
  const right = needs(await (async () => { await seekToFrame(page, split + 15); return lastVideo() })(), 'the second part on screen')
  const rightSource = segments.at(-1)!.sourceStartSeconds

  // Start handle: one second to the right.
  await tapTile(dev, right.id)
  const startHandle = page.getByTestId(M1_IDS.trimHandleStart), endHandle = page.getByTestId(M1_IDS.trimHandleEnd)
  await expect(startHandle, 'the selected part shows its start handle').toBeVisible({ timeout: UI_WAIT_MS })
  const box = (await tile(page, right.id).boundingBox())!
  const pxPerFrame = box.width / right.durationFrames
  const startBox = (await startHandle.boundingBox())!
  await dev.touch.pan({ x: startBox.x + startBox.width / 2, y: startBox.y + startBox.height / 2 }, { x: 30 * pxPerFrame, y: 0 })
  let trimmed = right
  await expect.poll(async () => { trimmed = (await lastVideo()) ?? right; return trimmed.durationFrames < right.durationFrames },
    { timeout: UI_WAIT_MS, message: 'dragging the start handle did not shorten the part' }).toBe(true)
  const cutIn = right.durationFrames - trimmed.durationFrames
  expect(cutIn, `the start handle moved by ${cutIn} frames for a 30-frame drag`).toBeGreaterThanOrEqual(20)
  expect(cutIn).toBeLessThanOrEqual(40)
  expect(trimmed.startFrame + trimmed.durationFrames, 'the end stays when the start is trimmed').toBe(right.startFrame + right.durationFrames)

  // End handle: one second to the left.
  const endBefore = trimmed.startFrame + trimmed.durationFrames
  await seekToFrame(page, endBefore - 15)
  if (!await endHandle.isVisible()) await tapTile(dev, trimmed.id)
  await expect(endHandle, 'the selected part shows its end handle').toBeVisible({ timeout: UI_WAIT_MS })
  const endBox = (await endHandle.boundingBox())!
  await dev.touch.pan({ x: endBox.x + endBox.width / 2, y: endBox.y + endBox.height / 2 }, { x: -30 * pxPerFrame, y: 0 })
  let final = trimmed
  await expect.poll(async () => { final = (await lastVideo()) ?? trimmed; return final.durationFrames < trimmed.durationFrames },
    { timeout: UI_WAIT_MS, message: 'dragging the end handle did not shorten the part' }).toBe(true)
  const cutOut = trimmed.durationFrames - final.durationFrames
  expect(cutOut, `the end handle moved by ${cutOut} frames for a 30-frame drag`).toBeGreaterThanOrEqual(20)
  expect(cutOut).toBeLessThanOrEqual(40)
  expect(final.startFrame, 'the start stays when the end is trimmed').toBe(trimmed.startFrame)

  // The in point moved by what the start handle cut, whether or not the part moved with it.
  const after: TimelineSegment[] = [...segments.slice(0, -1), { startFrame: final.startFrame, endFrame: final.startFrame + final.durationFrames, sourceStartSeconds: rightSource + cutIn / COMP_FPS }]
  dev.journey.segments = after
  dev.journey.endFrame = Math.max(...after.map(item => item.endFrame))
  await record(testInfo, 'trim', { right, trimmed, final, cutIn, cutOut, segments: after }, `cut ${cutIn} frames at the start, ${cutOut} at the end; part now [${final.startFrame}, +${final.durationFrames}]`)
  const first = clearFrameNear(model(dev), after, final.startFrame, 1, { max: final.startFrame + final.durationFrames - 1 })
  const last = clearFrameNear(model(dev), after, final.startFrame + final.durationFrames - 1, -1, { min: final.startFrame })
  await showsAt(dev, after, first)
  await showsAt(dev, after, last)
  if (final.startFrame > split) await showsAt(dev, after, split + Math.floor((final.startFrame - split) / 2))
})

test('D5 title: the Text tool adds a title at the playhead that shows in the preview without hiding the frame @device', async ({ dev }, testInfo) => {
  test.setTimeout(240_000)
  await expectDeviceProjectOpen(dev)
  const split = needs(dev.journey.splitFrame, 'the split')
  const segments = needs(dev.journey.segments, 'the edited clip')
  const { page } = dev
  const at = clearFrameNear(model(dev), segments, Math.min(30, split - 1), 1, { max: split - 1 })
  const expected = expectedFrameAt(model(dev), segments, at)
  if (expected === null) throw new Error(`Frame ${at} lies in a gap; the title case needs a frame of the first part`)
  // D4 leaves the trimmed part selected, so the toolbar shows the clip tools; the Text tool is a main tool.
  // Back first, then the reference picture (a selection may draw handles over the preview).
  const toolbar = page.getByTestId(IDS.toolbar)
  if (await toolbar.getAttribute('data-scope') === 'clip') {
    await tapOn(dev, toolbar.getByTestId('phone-toolbar-back'))
    await expect(toolbar, 'Back did not return to the main tools').toHaveAttribute('data-scope', 'root', { timeout: UI_WAIT_MS })
  }
  await showsAt(dev, segments, at)
  const before = await previewPixels(dev)
  const known = new Set((await readTiles(page)).map(item => item.id))
  await tapOn(dev, page.getByTestId(ACTION_TEXT))
  await expect(page.getByTestId(IDS.sheet), 'the text sheet did not open').toBeVisible({ timeout: UI_WAIT_MS })
  await page.getByTestId(M1_IDS.titleInput).fill('Device test title')
  await tapOn(dev, page.getByTestId(IDS.sheetDone))
  await expect(page.getByTestId(IDS.sheet), 'the text sheet stayed open').toBeHidden({ timeout: UI_WAIT_MS })
  let title: TileState | undefined
  await expect.poll(async () => { title = (await readTiles(page)).find(item => !known.has(item.id) && item.lane !== 'audio'); return Boolean(title) },
    { timeout: 30_000, message: 'Done added no title clip' }).toBe(true)
  await record(testInfo, 'title', { at, title }, `title at frame ${title!.startFrame}, ${title!.durationFrames} frames long`)
  expect(Math.abs(title!.startFrame - at), `the title starts at the playhead (${at}), not at ${title!.startFrame}`).toBeLessThanOrEqual(1)
  expect(title!.durationFrames, 'the title has a visible length').toBeGreaterThan(15)
  dev.journey.title = { id: title!.id, startFrame: title!.startFrame, durationFrames: title!.durationFrames }
  dev.journey.endFrame = Math.max(needs(dev.journey.endFrame, 'the content end'), title!.startFrame + title!.durationFrames)
  await expect.poll(async () => differingShare(before, await previewPixels(dev)), { timeout: 20_000, message: 'the title is not visible in the preview' }).toBeGreaterThan(0.003)
  await dev.probe.waitForFrame(expected, { timeoutMs: 15_000 }).catch((error: Error) => { throw new Error(`With the title on top: ${error.message}`) })
})

test('D6 export: the edited project exports at 1080x1920 and every exported frame is the frame the edit puts there @device', async ({ dev }, testInfo) => {
  const endFrame = needs(dev.journey.endFrame, 'the edited timeline')
  const timeoutMs = 600_000 + endFrame * 1_000
  test.setTimeout(timeoutMs + 600_000)
  await expectDeviceProjectOpen(dev)
  const segments = needs(dev.journey.segments, 'the edited clip')
  await seekToFrame(dev.page, 0)
  const result = await exportAndPull(dev, testInfo, timeoutMs)
  const decoded = await decodeExport(result.file)
  const expected = Array.from({ length: endFrame }, (_, frame) => expectedFrameAt(model(dev), segments, frame))
  const verdict = judgeFrames(expected, decoded.frames, index => !isClearFrame(model(dev), segments, index))
  await record(testInfo, 'export', { ...result, decoded: { width: decoded.width, height: decoded.height, frames: decoded.frames.length, durationSeconds: decoded.durationSeconds }, verdict },
    `${result.size ? `${result.size.width}x${result.size.height}` : result.summary} · ${(result.bytes / 1e6).toFixed(1)} MB in ${result.exportMs} ms, pulled via ${result.transport} in ${result.transferMs} ms · `
    + `${decoded.frames.length}/${expected.length} frames, ${verdict.failures.length} wrong, ${verdict.policy.length} rounding-policy differences · ${describeExportEvidence(result.evidence)}`)
  expect(result.size, `the export sheet offers 1080x1920 ("${result.summary}")`).toEqual({ width: 1080, height: 1920 })
  expect(result.sharedType, 'a video file').toMatch(/^video\//)
  expect({ width: decoded.width, height: decoded.height }, 'exported picture size').toEqual({ width: 1080, height: 1920 })
  expect(verdict.failures, 'exported frames that differ from the edit (gaps are black, i.e. none)').toEqual([])
})

test('D7 reopen: after a reload of the tab the project comes back with the same clips and the right frame; the reopen is measured @device', async ({ dev }, testInfo) => {
  test.setTimeout(600_000)
  await expectDeviceProjectOpen(dev)
  const name = needs(dev.journey.projectName, 'the Device test project')
  const endFrame = needs(dev.journey.endFrame, 'the edited timeline')
  const segments = needs(dev.journey.segments, 'the edited clip')
  const { page, env } = dev
  await waitForSaved(dev)
  const before = tileSignature(await readAllTiles(page, endFrame))
  dev.journey.signature = before
  await takeProgress(page)
  const started = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 })
  if (await waitForFirstScreen(dev, 300_000) === 'home') await tapDeviceProjectRow(dev, name)
  const report = await waitForLoadReport(page, 'open', 300_000)
  await expectDeviceProjectOpen(dev)
  const wallMs = Date.now() - started
  const boot = await readBootMarks(page), progress = await takeProgress(page)
  await record(testInfo, 'reopen-load', { report, boot, progress, wallMs },
    `${describeLoadReport(report)} · wall ${wallMs} ms · boot ${describeBoot(boot)} · ${describeProgress(progress)}`)
  expect(report.outcome, 'the reopen finished').toBe('ready')
  expect.soft(loadBudgetProblems(report, env.budgets), 'every reopen phase stays within its budget').toEqual([])
  expect.soft(bootProblems(boot, env.budgets.bootMs), 'the boot after the reload stays within its budget').toEqual([])
  await expect(page.getByTestId(IDS.clip).first(), 'the restored timeline shows clips').toBeVisible({ timeout: 60_000 })
  expect(tileSignature(await readAllTiles(page, endFrame)), 'same clips, cuts and positions after the reload').toBe(before)
  await showsAt(dev, segments, clearFrameNear(model(dev), segments, 10, 1, { max: segments[0].endFrame - 1 }), 60_000)
})
