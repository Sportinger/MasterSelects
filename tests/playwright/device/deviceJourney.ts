import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { TestInfo } from '@playwright/test'
import sharp from 'sharp'
import { readPhoneFrameCode, streamDisplayFrames } from '../assertions/phoneFootageOracle'
import { ACTION_MEDIA, IDS, M1_IDS, TOPBAR_EXPORT, TOPBAR_PROJECTS, expect, tapOn, type DeviceWorld } from './deviceFixture'
import { footageContentType, pixelRecordingName } from './deviceFootage'
import { injectFile, installShareCapture, pullSharedFile, removeShareCapture, sharedFiles, type InjectedFile } from './deviceMedia'
import { parseExportSize } from './deviceParsing'
import { markLoadReportsSeen, readBootMarks, takeProgress, waitForLoadReport, type ProgressSample } from './deviceTelemetry'
import { readTiles, type TileState } from './deviceTimeline'
import type { BootMark, LoadReport } from './deviceParsing'

const run = promisify(execFile)

/**
 * The phone UI flows the device journeys are made of. Taps are real touch; the only things done
 * without a finger are typing a name (Input.insertText, what the soft keyboard sends) and handing a
 * generated file to the media input (what the native picker does).
 */

/** Waits for the first screen after a boot: the editor (the restored last project) or the home. */
export async function waitForFirstScreen(world: DeviceWorld, timeoutMs = 180_000): Promise<'editor' | 'home'> {
  const { page } = world
  const home = page.getByTestId(M1_IDS.home), timeline = page.getByTestId(IDS.timeline)
  await expect(home.or(timeline).first(), 'neither the phone home nor the editor appeared').toBeVisible({ timeout: timeoutMs })
  return await home.isVisible() ? 'home' : 'editor'
}

/**
 * Shows the phone home and its new-project form. When the boot restored a project (the owner's last
 * one), the top bar's Projects button shows the home over it without closing or changing it.
 */
export async function openNewProjectForm(world: DeviceWorld): Promise<void> {
  const { page } = world
  if (await waitForFirstScreen(world) === 'editor') {
    await tapOn(world, page.getByTestId(TOPBAR_PROJECTS))
    await expect(page.getByTestId(M1_IDS.home), 'Projects did not show the phone home').toBeVisible({ timeout: 30_000 })
  }
  const create = page.getByTestId(M1_IDS.createProject)
  if (!await create.isVisible()) await tapOn(world, page.getByTestId(M1_IDS.newProject))
  await expect(create, 'the new-project form did not open').toBeVisible({ timeout: 15_000 })
}

export interface LoadMeasurement { report: LoadReport; progress: ProgressSample[]; wallMs: number; boot: BootMark[] }

/** New 9:16 project in browser storage: format chip, name, Create. Measures the create load. */
export async function createDeviceProject(world: DeviceWorld, name: string): Promise<LoadMeasurement> {
  const { page } = world
  await tapOn(world, page.getByTestId(`${M1_IDS.formatChip}-9:16`))
  await page.getByTestId(M1_IDS.projectNameInput).fill(name)
  await expect(page.getByTestId(M1_IDS.projectNameInput)).toHaveValue(name)
  await markLoadReportsSeen(page)
  await takeProgress(page)
  const started = Date.now()
  await tapOn(world, page.getByTestId(M1_IDS.createProject))
  await expect(page.getByTestId(IDS.timeline), 'the new project did not open in the editor').toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId(M1_IDS.home), 'the home stays on top of the new project').toHaveCount(0, { timeout: 30_000 })
  const wallMs = Date.now() - started
  const report = await waitForLoadReport(page, 'create', 120_000)
  return { report, progress: await takeProgress(page), wallMs, boot: await readBootMarks(page) }
}

export interface ImportMeasurement { injected: InjectedFile; wallMs: number; clip: TileState; tiles: TileState[] }

/** Media tool, the generated recording into the visual input, Done; resolves when the video tile is there. */
export async function importFootage(world: DeviceWorld, timeoutMs: number): Promise<ImportMeasurement> {
  const { page } = world
  await tapOn(world, page.getByTestId(ACTION_MEDIA))
  const sheet = page.getByTestId(IDS.sheet)
  await expect(sheet, 'the media sheet did not open').toBeVisible({ timeout: 15_000 })
  const injected = await injectFile(page, world.env, world.server, world.footage.path, {
    inputTestId: M1_IDS.mediaInputVisual, contentType: footageContentType(world.footage.path), name: pixelRecordingName(world.footage.path),
  })
  await expect(page.getByTestId(M1_IDS.mediaPickedItem), 'the media sheet lists the picked recording').toHaveCount(1, { timeout: 60_000 })
  const started = Date.now()
  await tapOn(world, page.getByTestId(IDS.sheetDone))
  await expect(sheet, 'the media sheet stayed open after Done').toBeHidden({ timeout: timeoutMs })
  let tiles: TileState[] = []
  await expect.poll(async () => { tiles = await readTiles(page); return tiles.filter(tile => tile.lane === 'video').length },
    { timeout: timeoutMs, message: 'the recording did not reach the timeline as one video clip' }).toBe(1)
  return { injected, wallMs: Date.now() - started, clip: tiles.find(tile => tile.lane === 'video')!, tiles }
}

/** Reads the preview pixels (css scale, RGB). */
export async function previewPixels(world: DeviceWorld): Promise<{ width: number; height: number; data: Buffer }> {
  const png = await world.probe.canvas.screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: 10_000 })
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Share of pixels below the frame-code bands (top 30 %) that differ by more than `threshold` in a channel. */
export function differingShare(before: { width: number; height: number; data: Buffer }, after: { width: number; height: number; data: Buffer }, threshold = 40): number {
  if (before.width !== after.width || before.height !== after.height) return 1
  const first = Math.floor(before.height * 0.3) * before.width, total = before.width * before.height
  let different = 0
  for (let pixel = first; pixel < total; pixel++) {
    const offset = pixel * 3
    if (Math.max(Math.abs(before.data[offset] - after.data[offset]), Math.abs(before.data[offset + 1] - after.data[offset + 1]),
      Math.abs(before.data[offset + 2] - after.data[offset + 2])) > threshold) different++
  }
  return different / Math.max(1, total - first)
}

export interface ExportResult {
  file: string; bytes: number; summary: string; size: { width: number; height: number } | null
  exportMs: number; transferMs: number; transport: string; sharedName: string; sharedType: string
}

/**
 * Export sheet: Export, wait until Share is ready, tap Share. The tab's navigator.share is stubbed
 * (deviceMedia.installShareCapture) so the File stays in the page instead of a share sheet or the
 * owner's Downloads; it is then copied to the PC (MASTERSELECTS_DEVICE_OUTPUT_DIR).
 */
export async function exportAndPull(world: DeviceWorld, testInfo: TestInfo, timeoutMs: number): Promise<ExportResult> {
  const { page } = world
  await tapOn(world, page.getByTestId(TOPBAR_EXPORT))
  await expect(page.getByTestId(IDS.sheet), 'the export sheet did not open').toBeVisible({ timeout: 15_000 })
  const summaryLocator = page.getByTestId(M1_IDS.exportSummary)
  await expect(summaryLocator).toContainText(/\d/, { timeout: 30_000 })
  const summary = (await summaryLocator.textContent())?.trim() ?? ''
  await installShareCapture(page)
  try {
    const started = Date.now()
    await tapOn(world, page.getByTestId(M1_IDS.exportStart))
    await expect(page.getByTestId(M1_IDS.exportShare), 'the export never finished').toHaveAttribute('aria-disabled', 'false', { timeout: timeoutMs })
    const exportMs = Date.now() - started
    await tapOn(world, page.getByTestId(M1_IDS.exportShare))
    await expect.poll(async () => (await sharedFiles(page)).length, { message: 'Share handed no file to navigator.share', timeout: 30_000 }).toBe(1)
    const [shared] = await sharedFiles(page)
    const file = path.join(world.env.outputDir, `${testInfo.testId}-${Date.now()}${path.extname(shared.name) || '.mp4'}`)
    const pulled = await pullSharedFile(page, world.env, world.server, 0, file)
    expect(pulled.bytes, 'the export arrived complete on the PC').toBe(shared.size)
    await tapOn(world, page.getByTestId(IDS.sheetCancel))
    await expect(page.getByTestId(IDS.sheet), 'the export sheet did not close').toBeHidden({ timeout: 15_000 })
    return { file, bytes: pulled.bytes, summary, size: parseExportSize(summary), exportMs, transferMs: pulled.transferMs, transport: pulled.transport,
      sharedName: shared.name, sharedType: shared.type }
  } finally {
    await removeShareCapture(page)
  }
}

export interface DecodedExport { width: number; height: number; frames: Array<number | null>; durationSeconds: number }

/** Every frame of the exported file in display orientation, read with the phone footage oracle on the PC. */
export async function decodeExport(file: string): Promise<DecodedExport> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file])
  const parsed = JSON.parse(stdout) as { streams: Array<{ width: number; height: number }>; format: { duration?: string } }
  const frames: Array<number | null> = []
  await streamDisplayFrames(file, (pixels, index) => { frames[index] = readPhoneFrameCode(pixels).frame })
  return { width: parsed.streams[0].width, height: parsed.streams[0].height, frames, durationSeconds: Number(parsed.format.duration ?? 0) }
}
