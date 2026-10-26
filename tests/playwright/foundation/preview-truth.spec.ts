import { randomUUID } from 'node:crypto'
import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import type { BridgeClient } from '../fixtures/bridgeClient'
import { EditorPage } from '../fixtures/editorPage'
import { frameCodeClip, type FrameCodeClip } from '../fixtures/frameCodeMedia'
import { PreviewProbe } from '../fixtures/previewProbe'
import { ExportDriver } from '../drivers/ExportDriver'
import { checkFrameSequence, readVideoFrameCodes } from '../assertions/frameCodeOracle'

/**
 * Vorschau-Wahrheit: the example of a deterministic Sammeltest. One prepared
 * project (a generated clip whose every frame carries its number) is shared by
 * the worker; every case is its own test and first resets what it depends on.
 * Nothing trusts an engine "ready" flag or a fixed sleep: each step waits until
 * the preview's real pixels show the expected frame, and records when.
 */
interface Shared { page: Page; editor: EditorPage; bridge: BridgeClient; clip: FrameCodeClip; probe: PreviewProbe }

const test = base.extend<object, { truth: Shared }>({
  truth: [async ({ browser }, provide, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL
    if (!baseURL) throw new Error('Playwright baseURL must be configured')
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true })
    const page = await context.newPage()
    await warmGpu(page, baseURL)
    const editor = await EditorPage.bootstrap(page, { baseURL, tabId: randomUUID() })
    const clip = await frameCodeClip({ width: 640, height: 360, fps: 30, seconds: 4 })
    // A composition of the clip's size and rate: the clip fills the preview, one composition frame is one source frame.
    await editor.bridge.toolData('createComposition', { name: 'Vorschau-Wahrheit', width: clip.width, height: clip.height,
      frameRate: clip.fps, duration: clip.frames / clip.fps, open: true })
    await editor.bridge.toolData('importLocalFiles', { paths: [clip.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 0 }, { timeoutMs: 60_000 })
    await editor.waitForProjectIdle(30_000)
    await provide({ page, editor, bridge: editor.bridge, clip, probe: new PreviewProbe(page) })
    await context.close()
  }, { scope: 'worker', timeout: 180_000 }],
})

// A fresh Chrome on Linux/Vulkan reports no WebGPU adapter for about a second;
// the editor must not initialise before the GPU answers.
async function warmGpu(page: Page, baseURL: string): Promise<void> {
  await page.goto(new URL('/favicon.png', baseURL).toString())
  await expect.poll(() => page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return gpu ? Boolean(await gpu.requestAdapter()) : 'no-webgpu-api'
  }), { timeout: 15_000, message: 'Chrome never offered a WebGPU adapter' }).not.toBe(false)
}

test.describe.configure({ timeout: 120_000 })

// From the moment the preview exists to the right frame on screen: the editor's own loading.
const FIRST_FRAME_BUDGET_MS = 3_000
// From the reload to the right frame; includes booting the app from the dev server.
const RELOAD_BUDGET_MS = 30_000

interface ClipState { id: string; effects?: Array<{ id: string; type?: string; name?: string }> }
interface TimelineState { playheadPosition: number; isPlaying?: boolean; videoTracks: Array<{ clips: ClipState[] }> }

async function theClip(bridge: BridgeClient): Promise<ClipState> {
  const state = await bridge.toolData<TimelineState>('getTimelineState')
  const clip = state.videoTracks.flatMap(track => track.clips)[0]
  if (!clip) throw new Error('The frame-code clip is not on the timeline')
  return clip
}

// Every case starts from the same state: paused, no effects, playhead on frame 0, and the preview really
// showing frame 0. If the preview does not get there (a previous case left it stuck), the page is reloaded,
// so one defect cannot turn the following cases red; the reload is noted on the case.
async function reset({ page, editor, bridge, probe }: Shared, testInfo: TestInfo): Promise<void> {
  await bridge.toolData('pause')
  const clip = await theClip(bridge)
  const details = await bridge.toolData<ClipState>('getClipDetails', { clipId: clip.id })
  for (const effect of details.effects ?? []) await bridge.toolData('removeEffect', { clipId: clip.id, effectId: effect.id })
  await bridge.toolData('setPlayhead', { time: 0 })
  probe.mark()
  try {
    await probe.waitForFrame(0, { allowed: () => true, timeoutMs: 3_000 })
  } catch {
    testInfo.annotations.push({ type: 'reset-reload', description: `frame 0 did not show after the seek, page reloaded. ${probe.summary()}` })
    await page.reload({ waitUntil: 'commit' })
    await editor.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
    await editor.bridge.authenticate()
    await editor.waitForProjectIdle(30_000)
    probe.mark()
    await probe.waitForFrame(0, { allowed: () => true, timeoutMs: 30_000 })
  }
}

test('after a reload the preview shows frame 0 within the budget, never a wrong or stale frame @module:foundation', async ({ truth }, testInfo) => {
  const { page, editor, probe } = truth
  await reset(truth, testInfo)
  probe.mark()
  await page.reload({ waitUntil: 'commit' })
  const first = await probe.waitForFrame(0, { timeoutMs: 30_000 })
  // It stays: half a second of reads after the first frame shows nothing else.
  const until = Date.now() + 500
  while (Date.now() < until) {
    const { reading, observation } = await probe.read()
    expect(reading.frame, `frame 0 flickered away at ${observation.at} ms. ${probe.summary()}`).toBe(0)
  }
  const previewAt = probe.observations.find(item => item.reason !== 'no-preview')?.at ?? 0
  const timing = { reloadToPreviewMs: previewAt, previewToFirstFrameMs: first.at - previewAt, reloadToFirstFrameMs: first.at }
  await testInfo.attach('first-frame-timeline.json', { body: JSON.stringify({ ...timing, observations: probe.observations }, null, 1), contentType: 'application/json' })
  console.log(`${JSON.stringify(timing)} ${probe.summary()}`)
  expect(timing.previewToFirstFrameMs, `the preview needed ${timing.previewToFirstFrameMs} ms from appearing to the right frame. ${probe.summary()}`).toBeLessThan(FIRST_FRAME_BUDGET_MS)
  expect(timing.reloadToFirstFrameMs, probe.summary()).toBeLessThan(RELOAD_BUDGET_MS)
  await editor.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await editor.bridge.authenticate()
  await editor.waitForProjectIdle(30_000)
})

// Known product defect, found by this test (2026-10-26): while paused, a seek moves the playhead but the
// preview keeps the previous frame on screen (the newly decoded frame is never repainted). Remove the
// marker when the fix lands; Playwright then reports this case as unexpectedly passing.
const PAUSED_REPAINT_DEFECT = 'paused preview is not repainted after a seek (stale frame on screen)'

test('each Next frame click shows exactly the next frame, 37 clicks land on frame 37 @module:foundation', async ({ truth }, testInfo) => {
  test.fail(true, PAUSED_REPAINT_DEFECT)
  const { page, bridge, probe, clip } = truth
  await reset(truth, testInfo)
  const next = page.getByRole('button', { name: 'Next frame', exact: true })
  for (let frame = 1; frame <= 5; frame++) {
    await next.click()
    await probe.waitForFrame(frame, { allowed: shown => shown === frame - 1 })
  }
  for (let frame = 6; frame <= 37; frame++) await next.click()
  await probe.waitForFrame(37, { allowed: shown => shown >= 5 && shown < 37 })
  const { playheadPosition } = await bridge.toolData<TimelineState>('getTimelineState')
  expect(Math.round(playheadPosition * clip.fps)).toBe(37)
  for (let read = 0; read < 4; read++) expect((await probe.read()).reading.frame, probe.summary()).toBe(37)
})

test('playing advances the frames in order without jumps or freezes, pausing holds the frame @module:foundation', async ({ truth }, testInfo) => {
  test.fail(true, PAUSED_REPAINT_DEFECT)
  const { page, probe, bridge, clip } = truth
  await reset(truth, testInfo)
  probe.mark()
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  const samples: Array<{ at: number; frame: number }> = []
  const until = Date.now() + 2_000
  while (Date.now() < until) {
    const { reading, observation } = await probe.read()
    expect(reading.valid, `unreadable frame while playing at ${observation.at} ms (${observation.reason}). ${probe.summary()}`).toBe(true)
    samples.push({ at: observation.at, frame: reading.frame! })
  }
  await bridge.toolData('pause')
  const moving = samples.findIndex(sample => sample.frame > 0)
  expect(moving, `playback never left frame 0. ${probe.summary()}`).toBeGreaterThanOrEqual(0)
  for (let index = moving + 1; index < samples.length; index++) {
    const previous = samples[index - 1], sample = samples[index]
    expect(sample.frame, `went backwards at ${sample.at} ms. ${probe.summary()}`).toBeGreaterThanOrEqual(previous.frame)
    // Real time between two reads allows this many frames, plus two for read timing.
    const allowed = Math.ceil((sample.at - previous.at) / 1000 * clip.fps) + 2
    expect(sample.frame - previous.frame, `jumped ${sample.frame - previous.frame} frames in ${sample.at - previous.at} ms. ${probe.summary()}`).toBeLessThanOrEqual(allowed)
  }
  const frozen = samples.slice(moving).reduce((worst, sample, _index, list) => {
    const firstSame = list.findIndex(other => other.frame === sample.frame)
    return Math.max(worst, sample.at - list[firstSame].at)
  }, 0)
  expect(frozen, `one frame stayed ${frozen} ms while playing. ${probe.summary()}`).toBeLessThan(250)
  const last = samples.at(-1)!.frame, rate = (last - samples[moving].frame) / ((samples.at(-1)!.at - samples[moving].at) / 1000)
  expect(rate, `played ${rate.toFixed(1)} frames per second`).toBeGreaterThan(clip.fps * 0.8)
  // Paused: the preview holds one frame, and it is the playhead's frame.
  const { playheadPosition } = await bridge.toolData<TimelineState>('getTimelineState')
  // Frame k covers [k/fps, (k+1)/fps): a paused playhead between two frame starts shows the earlier one.
  const held = Math.floor(playheadPosition * clip.fps + 1e-6)
  await probe.waitForFrame(held, { allowed: shown => Math.abs(shown - held) <= 2 })
  for (let read = 0; read < 4; read++) expect((await probe.read()).reading.frame, probe.summary()).toBe(held)
})

test('the Invert effect turns every colour bar into its complement and keeps the frame @module:foundation', async ({ truth }, testInfo) => {
  const { page, bridge, probe } = truth
  await reset(truth, testInfo)
  const before = await probe.read()
  const clip = await theClip(bridge)
  // Selecting is arrangement (the timeline is a canvas here); adding the effect is the action under test and goes through the UI.
  await bridge.toolData('selectClips', { clipIds: [clip.id] })
  await page.getByRole('tab', { name: 'Properties' }).click()
  await page.locator('.tab-btn', { hasText: /^Effects/ }).click()
  await page.locator('summary', { hasText: '+ Add Effect' }).click()
  await page.getByRole('textbox', { name: 'Search effects' }).fill('invert')
  await page.locator('details[open]').getByText('Invert', { exact: true }).first().click()
  await probe.waitForFrame(0, { inverted: true, allowed: shown => shown === 0 })
  const after = await probe.read()
  const deviation = Math.max(...after.bars.flatMap((bar, index) => bar.measured.map((value, channel) => Math.abs(value - (255 - before.bars[index].measured[channel])))))
  expect(deviation, `bars after Invert: ${JSON.stringify(after.bars.map(bar => bar.measured.map(Math.round)))}`).toBeLessThanOrEqual(4)
})

test('a two-second export holds frames 0 to 59, each exactly once and in order @module:foundation', async ({ truth }, testInfo) => {
  const { page, bridge } = truth
  await reset(truth, testInfo)
  await bridge.toolData('setInOutPoints', { inPoint: 0, outPoint: 2 })
  const exporter = new ExportDriver(page)
  await exporter.open()
  await exporter.selectFastWebCodecs()
  await exporter.useCompositionSettings()
  await exporter.useInOutMarkers()
  await exporter.setFilename('preview-truth')
  const file = testInfo.outputPath('preview-truth.mp4')
  await exporter.exportTo(file)
  const decoded = await readVideoFrameCodes(file)
  const report = checkFrameSequence(decoded.readings, { from: 0, count: 60 })
  expect(report.problems, `frames in the file: ${report.frames.join(',')}`).toEqual([])
  const stats = await bridge.toolData<{ export?: { last?: { status?: string; previousFrameFallbacks?: number } } }>('getStats')
  expect(stats.export?.last?.previousFrameFallbacks ?? 0, 'the exporter repeated a previous frame instead of rendering it').toBe(0)
  await bridge.toolData('setInOutPoints', { inPoint: null, outPoint: null })
})
