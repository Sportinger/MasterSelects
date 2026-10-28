import { test as base, expect, type CDPSession, type ConsoleMessage, type Locator, type TestInfo } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { openFrameCodeProject, type FrameCodeProject } from '../fixtures/frameCodeProject'
import { dragMetrics, previewLatencies, round, stats, valueStep, type Stats } from './latencyAnalysis'
import { installLatencyInstrumentation, installPreviewSampler, startCapture, stopCapture, type LatencyCapture } from './latencyInstrumentation'
import { calibratePreview, installStoreProbe, matchPreviewFrames, readStoreValue, type StoreProbeSnapshot } from './storeProbe'

/**
 * Inspector drags must stay snappy while rendering catches up (owner report 2026-10-28: dragging
 * values in the Transform panel and effect inspector was "super laggy"; analysis: every drag sample
 * re-encoded the whole clip, ~110 ms with three effects). One shared project: a 1920x1080 frame-code
 * clip, paused at frame 45, selected in the Properties panel. Each case drags one inspector control
 * with a 125 Hz mouse (CDP, 2.5 s triangle wave) and measures:
 *
 * Hard (deterministic) assertions, per gesture:
 * - every drag sample stays a live gesture preview: TimelineGesturePreview.stage() accepts each
 *   write, none is rejected and no "Gesture preview off" warning is logged;
 * - exactly one repository revision, no composition-mirror write during the drag and one at release;
 * - the store action costs at most 10 ms per sample (mean; quiet hosts measure 0.3-0.5 ms, a load
 *   average of 25 up to 1.6 ms, and 3.3.6 needed 122-160 ms with three effects);
 * - after release the control shows the last dragged value (it was saved), the preview pixels show
 *   that value (rendering caught up) and one undo restores the start value.
 *
 * Measured and judged against budgets (soft by default, see BUDGETS): frame rate during the drag,
 * input-to-control paint and input-to-preview paint. The preview latency comes from pixels: three
 * rows of the preview canvas after every paint, matched against reference renders of known values.
 */

interface Shared extends FrameCodeProject { clipId: string; cdp: CDPSession; logs: string[] }

interface Budget { fps: number; controlP50: number; previewP50: number }
interface Scenario {
  title: string
  effects: boolean
  tab: 'Transform' | 'Effects'
  /** The dragged control (EditableDraggableNumber span or HandleOnlyRange root). */
  control: (shared: Shared) => Locator
  /** The number field next to a slider: it follows the store, not the drag. */
  paired?: (shared: Shared) => Locator
  slider: boolean
  property: (shared: Shared) => Promise<string>
  amplitude: number
  direction: 1 | -1
  budget: 'plain' | 'effects'
  /** setTransform arguments applied before the drag (on top of the default transform). */
  startTransform?: Record<string, number>
}

const PROBE_TIME = 1.5
const PROBE_FRAME = 45
const DRAG_MS = 2500
/**
 * Wide on purpose: a slow or loaded CI CPU must not flake this hard check. It still catches the
 * full-clip re-serialization (122-160 ms per sample with three effects); on the plain clip that
 * regression is caught by the stage() and mirror-write counters instead (3.3.6 there: 1.2 ms).
 */
const STORE_MS_PER_SAMPLE = 10
const EFFECTS = ['brightness', 'gaussian-blur', 'glow'] as const
/**
 * Position X starts at -600 px: the number field's drag step grows with the value (EditableDraggableNumber
 * getPerPixelStep), and from 0 a 200 px drag moves the clip by under one pixel, which no preview pixel can
 * show. From -600 px the same drag moves it about 36 px.
 */
const POSITION_START = { x: -600 }
/**
 * MASTERSELECTS_INSPECTOR_PERF: unset = timing budgets are reported as `perf-soft` annotations only
 * (the deterministic counters decide); `budget` = a missed default budget fails the case (a quiet,
 * dedicated host); `strict` = the owner targets from the analysis fail the case.
 */
const PERF_MODE = process.env.MASTERSELECTS_INSPECTOR_PERF?.trim()
const STRICT = PERF_MODE === 'strict'
const ENFORCE_BUDGETS = STRICT || PERF_MODE === 'budget'
/** MASTERSELECTS_INSPECTOR_PERF_RESULTS=<file>: append each case's full result as one JSON line. */
const RESULTS_FILE = process.env.MASTERSELECTS_INSPECTOR_PERF_RESULTS?.trim()
/**
 * Frame-rate and latency budgets (soft by default: a miss is annotated, the deterministic checks decide).
 * Measured 2026-10-28 on the Linux desktop (24 cores, AMD RDNA3, dev server, headless, software
 * preview presentation), quiet host (load average < 5): 36-43 fps, control p50 8-12 ms, preview p50
 * 70-93 ms in every case. The same journey against the code before the fix (3.3.6): 5-7 fps, control
 * 174-220 ms, preview 230-330 ms and 120-160 ms store work per sample with three effects; 19 fps,
 * control 58-61 ms, preview 163-178 ms on the plain clip. With other agents rendering on the same host
 * (load average 12-25) the fixed code dropped to 8-23 fps while every deterministic check still held,
 * which is why the budgets are soft and a busy host is annotated (`host-busy`).
 * The default budgets leave about 1.5-2x headroom below the quiet-host numbers for slower CI machines
 * (no GPU, other load) and still fail the 3.3.6 behaviour on every metric.
 * MASTERSELECTS_INSPECTOR_PERF=strict applies the owner targets from the analysis; they need the
 * open follow-ups in docs/Features/Inspector-Performance.md ("Drag latency"): same-frame preview
 * commit, the Linux presentation path and the remaining editor-wide re-renders per sample. The
 * pixel-based preview latency here includes GPU readback and presentation, which the analysis's
 * GPU-submit stamp did not.
 */
const BUDGETS: Record<'plain' | 'effects', Budget> = STRICT
  ? { plain: { fps: 50, controlP50: 20, previewP50: 45 }, effects: { fps: 40, controlP50: 25, previewP50: 60 } }
  : { plain: { fps: 25, controlP50: 25, previewP50: 160 }, effects: { fps: 20, controlP50: 30, previewP50: 180 } }

const transformControl = (label: string) => (shared: Shared) => shared.page.locator(`[aria-label="${label}"][role="slider"]`).first()
const sliderControl = (label: string) => (shared: Shared) => shared.page.locator(`.handle-only-range[aria-label="${label} slider"]`).first()
const blurCard = (shared: Shared) => shared.page.locator('.effect-item').filter({ has: shared.page.locator('[aria-label="Remove Gaussian Blur"]') })

const SCENARIOS: Scenario[] = [
  { title: 'plain clip: Position X scrub', effects: false, tab: 'Transform', control: transformControl('Position X'), slider: false,
    property: async () => 'position.x', amplitude: 100, direction: -1, budget: 'plain', startTransform: POSITION_START },
  { title: 'plain clip: Rotation slider', effects: false, tab: 'Transform', control: sliderControl('Rotation Angle'),
    paired: transformControl('Rotation Angle'), slider: true, property: async () => 'rotation.z', amplitude: 20, direction: -1, budget: 'plain' },
  { title: 'Brightness + Gaussian Blur + Glow: Position X scrub', effects: true, tab: 'Transform', control: transformControl('Position X'), slider: false,
    property: async () => 'position.x', amplitude: 100, direction: -1, budget: 'effects', startTransform: POSITION_START },
  { title: 'Brightness + Gaussian Blur + Glow: Rotation slider', effects: true, tab: 'Transform', control: sliderControl('Rotation Angle'),
    paired: transformControl('Rotation Angle'), slider: true, property: async () => 'rotation.z', amplitude: 20, direction: -1, budget: 'effects' },
  { title: 'Brightness + Gaussian Blur + Glow: Blur radius slider', effects: true, tab: 'Effects',
    control: shared => blurCard(shared).locator('.handle-only-range[aria-label="Radius slider"]').first(),
    paired: shared => blurCard(shared).locator('[aria-label="Radius"][role="slider"]').first(), slider: true,
    property: async shared => `effect.${(await effectsOf(shared)).find(effect => effect.type === 'gaussian-blur')!.id}.radius`,
    amplitude: 15, direction: 1, budget: 'effects' },
]

const test = base.extend<object, { shared: Shared }>({
  shared: [async ({ browser }, provide, workerInfo) => {
    const project = await openFrameCodeProject(browser, workerInfo.project.use.baseURL, {
      composition: 'Inspector-Latency',
      clip: { width: 1920, height: 1080, fps: 30, seconds: 4 },
      prepareContext: async context => { await context.addInitScript(installLatencyInstrumentation) },
    })
    const { bridge, page, probe, context } = project
    const logs: string[] = []
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'warning' || message.type() === 'error' || /Gesture preview/.test(message.text())) logs.push(message.text().slice(0, 300))
    })
    const state = await bridge.toolData<{ videoTracks: Array<{ clips: Array<{ id: string }> }> }>('getTimelineState')
    const clipId = state.videoTracks[0].clips[0].id
    await bridge.toolData('selectClips', { clipIds: [clipId] })
    await bridge.toolData('setPlayhead', { time: PROBE_TIME })
    await probe.waitForFrame(PROBE_FRAME, { allowed: () => true, timeoutMs: 15_000 })
    await page.getByRole('tab', { name: 'Properties' }).click()
    await page.evaluate(installStoreProbe)
    await page.evaluate(installPreviewSampler)
    const cdp = await context.newCDPSession(page)
    await provide({ ...project, clipId, cdp, logs })
    await context.close()
  }, { scope: 'worker', timeout: 300_000 }],
})

test.describe.configure({ timeout: 180_000 })

// ---------- arrangement (Dev Bridge) ----------
interface ClipEffect { id: string; type?: string }
async function effectsOf(shared: Shared): Promise<ClipEffect[]> {
  return (await shared.bridge.toolData<{ effects?: ClipEffect[] }>('getClipDetails', { clipId: shared.clipId })).effects ?? []
}

/** Waits until the preview holds still for a few paints (in-page, frame paced). */
async function previewStill(shared: Shared, timeoutMs = 5_000): Promise<boolean> {
  return shared.page.evaluate(async timeout => {
    const sampler = (window as unknown as { __previewSampler: { read(): Uint8ClampedArray | null; distance(a: Uint8ClampedArray, b: Uint8ClampedArray): number; final?: Uint8ClampedArray | null } }).__previewSampler
    const started = performance.now()
    let previous = sampler.read(), still = 0
    while (performance.now() - started < timeout) {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const current = sampler.read()
      still = current && previous && sampler.distance(previous, current) < 0.3 ? still + 1 : 0
      previous = current
      if (still >= 4) { sampler.final = current; return true }
    }
    sampler.final = previous
    return false
  }, timeoutMs)
}

/** Every case starts from the default transform, the case's effect stack and a still preview. */
async function reset(shared: Shared, scenario: Scenario, testInfo: TestInfo): Promise<void> {
  const { bridge, clipId } = shared
  await bridge.toolData('setTransform', { clipId, x: 0, y: 0, rotationZ: 0, scaleX: 1, scaleY: 1, opacity: 1 })
  const current = await effectsOf(shared)
  const wanted: readonly string[] = scenario.effects ? EFFECTS : []
  if (current.map(effect => effect.type).join() !== wanted.join()) {
    for (const effect of current) await bridge.toolData('removeEffect', { clipId, effectId: effect.id })
    for (const effectType of wanted) await bridge.toolData('addEffect', { clipId, effectType })
  }
  await bridge.toolData('selectClips', { clipIds: [clipId] })
  await bridge.toolData('setPlayhead', { time: PROBE_TIME })
  if (!scenario.effects) await shared.probe.waitForFrame(PROBE_FRAME, { allowed: () => true, timeoutMs: 10_000 })
  if (scenario.startTransform) await bridge.toolData('setTransform', { clipId, ...scenario.startTransform })
  if (!await previewStill(shared)) testInfo.annotations.push({ type: 'preview-not-still', description: 'the preview kept changing before the drag' })
  await shared.page.locator('.tab-btn', { hasText: new RegExp(`^${scenario.tab}`) }).first().click()
  await shared.page.mouse.move(5, 300)
}

// ---------- the action under test: a 125 Hz mouse drag over DevTools ----------
async function drag(cdp: CDPSession, x: number, y: number, { amplitude, direction }: { amplitude: number; direction: 1 | -1 }): Promise<number> {
  const send = (params: Record<string, unknown>) => cdp.send('Input.dispatchMouseEvent', params as never)
  await send({ type: 'mouseMoved', x, y })
  await send({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  const low = direction < 0 ? x - 2 * amplitude : x, high = direction < 0 ? x : x + 2 * amplitude
  const pending: Array<Promise<unknown>> = []
  const started = Date.now()
  let cursor = x, heading: number = direction, sent = 0
  // A 125 Hz mouse: one event every 8 ms, two pixels each, as a triangle wave over the amplitude.
  while (Date.now() - started < DRAG_MS) {
    cursor += heading * 2
    if (cursor <= low) heading = 1
    else if (cursor >= high) heading = -1
    pending.push(send({ type: 'mouseMoved', x: cursor, y, button: 'left', buttons: 1 }).catch(() => undefined))
    sent++
    await new Promise(resolve => setTimeout(resolve, 8))
  }
  await Promise.all(pending)
  await send({ type: 'mouseReleased', x: cursor, y, button: 'left', buttons: 0, clickCount: 1 })
  return sent
}

interface CaseResult {
  scenario: string
  budget: Budget
  sentPointerEvents: number
  store: Omit<StoreProbeSnapshot, 'actionMs' | 'revisionId'> & { msPerSample: Stats; meanMsPerSample: number }
  metrics: ReturnType<typeof dragMetrics>
  previewMs: Stats
  preview: { changedFrames: number; matched: number; unmatched: number; references: number; spacing: number; tolerance: number; calibrationErrors: string[] }
  values: { start: number; lastDragged: number; shownAfterRelease: number; previewAfterRelease: number | null; afterUndo: number | null; storeStart: number | null }
  gesturePreviewLogs: string[]
  /** Host load when the case ran: frame rate and latencies are only comparable between quiet hosts. */
  host: { loadAverage1m: number; cpus: number }
}

async function measure(shared: Shared, scenario: Scenario, testInfo: TestInfo): Promise<CaseResult> {
  const { page } = shared
  await reset(shared, scenario, testInfo)
  const control = scenario.control(shared)
  await control.scrollIntoViewIfNeeded()
  await expect(control, `${scenario.title}: the control is visible`).toBeVisible()
  const property = await scenario.property(shared)
  const target = scenario.slider ? control.locator('.handle-only-range-thumb') : control
  const box = (await target.boundingBox())!
  const start = Number(await control.getAttribute('aria-valuenow'))
  const storeStart = await page.evaluate(readStoreValue, { clipId: shared.clipId, property })
  const controlHandle = await control.elementHandle()
  const pairedHandle = scenario.paired ? await scenario.paired(shared).elementHandle() : null
  const logStart = shared.logs.length
  await page.evaluate(() => (window as unknown as { __storeProbe: { reset(): void } }).__storeProbe.reset())
  await page.evaluate(startCapture, { control: controlHandle!, paired: pairedHandle })
  const sentPointerEvents = await drag(shared.cdp, box.x + box.width / 2, box.y + box.height / 2, scenario)
  // Release ends the gesture: wait for its revision, then for the preview to hold still.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __storeProbe: { snapshot(r: number): StoreProbeSnapshot } }).__storeProbe.snapshot(0).revisions),
    { timeout: 10_000, message: `${scenario.title}: the gesture never committed a revision` }).toBeGreaterThanOrEqual(1)
  const caughtUp = await previewStill(shared)
  const capture = await page.evaluate(stopCapture) as LatencyCapture
  const snapshot = await page.evaluate(release => (window as unknown as { __storeProbe: { snapshot(r: number): StoreProbeSnapshot } }).__storeProbe.snapshot(release), capture.release)
  const lastDragged = capture.values.at(-1)?.v ?? start
  const shownAfterRelease = Number(await control.getAttribute('aria-valuenow'))
  const gesturePreviewLogs = shared.logs.slice(logStart).filter(line => /Gesture preview/.test(line))

  // One undo step brings the start value back.
  await shared.bridge.toolData('undo')
  await expect.poll(() => page.evaluate(readStoreValue, { clipId: shared.clipId, property }), { timeout: 5_000 })
    .toBeCloseTo(storeStart ?? Number.NaN, 4)
  const afterUndo = await page.evaluate(readStoreValue, { clipId: shared.clipId, property })

  // Reference renders across the dragged range, then match every painted frame.
  const dragged = capture.values.map(value => value.v)
  const range: [number, number] = [Math.min(start, ...dragged), Math.max(start, ...dragged)]
  const calibration = await page.evaluate(calibratePreview, { clipId: shared.clipId, property, control: controlHandle!, range, count: 33 })
  // A frame counts as a new picture when it moved at least 40 % of one reference step away from the last one.
  const matches = await page.evaluate(matchPreviewFrames, { frames: capture.frames, changeThreshold: Math.max(0.01, calibration.spacing * 0.4) })
  const step = valueStep(capture.values)
  const tolerance = Math.max(step * 0.75, (range[1] - range[0]) / 32 / 4)
  const maxDistance = Math.max(1.5, calibration.spacing * 1.5)
  const preview = previewLatencies(matches, capture.values, capture.moves, { tolerance, maxDistance, from: capture.t0, until: capture.release || capture.t1 })
  const finalMatch = await page.evaluate(() => {
    const sampler = (window as unknown as { __previewSampler: { final?: Uint8ClampedArray | null; match(sig: Uint8ClampedArray): { value: number; distance: number } | null } }).__previewSampler
    return sampler.final ? sampler.match(sampler.final) : null
  })
  const metrics = dragMetrics(capture, snapshot.samples)
  const result: CaseResult = {
    scenario: scenario.title, budget: BUDGETS[scenario.budget], sentPointerEvents,
    store: { samples: snapshot.samples, stageAccepted: snapshot.stageAccepted, stageRejected: snapshot.stageRejected, rejectReasons: snapshot.rejectReasons,
      revisions: snapshot.revisions, revisionLabels: snapshot.revisionLabels, systemRevisions: snapshot.systemRevisions, mirrorWritesDuringDrag: snapshot.mirrorWritesDuringDrag, mirrorWritesAfterRelease: snapshot.mirrorWritesAfterRelease,
      msPerSample: stats(snapshot.actionMs), meanMsPerSample: round(snapshot.actionMs.reduce((sum, ms) => sum + ms, 0) / Math.max(1, snapshot.actionMs.length), 2) },
    metrics, previewMs: stats(preview.latencies),
    preview: { changedFrames: preview.changedFrames, matched: preview.matched, unmatched: preview.unmatched, references: calibration.references,
      spacing: round(calibration.spacing, 2), tolerance: round(tolerance, 4), calibrationErrors: calibration.errors },
    values: { start, lastDragged, shownAfterRelease, previewAfterRelease: finalMatch && finalMatch.distance <= maxDistance ? round(finalMatch.value, 4) : null,
      afterUndo, storeStart },
    gesturePreviewLogs,
    host: { loadAverage1m: round(loadavg()[0], 2), cpus: cpus().length },
  }
  if (!caughtUp) testInfo.annotations.push({ type: 'preview-not-still', description: 'the preview kept changing after release' })
  // Frame rate and latency depend on the host: flag a busy one so a missed soft budget is read in context.
  if (result.host.loadAverage1m > result.host.cpus * 0.5) {
    testInfo.annotations.push({ type: 'host-busy', description: `load average ${result.host.loadAverage1m} on ${result.host.cpus} CPUs: fps and latencies are not comparable` })
  }
  await testInfo.attach('inspector-latency.json', { body: JSON.stringify(result, null, 1), contentType: 'application/json' })
  // Optional: collect every case's full result in one file (budget calibration, before/after tables).
  if (RESULTS_FILE) appendFileSync(RESULTS_FILE, `${JSON.stringify(result)}\n`)
  console.log(`LATENCY ${JSON.stringify({ s: scenario.title, fps: metrics.fps, control: metrics.controlMs.p50, controlP95: metrics.controlMs.p95, controlDom: metrics.controlDomMs.p50, samplerMs: metrics.samplerCostMsPerFrame,
    paired: metrics.pairedFieldMs?.p50 ?? null, preview: result.previewMs.p50, previewP95: result.previewMs.p95, storeMs: result.store.meanMsPerSample,
    samples: snapshot.samples, stage: [snapshot.stageAccepted, snapshot.stageRejected], revisions: snapshot.revisions,
    mirror: [snapshot.mirrorWritesDuringDrag, snapshot.mirrorWritesAfterRelease], commitsPerSample: metrics.reactCommitsPerSample,
    longTasks: metrics.longTasks, load: result.host.loadAverage1m, roots: metrics.renderRoots.slice(0, 5), matched: `${preview.matched}/${preview.changedFrames}`, refs: calibration.references, spacing: round(calibration.spacing, 2),
    canvas: await page.evaluate(() => (window as unknown as { __previewSampler: { describe(): string } }).__previewSampler.describe()) })}`)
  return result
}

function judge(result: CaseResult, testInfo: TestInfo): void {
  const { store, values, metrics, budget } = result
  // Deterministic: the gesture-preview contract and one revision per gesture.
  expect(store.stageRejected, `TimelineGesturePreview.stage() rejected drag samples: ${store.rejectReasons.join('; ')}`).toBe(0)
  expect(result.gesturePreviewLogs, 'gesture-preview warnings during the drag').toEqual([])
  expect(store.mirrorWritesDuringDrag, 'composition-mirror writes during the drag (each one re-encodes the clip)').toBe(0)
  expect(store.meanMsPerSample, 'store action cost per drag sample (ms, mean)').toBeLessThanOrEqual(STORE_MS_PER_SAMPLE)
  expect(store.samples, 'the drag reached the store as frame-coalesced samples').toBeGreaterThanOrEqual(20)
  expect(store.stageAccepted, 'every drag sample stayed a live gesture preview').toBeGreaterThanOrEqual(store.samples)
  expect(store.revisions, `repository revisions for one gesture: ${store.revisionLabels.join(', ')}`).toBe(1)
  expect(store.mirrorWritesAfterRelease, 'composition-mirror writes at release').toBe(1)
  expect(values.shownAfterRelease, 'after release the control shows the last dragged value (it was saved)').toBeCloseTo(values.lastDragged, 4)
  expect(values.previewAfterRelease, 'after release the preview pixels show the last dragged value').not.toBeNull()
  expect(Math.abs(values.previewAfterRelease! - values.lastDragged), 'preview after release vs last dragged value')
    .toBeLessThanOrEqual(Math.max(result.preview.tolerance * 2, Math.abs(values.lastDragged - values.start) * 0.05))
  expect(result.preview.matched, 'preview frames matched to a dragged value').toBeGreaterThanOrEqual(Math.min(10, result.preview.changedFrames))
  // Measured: frame rate and latencies against the budgets. A loaded host (other agents rendering) easily
  // halves the frame rate while every counter above still holds, so by default a miss is an annotation.
  const misses = [
    metrics.fps < budget.fps ? `${metrics.fps} fps (budget >= ${budget.fps})` : null,
    (metrics.controlMs.p50 ?? Number.POSITIVE_INFINITY) > budget.controlP50 ? `control p50 ${metrics.controlMs.p50} ms (budget <= ${budget.controlP50})` : null,
    (result.previewMs.p50 ?? Number.POSITIVE_INFINITY) > budget.previewP50 ? `preview p50 ${result.previewMs.p50} ms (budget <= ${budget.previewP50})` : null,
  ].filter((miss): miss is string => miss !== null)
  if (misses.length) testInfo.annotations.push({ type: ENFORCE_BUDGETS ? 'perf-failure' : 'perf-soft', description: `${misses.join('; ')}; host load ${result.host.loadAverage1m}` })
  if (!ENFORCE_BUDGETS) return
  expect.soft(metrics.fps, `frames per second during the drag (budget ${budget.fps})`).toBeGreaterThanOrEqual(budget.fps)
  expect.soft(metrics.controlMs.p50 ?? Number.POSITIVE_INFINITY, `input to control paint, p50 ms (budget ${budget.controlP50})`).toBeLessThanOrEqual(budget.controlP50)
  expect.soft(result.previewMs.p50 ?? Number.POSITIVE_INFINITY, `input to preview paint, p50 ms (budget ${budget.previewP50})`).toBeLessThanOrEqual(budget.previewP50)
}

for (const scenario of SCENARIOS) {
  test(`inspector drag stays responsive: ${scenario.title} @module:performance-stress`, async ({ shared }, testInfo) => {
    judge(await measure(shared, scenario, testInfo), testInfo)
  })
}
