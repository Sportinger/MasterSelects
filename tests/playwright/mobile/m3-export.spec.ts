import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import type { TestInfo } from '@playwright/test'
import { readVideoFrameCodes } from '../assertions/frameCodeOracle'
import { PHONE_M1_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EXPORT_FORMATS, type PhoneExportFormatId } from '../../../src/components/mobileSkin/export/phoneExportFormats'
import {
  PHONE_EXPORT_TEST_IDS as EXPORT, phoneExportFormatTestId, phoneExportOptionTestId,
} from '../../../src/components/mobileSkin/export/phoneExportTestIds'
import {
  A_TAG, B_TAG, FPS, IDS, TOPBAR_EXPORT, expect, importViaSheet, seek, tapClip, tapForDownload, tapOn, test,
  type M1Session, type M1Timeline,
} from './m1Fixture'

/**
 * M3 "Profi-Blätter", packet export pro (PLAN.md section 5): the Advanced part of the export sheet
 * and the batch queue, one catalog case per test, in the M1 phone world (m1Fixture.ts). The truth
 * is the decoded output file: ffprobe for container, codec, size and duration, the frame-code
 * oracle for which frames are in it. Every choice is a real touch on the phone UI; the bridge only
 * arranges (playhead) and inspects. The boot-phase case reads the page's own timing record.
 *
 * Media: A = 4 s (frames 0..119), B = 3 s (frames 0..89), short = 1 s (frames 0..29), all
 * 360x640 at 30 fps in a 1080x1920 composition; tone = 1 s 440 Hz stereo WAV.
 */
test.describe.configure({ timeout: 240_000 })

const execFileAsync = promisify(execFile)
const M1 = PHONE_M1_TEST_IDS

interface StreamInfo { codec: string; width?: number; height?: number; frames: number; sampleRate?: number; formatName: string; duration: number }

async function probeStream(file: string, stream: 'v:0' | 'a:0'): Promise<StreamInfo> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', stream,
    '-show_entries', 'stream=codec_name,width,height,nb_read_frames,sample_rate:format=format_name,duration', '-of', 'json', file])
  const parsed = JSON.parse(stdout) as { streams: Array<{ codec_name: string; width?: number; height?: number; nb_read_frames?: string; sample_rate?: string }>; format: { format_name: string; duration?: string } }
  const info = parsed.streams[0]
  if (!info) throw new Error(`${file} has no ${stream} stream`)
  return {
    codec: info.codec_name, width: info.width, height: info.height, frames: Number(info.nb_read_frames ?? 0),
    sampleRate: info.sample_rate ? Number(info.sample_rate) : undefined, formatName: parsed.format.format_name, duration: Number(parsed.format.duration ?? 0),
  }
}

async function maxVolumeDb(file: string): Promise<number> {
  const { stderr } = await execFileAsync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  const match = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)
  return match && match[1] !== '-inf' ? Number(match[1]) : -Infinity
}

/** Crops the contain-fitted 360x640 source picture out of a batch output (a small file in the test output). */
async function cropToSource(file: string, video: StreamInfo, testInfo: TestInfo): Promise<string> {
  const width = video.width ?? 0
  const height = video.height ?? 0
  const scale = Math.min(width / 360, height / 640)
  const cropWidth = 2 * Math.floor((360 * scale) / 2) - 4
  const cropHeight = 2 * Math.floor((640 * scale) / 2) - 4
  const out = testInfo.outputPath('batch-source-crop.mp4')
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf',
    `crop=${cropWidth}:${cropHeight}:${Math.round((width - cropWidth) / 2)}:${Math.round((height - cropHeight) / 2)}`,
    '-c:v', 'libx264', '-crf', '12', out])
  return out
}

async function importShort(m1: M1Session): Promise<M1Timeline> {
  return importViaSheet(m1, { visual: [m1.media.short.path] }, { main: 1, total: 1 })
}

/** Opens the export sheet with the Advanced part expanded. */
async function openAdvanced(m1: M1Session): Promise<void> {
  const { page } = m1
  await tapOn(m1, page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet, 'the export sheet did not open').toBeVisible()
  const toggle = page.getByTestId(EXPORT.advancedToggle)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await tapOn(m1, toggle)
  await expect(page.getByTestId(EXPORT.advanced), 'the Advanced part did not open').toBeVisible()
}

/** Taps an option chip and waits until it is the pressed one. */
async function choose(m1: M1Session, testId: string): Promise<void> {
  const chip = m1.page.getByTestId(testId)
  await expect(chip, `${testId} is greyed in this browser: ${await chip.getAttribute('title')}`).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, chip)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
}

async function chooseFormat(m1: M1Session, id: PhoneExportFormatId): Promise<void> {
  await choose(m1, phoneExportFormatTestId(id))
}

/** Taps Export, waits for the finished file and saves it through the Save button. */
async function exportAndSave(m1: M1Session, testInfo: TestInfo, name: string): Promise<{ file: string; suggested: string }> {
  const { page } = m1
  await tapOn(m1, page.getByTestId(M1.exportStart))
  await expect(page.getByTestId(M1.exportSave), 'the export never finished').toHaveAttribute('aria-disabled', 'false', { timeout: 200_000 })
  return tapForDownload(m1, page.getByTestId(M1.exportSave), testInfo, name)
}

async function closeSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
}

async function expectToast(m1: M1Session, pattern: RegExp): Promise<void> {
  await expect(m1.page.getByTestId(IDS.toast), 'the reason toast').toContainText(pattern)
}

test('browser-codecs-and-containers: Advanced lists every export format and a greyed one explains itself @phone', async ({ m1 }) => {
  const { page } = m1
  await importShort(m1)
  await openAdvanced(m1)
  for (const format of PHONE_EXPORT_FORMATS) {
    await expect(page.getByTestId(phoneExportFormatTestId(format.id)), `${format.label} is offered`).toHaveCount(1)
  }
  const hap = page.getByTestId(phoneExportFormatTestId('mov-hap'))
  await expect(hap, 'HAP is not in the phone export yet').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, hap)
  await expectToast(m1, /All options/)
  await expect(hap, 'a greyed format is never selected by a tap').toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId(EXPORT.allOptions), 'the full desktop export panel is reachable').toBeVisible()
  await closeSheet(m1)
})

test('browser-codecs-and-containers: 720p WebM VP9 at 24 fps decodes with that size, codec, rate and frames @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(360_000)
  await importShort(m1)
  await seek(m1, 0)
  await openAdvanced(m1)
  await chooseFormat(m1, 'webm-vp9')
  await choose(m1, phoneExportOptionTestId('resolution', 720))
  await choose(m1, phoneExportOptionTestId('fps', 24))
  await choose(m1, phoneExportOptionTestId('range', 'content'))
  await expect(m1.page.getByTestId(M1.exportSummary)).toHaveText('720 × 1280 · 24 fps · 0:01 · WEBM')

  const { file, suggested } = await exportAndSave(m1, testInfo, 'advanced-720p-vp9')
  expect(suggested).toMatch(/\.webm$/i)
  const video = await probeStream(file, 'v:0')
  expect({ codec: video.codec, width: video.width, height: video.height, frames: video.frames }, 'decoded stream')
    .toEqual({ codec: 'vp9', width: 720, height: 1280, frames: 24 })
  expect(video.formatName).toMatch(/webm|matroska/)
  const frames = (await readVideoFrameCodes(file)).readings.map(reading => reading.frame)
  // Frame i of a 24 fps export shows the 30 fps source frame whose interval contains i/24 s, the frame the
  // paused preview shows at that time (sample and hold; parallelDecode/presentationFrame.ts grid rule).
  const wrong = frames.flatMap((frame, index) => frame !== null && frame === Math.floor(index * (FPS / 24) + 1e-6) && (index === 0 || frame > (frames[index - 1] ?? -1))
    ? [] : [`#${index}: ${frame ?? 'unreadable'} (source time ${(index / 24).toFixed(3)} s)`])
  expect(wrong, 'frame codes of the 24 fps export: the source frame on screen at each export time, rising').toEqual([])
})

test('still-image-export: a PNG of the playhead frame at 720p @phone', async ({ m1 }, testInfo) => {
  await importShort(m1)
  await seek(m1, 0.5)
  await openAdvanced(m1)
  await chooseFormat(m1, 'still')
  await choose(m1, phoneExportOptionTestId('image', 'png'))
  await choose(m1, phoneExportOptionTestId('resolution', 720))
  await expect(m1.page.getByTestId(M1.exportSummary)).toContainText('720 × 1280 · frame at 0.50 s · PNG')
  const { file, suggested } = await exportAndSave(m1, testInfo, 'still')
  expect(suggested).toMatch(/\.png$/i)
  const meta = await sharp(file).metadata()
  expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'png', width: 720, height: 1280 })
  const [reading] = (await readVideoFrameCodes(file)).readings
  expect(reading?.frame, 'the still shows the frame at the playhead (0.5 s = frame 15)').toBe(15)
})

test('export-range: Selected clips exports exactly the selected clip, In to out explains a missing mark @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(360_000)
  const base = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  expect(base.main[0].name).toContain(A_TAG)
  expect(base.main[1].name).toContain(B_TAG)
  // Clip B starts at 4 s: bring it under the fixed centre playhead, then select it with a tap.
  await seek(m1, 5)
  await tapClip(m1, base.main[1].id)
  await expect(m1.clip(base.main[1].id)).toHaveAttribute('aria-selected', 'true')
  await openAdvanced(m1)
  await chooseFormat(m1, 'mp4-h264')
  const inOut = m1.page.getByTestId(phoneExportOptionTestId('range', 'in-out'))
  await expect(inOut, 'no in/out marks are set').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, inOut)
  await expectToast(m1, /in or out point/)
  await choose(m1, phoneExportOptionTestId('resolution', 480))
  await choose(m1, phoneExportOptionTestId('fps', 'composition'))
  await choose(m1, phoneExportOptionTestId('range', 'selection'))
  await expect(m1.page.getByTestId(M1.exportSummary)).toHaveText('480 × 854 · 30 fps · 0:03 · MP4')

  const { file } = await exportAndSave(m1, testInfo, 'range-selection')
  const video = await probeStream(file, 'v:0')
  expect({ width: video.width, height: video.height, frames: video.frames }).toEqual({ width: 480, height: 854, frames: 90 })
  const frames = (await readVideoFrameCodes(file)).readings.map(reading => reading.frame)
  const wrong = frames.flatMap((frame, index) => frame === index ? [] : [`#${index}: ${frame ?? 'unreadable'}`])
  expect(wrong.slice(0, 12), 'only clip B (frames 0..89) is in the file').toEqual([])
})

test('wav-export: sound only as WAV keeps the tone, its rate and its length @phone', async ({ m1 }, testInfo) => {
  await importViaSheet(m1, { audio: [m1.media.audio] }, { total: 1 })
  await openAdvanced(m1)
  await chooseFormat(m1, 'audio-wav')
  await choose(m1, phoneExportOptionTestId('range', 'content'))
  await expect(m1.page.getByTestId(M1.exportSummary)).toHaveText('Sound only · 0:01 · WAV')
  const { file, suggested } = await exportAndSave(m1, testInfo, 'sound')
  expect(suggested).toMatch(/\.wav$/i)
  const audio = await probeStream(file, 'a:0')
  expect(audio.codec).toMatch(/^pcm_/)
  expect(audio.sampleRate).toBe(48_000)
  expect(audio.duration, `WAV length ${audio.duration.toFixed(3)} s`).toBeGreaterThan(0.95)
  expect(audio.duration).toBeLessThan(1.1)
  // The source tone peaks at -18 dBFS; the mix keeps it well above silence.
  expect(await maxVolumeDb(file), 'the 440 Hz tone is audible in the file').toBeGreaterThan(-30)
})

test('project-export-presets: save, load and delete a project preset on the phone @phone', async ({ m1 }) => {
  const { page } = m1
  await importShort(m1)
  await openAdvanced(m1)
  await chooseFormat(m1, 'webm-vp9')
  await choose(m1, phoneExportOptionTestId('resolution', 720))
  await choose(m1, phoneExportOptionTestId('fps', 24))
  await choose(m1, phoneExportOptionTestId('range', 'content'))
  const name = `Phone 720 ${m1.tabId.slice(0, 6)} ${Date.now() % 100000}`
  await page.getByTestId(EXPORT.presetName).fill(name)
  await tapOn(m1, page.getByTestId(EXPORT.presetSave))
  await expectToast(m1, /Saved preset/)
  const presetChip = page.locator(`[data-testid^="phone-export-preset-export-preset-"]`, { hasText: name })
  await expect(presetChip, 'the saved preset is listed and selected').toHaveAttribute('aria-pressed', 'true')

  await chooseFormat(m1, 'mp4-h264')
  await choose(m1, phoneExportOptionTestId('resolution', 480))
  await expect(page.getByTestId(M1.exportSummary)).toContainText('480 × 854')

  // Reopening the sheet keeps the project preset.
  await closeSheet(m1)
  await openAdvanced(m1)
  await tapOn(m1, presetChip)
  await expectToast(m1, /Loaded/)
  await expect(page.getByTestId(M1.exportSummary), 'the loaded preset sets format, size and rate').toHaveText('720 × 1280 · 24 fps · 0:01 · WEBM')

  await tapOn(m1, page.getByTestId(EXPORT.presetDelete))
  await expectToast(m1, /Deleted preset/)
  await expect(presetChip, 'the deleted preset is gone').toHaveCount(0)
  await closeSheet(m1)
})

test('batch-run-and-retry: queue a project video, run it, save the converted file and clear the queue @phone', async ({ m1 }, testInfo) => {
  test.setTimeout(360_000)
  const { page } = m1
  await importShort(m1)
  await tapOn(m1, page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet).toBeVisible()
  const toggle = page.getByTestId(EXPORT.batchToggle)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await tapOn(m1, toggle)
  await expect(page.getByTestId(EXPORT.batch)).toBeVisible()
  // A queue left behind by an earlier run is cleared the way a person does it.
  const clear = page.getByTestId(EXPORT.batchClear)
  if (await clear.isVisible()) await tapOn(m1, clear)
  await expect(page.getByTestId(EXPORT.batchJob)).toHaveCount(0)

  await tapOn(m1, page.getByTestId(EXPORT.batchSource).filter({ hasText: '-30f-' }).first())
  const job = page.getByTestId(EXPORT.batchJob)
  await expect(job, 'the video is queued').toHaveCount(1)
  const retry = page.getByTestId(EXPORT.batchRetry)
  await expect(retry, 'nothing failed yet').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, retry)
  await expectToast(m1, /nothing to retry/)

  await tapOn(m1, page.getByTestId(EXPORT.batchRun))
  await expect(job, 'the queued job finished').toHaveAttribute('data-status', 'completed', { timeout: 200_000 })
  const { file } = await tapForDownload(m1, job.getByTestId(EXPORT.batchJobSave), testInfo, 'batch')
  const video = await probeStream(file, 'v:0')
  expect(video.frames, 'the converted file holds the whole 1 s source').toBeGreaterThanOrEqual(29)
  await expect(job, 'the job row names the output size').toContainText(`${video.width} × ${video.height}`)
  // The batch fits the 360x640 source into the job's size ('contain'); read the codes inside the picture.
  const frames = (await readVideoFrameCodes(await cropToSource(file, video, testInfo))).readings.map(reading => reading.frame)
  expect(frames.slice(0, 5), 'the converted file starts at source frame 0').toEqual([0, 1, 2, 3, 4])
  expect(frames.length, 'every source frame is in the converted file').toBeGreaterThanOrEqual(29)

  await tapOn(m1, page.getByTestId(EXPORT.batchClear))
  await expect(job, 'the queue is empty again').toHaveCount(0)
  await closeSheet(m1)
})

test('android-load-stall: the phone records its boot phases, with the project open before the GPU is needed @phone', async ({ m1 }) => {
  const { page } = m1
  await importShort(m1)
  await seek(m1, 0.2)
  const phases = () => page.evaluate(() => {
    const record = (window as Window & { __MS_PHONE_BOOT__?: { marks: Array<{ phase: string; at: number }> } }).__MS_PHONE_BOOT__
    return record ? record.marks.map(mark => mark.phase) : []
  })
  await expect.poll(phases, { message: 'boot phases recorded on the page', timeout: 30_000 })
    .toEqual(expect.arrayContaining(['boot-start', 'repository-open', 'stores-hydrated', 'timeline-visible', 'gpu-ready', 'first-preview-frame']))
  const marks = await page.evaluate(() => (window as Window & { __MS_PHONE_BOOT__?: { marks: Array<{ phase: string; at: number }> } }).__MS_PHONE_BOOT__!.marks)
  const at = (phase: string) => marks.find(mark => mark.phase === phase)!.at
  expect(at('boot-start'), 'boot starts before the project store is hydrated').toBeLessThanOrEqual(at('stores-hydrated'))
  expect(marks.some(mark => mark.phase === 'gpu-failed'), 'no GPU failure on the test host').toBe(false)
})
