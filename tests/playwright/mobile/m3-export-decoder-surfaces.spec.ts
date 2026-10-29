import type { TestInfo } from '@playwright/test'
import { PHONE_M1_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EXPORT_TEST_IDS as EXPORT, phoneExportOptionTestId } from '../../../src/components/mobileSkin/export/phoneExportTestIds'
import { readPhoneFrameCode, streamDisplayFrames } from '../assertions/phoneFootageOracle'
import { installAndroidDecoderModel, removeAndroidDecoderModel } from '../fixtures/androidDecoderModel'
import { generatePhoneFootage } from '../fixtures/phoneFootage'
import { PHONE_FOOTAGE_PROFILES, frameIndexAt } from '../fixtures/phoneFootageProfiles'
import { IDS, TOPBAR_EXPORT, expect, importViaSheet, probeVideo, seek, tapForDownload, tapOn, test, type M1Session } from './m1Fixture'

/**
 * Watch for the phone export that seeks for seconds per frame (docs/Features/Export.md, "Decoder
 * surface budget"): FAST export held more decoded frames than an Android hardware decoder has output
 * surfaces, so the decoder stopped and every wait ran into its time limit (2-9 s per frame on a
 * Pixel 10 Pro). The desktop decoder has a large pool, so the case puts the Android decoder model
 * (fixtures/androidDecoderModel.ts) in place for the export and throttles the CPU like a phone.
 *
 * The verdict is relative, not a wall-clock budget: the share of the export the exporter spent
 * seeking (ExportDiagnostics phase totals, read through the bridge) and every exported frame checked
 * with the phone footage oracle.
 */
test.describe.configure({ timeout: 420_000 })

const M1 = PHONE_M1_TEST_IDS
/** Output surfaces of the modelled decoder (Pixel 10 Pro, H.264 1080x1920: see the Export docs). */
const ANDROID_SURFACES = 4
const CPU_THROTTLE = Number(process.env.MASTERSELECTS_E2E_CPU_THROTTLE ?? 4)
/** Most of an export may not be spent waiting for the decoder; before the fix it was over 90 %. */
const MAX_SEEK_SHARE = 0.5

interface ExportRunSummary {
  status: string
  elapsedMs: number
  phaseTotals: Record<string, number>
  frames: { all: { count: number; maxMs: number } }
  decoder?: Record<string, unknown>
}

async function lastExportRun(m1: M1Session): Promise<ExportRunSummary> {
  const stats = await m1.bridge.toolData<{ export?: { last?: ExportRunSummary | null } }>('getStats')
  const run = stats.export?.last
  if (!run) throw new Error('getStats reported no finished export run')
  return run
}

async function exportContent(m1: M1Session, testInfo: TestInfo): Promise<string> {
  const { page } = m1
  await tapOn(m1, page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet, 'the export sheet did not open').toBeVisible()
  const toggle = page.getByTestId(EXPORT.advancedToggle)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await tapOn(m1, toggle)
  const content = page.getByTestId(phoneExportOptionTestId('range', 'content'))
  await tapOn(m1, content)
  await expect(content).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId(M1.exportSummary)).toHaveText('1080 × 1920 · 30 fps · 0:02 · MP4')
  await tapOn(m1, page.getByTestId(M1.exportStart))
  await expect(page.getByTestId(M1.exportSave), 'the export never finished').toHaveAttribute('aria-disabled', 'false', { timeout: 360_000 })
  const { file } = await tapForDownload(m1, page.getByTestId(M1.exportSave), testInfo, 'android-surfaces')
  await tapOn(m1, page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
  return file
}

test('android-decoder-surfaces: a phone recording exports without waiting on a decoder that has only a few output surfaces @phone', async ({ m1 }, testInfo) => {
  const footage = await generatePhoneFootage({ ...PHONE_FOOTAGE_PROFILES['android-h264'], seconds: 2 })
  await importViaSheet(m1, { visual: [footage.path] }, { main: 1, total: 2 })
  await seek(m1, 0)

  // The export's own log (decoder restarts, slow frames, the learnt budget) goes with the result.
  const log: string[] = []
  const onConsole = (message: { text(): string }) => {
    const text = message.text()
    if (/\[(WebCodecsExportMode|ExportDiagnostics|FrameExporter|ClipPreparation|PhoneExport)\]/.test(text) && log.length < 4000) log.push(text.slice(0, 300))
  }
  m1.page.on('console', onConsole)
  await m1.page.evaluate((debug) => {
    const logger = (window as unknown as { Logger?: { setLevel(level: string): void; enable(modules: string): void } }).Logger
    if (debug) logger?.enable('WebCodecsExportMode')
    logger?.setLevel(debug ? 'DEBUG' : 'INFO')
  }, process.env.MASTERSELECTS_E2E_EXPORT_DEBUG === '1')
  await installAndroidDecoderModel(m1.page, ANDROID_SURFACES)
  if (CPU_THROTTLE > 1) await m1.cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  let file: string
  let model: Awaited<ReturnType<typeof removeAndroidDecoderModel>>
  try {
    file = await exportContent(m1, testInfo)
  } finally {
    m1.page.off('console', onConsole)
    await testInfo.attach('export-log.txt', { body: log.join('\n'), contentType: 'text/plain' })
    await m1.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined)
    model = await removeAndroidDecoderModel(m1.page).catch(() => null)
    await m1.page.evaluate(() => {
      const logger = (window as unknown as { Logger?: { setLevel(level: string): void; disable(): void } }).Logger
      logger?.disable()
      logger?.setLevel('WARN')
    }).catch(() => undefined)
  }

  const run = await lastExportRun(m1)
  const seekShare = (run.phaseTotals.seek ?? 0) / Math.max(1, run.elapsedMs)
  const frames: Array<number | null> = []
  await streamDisplayFrames(file, (pixels, index) => { frames[index] = readPhoneFrameCode(pixels).frame })
  const video = await probeVideo(file)
  const expected = Array.from({ length: 60 }, (_, index) => index)
  // Jittered constant-rate footage is matched on its nominal grid; the last-timestamp rule is the other accepted policy.
  const wrong = expected.flatMap(index => frames[index] === index || frames[index] === frameIndexAt(footage.model, index / 30)
    ? [] : [`#${index}: ${frames[index] ?? 'unreadable'}`])
  await testInfo.attach('export-run.json', {
    body: JSON.stringify({ seekShare, elapsedMs: run.elapsedMs, phaseTotals: run.phaseTotals, frames: run.frames, decoder: run.decoder ?? null, model }, null, 2),
    contentType: 'application/json',
  })
  process.stdout.write(`[android-surfaces] ${run.frames.all.count} frames in ${Math.round(run.elapsedMs)} ms, seek ${Math.round(run.phaseTotals.seek ?? 0)} ms `
    + `(${(seekShare * 100).toFixed(1)} %), slowest frame ${Math.round(run.frames.all.maxMs)} ms, decoder ${JSON.stringify(run.decoder ?? null)}, model ${JSON.stringify(model)}\n`)

  expect(run.status, 'the export finished').toBe('success')
  expect(model?.decoders ?? 0, 'the export decoded through the Android decoder model').toBeGreaterThan(0)
  // The content ends with the recording's sound, a few milliseconds after its last picture: 60 or 61 frames.
  expect({ width: video.width, height: video.height }, 'exported picture size').toEqual({ width: 1080, height: 1920 })
  expect(video.frames, 'exported frames').toBeGreaterThanOrEqual(60)
  expect(video.frames).toBeLessThanOrEqual(61)
  expect(wrong, 'exported frames that are not the frame the timeline shows there').toEqual([])
  expect(seekShare, `share of the export spent seeking (${Math.round(run.phaseTotals.seek ?? 0)} of ${Math.round(run.elapsedMs)} ms)`).toBeLessThanOrEqual(MAX_SEEK_SHARE)
})
