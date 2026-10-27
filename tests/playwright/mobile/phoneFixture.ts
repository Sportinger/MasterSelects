import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test as base, type Browser, type BrowserContext, type Locator, type Page, type TestInfo, type WorkerInfo } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { BridgeClient, DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { frameCodeClip } from '../fixtures/frameCodeMedia'
import { warmGpu } from '../fixtures/frameCodeProject'
import { PreviewProbe } from '../fixtures/previewProbe'
import { PhoneTouch, type Point } from './phoneTouch'

/**
 * The shared Sammeltest project of the phone journeys (one per worker, built
 * once), and the per-test reset.
 *
 * How the project is built (decision): the phone skin has no import UI in M0, so
 * the project is arranged exactly like the desktop frame-code fixtures do
 * (fixtures/frameCodeProject.ts): the Dev Bridge tools `createComposition` and
 * `importLocalFiles` (with `addToTimeline`, sequential placement) put generated
 * frame-code clips back to back on the main video track. That is existing
 * infrastructure, needs no app change, and the bridge is dev-only like the
 * tests. Arrangement and inspection use the bridge; every ACTION under test
 * (pan, pinch, tap, split, undo, greyed action) goes through real touch input
 * on the phone UI. The page stays on plain /m (never `?test`, which forces desktop).
 */
export const IDS = PHONE_TEST_IDS
export const CLIP_WIDTH = 360
export const CLIP_HEIGHT = 640
export const FPS = 30

/** Two long clips (distinguishable by length) and 18 short ones: 20 clips, about 30 s. */
const CLIP_SECONDS = [4, 3, ...Array.from({ length: 18 }, (_, index) => (30 + index) / FPS)]

export interface PhoneClip { id: string; name: string; start: number; duration: number; inPoint: number }
export interface PhoneTimelineState { playhead: number; selectedIds: string[]; clips: PhoneClip[]; compositionName: string | null }

interface BridgeClipState { id: string; name: string; startTime: number; duration: number; inPoint?: number }
interface BridgeTimelineState {
  playheadPosition: number
  selectedClipIds: string[]
  activeCompositionName: string | null
  videoTracks: Array<{ clips: BridgeClipState[] }>
}

export interface PhoneWorld {
  context: BrowserContext
  page: Page
  bridge: BridgeClient
  touch: PhoneTouch
  probe: PreviewProbe
  baseURL: string
  /** Geometry signature of the freshly built timeline; a reset returns to it. */
  baseSignature: string
  projectName: string
}

export interface PhoneSession extends PhoneWorld {
  /** Fresh read of the main video track (the bridge's view of the timeline store). */
  timeline(): Promise<PhoneTimelineState>
  clip(id: string): Locator
  clips: Locator
  surface: Locator
  playhead: Locator
  toolbar: Locator
}

export const test = base.extend<{ phone: PhoneSession; failureShot: void }, { world: PhoneWorld }>({
  world: [async ({ browser }, provide, workerInfo) => {
    const world = await openPhoneProject(browser, workerInfo)
    await provide(world)
    await world.context.close()
  }, { scope: 'worker', timeout: 300_000 }],

  phone: async ({ world }, provide, testInfo) => {
    await resetPhone(world, testInfo)
    const session: PhoneSession = {
      ...world,
      timeline: () => readTimeline(world.bridge),
      clip: id => world.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${id}"]`),
      clips: world.page.getByTestId(IDS.clip),
      surface: world.page.getByTestId(IDS.timelineSurface),
      playhead: world.page.getByTestId(IDS.playhead),
      toolbar: world.page.getByTestId(IDS.toolbar),
    }
    await provide(session)
    // The built-in screenshot-on-failure only covers Playwright's own `page`; this context is ours.
    if (testInfo.status !== testInfo.expectedStatus) {
      const body = await world.page.screenshot({ timeout: 5_000 }).catch(() => null)
      if (body) await testInfo.attach('phone-failure.png', { body, contentType: 'image/png' })
    }
  },
})

export { expect }

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function openPhoneProject(browser: Browser, workerInfo: WorkerInfo): Promise<PhoneWorld> {
  const use = workerInfo.project.use
  const baseURL = use.baseURL
  if (!baseURL) throw new Error('Playwright baseURL must be configured')
  if (!use.isMobile || !use.hasTouch || !use.viewport) throw new Error(`Project "${workerInfo.project.name}" must emulate a touch phone (viewport, isMobile, hasTouch)`)
  const context = await browser.newContext({
    viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent, acceptDownloads: true,
  })
  const page = await context.newPage()
  const tabId = randomUUID()
  await warmGpu(page, baseURL)
  await installDeterministicStorage(page, tabId)
  await page.goto(new URL('/m', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })

  // A fresh context has no project: the phone home shows (M1). Setup, not under test, so plain clicks.
  const home = page.getByTestId(PHONE_M1_TEST_IDS.home)
  await expect(home, 'the phone home did not appear on a fresh /m').toBeVisible({ timeout: 90_000 })
  const projectName = `Phone ${tabId}`
  const create = page.getByTestId(PHONE_M1_TEST_IDS.createProject)
  if (!await create.isVisible()) await page.getByTestId(PHONE_M1_TEST_IDS.newProject).click()
  await page.getByTestId(PHONE_M1_TEST_IDS.projectNameInput).fill(projectName)
  await create.click()
  await expect(home, 'the home stays on top of the editor').toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })

  const bridge = new BridgeClient({ baseURL, targetTabId: tabId })
  await bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await bridge.authenticate()
  await waitForProjectIdle(page, bridge, 30_000)

  await buildTimeline(bridge, page, `Phone Sammeltest ${tabId.slice(0, 8)}`)
  const touch = await PhoneTouch.attach(page)
  // PreviewProbe finds the canvas through role=region "Preview"; the phone preview is found by its test id instead.
  const probe = new PreviewProbe(page)
  Object.defineProperty(probe, 'canvas', { value: page.getByTestId(IDS.previewRegion).getByTestId(IDS.previewCanvas) })
  const timeline = await readTimeline(bridge)
  return { context, page, bridge, touch, probe, baseURL, baseSignature: signatureOf(timeline.clips), projectName }
}

async function buildTimeline(bridge: BridgeClient, page: Page, composition: string): Promise<void> {
  const clips = []
  // ffmpeg's geq is slow; generate in small batches (the files are cached by their parameters).
  for (let index = 0; index < CLIP_SECONDS.length; index += 4) {
    clips.push(...await Promise.all(CLIP_SECONDS.slice(index, index + 4)
      .map(seconds => frameCodeClip({ width: CLIP_WIDTH, height: CLIP_HEIGHT, fps: FPS, seconds }))))
  }
  const total = CLIP_SECONDS.reduce((sum, seconds) => sum + seconds, 0)
  await bridge.toolData('createComposition', { name: composition, width: CLIP_WIDTH, height: CLIP_HEIGHT, frameRate: FPS, duration: total, open: true })
  await bridge.toolData('importLocalFiles', { paths: clips.map(clip => clip.path.replaceAll('\\', '/')), addToTimeline: true, startTime: 0 }, { timeoutMs: 180_000 })
  await expect.poll(async () => (await readTimeline(bridge)).clips.length, { timeout: 60_000, message: 'the frame-code clips did not all reach the timeline' }).toBe(CLIP_SECONDS.length)
  await waitForProjectIdle(page, bridge, 30_000)
  await expect(page.getByTestId(IDS.clip).first(), 'the phone timeline shows no clip tile after the import').toBeVisible({ timeout: 30_000 })
}

async function waitForProjectIdle(page: Page, bridge: BridgeClient, timeoutMs: number): Promise<void> {
  await expect.poll(async () => {
    const result = await bridge.tool<{ projectLoadProgress?: { active?: boolean; phase?: string } }>('getStats', {}, { timeoutMs: 3_000, fetchTimeoutMs: 5_000 }).catch(() => null)
    const progress = result?.data?.projectLoadProgress
    return Boolean(result?.success && progress?.active === false && (progress.phase === 'idle' || !progress.phase))
  }, { timeout: timeoutMs, message: 'the project did not become idle' }).toBe(true)
  void page
}

export async function installDeterministicStorage(page: Page, tabId: string): Promise<void> {
  const version = (JSON.parse(await readFile(path.join(DEFAULT_REPO_ROOT, 'package.json'), 'utf8')) as { version: string }).version
  await page.addInitScript((seed) => {
    window.sessionStorage.setItem('masterselects.aiBridgeTabId', seed.tabId)
    let persisted: Record<string, unknown> = {}
    try { persisted = JSON.parse(window.localStorage.getItem('masterselects-settings') ?? '{}') as Record<string, unknown> } catch { persisted = {} }
    const previous = (typeof persisted.state === 'object' && persisted.state !== null ? persisted.state : {}) as Record<string, unknown>
    window.localStorage.setItem('masterselects-settings', JSON.stringify({
      ...persisted,
      state: { ...previous, hasSeenTutorial: true, hasSeenTutorialPart2: true, showChangelogOnStartup: false, lastSeenChangelogVersion: seed.version },
      version: typeof persisted.version === 'number' ? persisted.version : 0,
    }))
    // The default profile keeps its project in browser storage; native pickers would block the chooser.
    Reflect.deleteProperty(window, 'showDirectoryPicker')
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  }, { tabId, version })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function readTimeline(bridge: BridgeClient): Promise<PhoneTimelineState> {
  const state = await bridge.toolData<BridgeTimelineState>('getTimelineState')
  const clips = (state.videoTracks[0]?.clips ?? [])
    .map(clip => ({ id: clip.id, name: clip.name, start: clip.startTime, duration: clip.duration, inPoint: clip.inPoint ?? 0 }))
    .toSorted((a, b) => a.start - b.start)
  return { playhead: state.playheadPosition, selectedIds: state.selectedClipIds, clips, compositionName: state.activeCompositionName }
}

/** Geometry only (ids change when a split is undone); millisecond resolution. */
export function signatureOf(clips: PhoneClip[]): string {
  const ms = (seconds: number) => Math.round(seconds * 1000)
  return clips.map(clip => `${ms(clip.start)}+${ms(clip.duration)}@${ms(clip.inPoint)}`).join('|')
}

/**
 * The frame a frame-code clip shows at timeline time `time` (frame k covers
 * [k/fps, (k+1)/fps), the rule preview-truth.spec.ts uses for a paused
 * playhead); `null` outside every clip.
 */
export function expectedFrameAt(clips: PhoneClip[], time: number): { frame: number; clip: PhoneClip } | null {
  const clip = clips.find(item => time >= item.start - 1e-6 && time < item.start + item.duration - 1e-6)
  return clip ? { frame: Math.floor((time - clip.start + clip.inPoint) * FPS + 1e-6), clip } : null
}

/**
 * Waits until the playhead time stopped changing (two reads three animation
 * frames apart agree) and returns the state. A condition, not a sleep: touch
 * gestures end with still moves, so this settles as soon as the app does.
 */
export async function settledTimeline(phone: PhoneSession, timeoutMs = 8_000): Promise<PhoneTimelineState> {
  const deadline = Date.now() + timeoutMs
  let previous = await phone.timeline()
  while (Date.now() < deadline) {
    await phone.touch.nextFrame(3)
    const current = await phone.timeline()
    if (Math.abs(current.playhead - previous.playhead) < 1e-9) return current
    previous = current
  }
  throw new Error(`The playhead kept moving for ${timeoutMs} ms (last ${previous.playhead.toFixed(4)} s)`)
}

/** Centre of the part of `target` that lies inside `container` (a tile may stick out of the surface). */
export async function visibleCentre(target: Locator, container: Locator): Promise<Point> {
  const [box, bounds] = await Promise.all([target.boundingBox(), container.boundingBox()])
  if (!box || !bounds) throw new Error('target or container is not rendered')
  const left = Math.max(box.x, bounds.x), right = Math.min(box.x + box.width, bounds.x + bounds.width)
  const top = Math.max(box.y, bounds.y), bottom = Math.min(box.y + box.height, bounds.y + bounds.height)
  if (right <= left || bottom <= top) throw new Error('target is outside the container')
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

/** The clip row's vertical centre and the surface's horizontal centre: where a finger pans or pinches. */
export async function clipRowPoint(phone: PhoneSession): Promise<Point> {
  const surface = await phone.surface.boundingBox()
  const tile = await phone.clips.first().boundingBox()
  if (!surface || !tile) throw new Error('timeline surface or clip tile is not rendered')
  return { x: surface.x + surface.width / 2, y: tile.y + tile.height / 2 }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Every case starts from the same state: paused, nothing selected, playhead 0,
 * the timeline geometry of the freshly built project (undo back to the base
 * revision; if undo cannot reach it, the clips are re-imported into a new
 * composition), and the preview really showing frame 0. If the preview does not
 * get there, the page is reloaded and the case gets a `reset-reload` note, so one
 * defect never turns its neighbours red.
 */
async function resetPhone(world: PhoneWorld, testInfo: TestInfo): Promise<void> {
  const { bridge, page, probe } = world
  await bridge.toolData('pause')
  await bridge.toolData('clearSelection')
  for (let attempt = 0; attempt < 12 && signatureOf((await readTimeline(bridge)).clips) !== world.baseSignature; attempt++) {
    await bridge.toolData('undo').catch(() => null)
  }
  if (signatureOf((await readTimeline(bridge)).clips) !== world.baseSignature) {
    testInfo.annotations.push({ type: 'reset-rebuild', description: 'undo did not return to the base timeline; clips re-imported into a new composition' })
    await buildTimeline(bridge, page, `Phone Sammeltest ${randomUUID().slice(0, 8)}`)
    world.baseSignature = signatureOf((await readTimeline(bridge)).clips)
  }
  await bridge.toolData('clearSelection')
  await bridge.toolData('setPlayhead', { time: 0 })
  probe.mark()
  try {
    await expect(page.getByTestId(IDS.clip).first()).toBeVisible({ timeout: 5_000 })
    await probe.waitForFrame(0, { allowed: () => true, timeoutMs: 5_000 })
  } catch {
    testInfo.annotations.push({ type: 'reset-reload', description: `frame 0 did not show after the reset, page reloaded. ${probe.summary()}` })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
    await bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
    await bridge.authenticate()
    await waitForProjectIdle(page, bridge, 30_000)
    await bridge.toolData('setPlayhead', { time: 0 })
    probe.mark()
    await probe.waitForFrame(0, { allowed: () => true, timeoutMs: 30_000 })
  }
}
