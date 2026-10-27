import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test as base, type Browser, type BrowserContext, type CDPSession, type Locator, type Page, type TestInfo, type WorkerInfo } from '@playwright/test'
import sharp from 'sharp'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS, phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { BridgeClient, DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { frameCodeClip, type FrameCodeClip } from '../fixtures/frameCodeMedia'
import { warmGpu } from '../fixtures/frameCodeProject'
import { PreviewProbe } from '../fixtures/previewProbe'
import { FPS, signatureOf, visibleCentre } from './phoneFixture'
import { PhoneTouch, type Point } from './phoneTouch'

const run = promisify(execFile)

/**
 * The M1 world: one phone context per worker on plain /m, driven the way a
 * person drives it. Unlike the M0 Sammeltest (phoneFixture.ts), which arranges
 * 20 clips through the Dev Bridge, the M1 project is BUILT THROUGH THE PHONE UI:
 * the project comes from the phone home (format chip, name, Create) and the
 * clips from the media sheet (`setInputFiles` on the hidden file inputs the
 * native picker would fill). The bridge only inspects (timeline state) and
 * arranges what is not under test (playhead, a clean composition).
 *
 * Per-test reset (decision): a UI-built project has no "base revision" worth
 * undoing to, and a fresh project per test would cost a project boot each. So
 * every test gets a NEW EMPTY COMPOSITION of the phone project (1080x1920, 30 fps,
 * opened through the bridge's `createComposition`), playhead 0, nothing selected,
 * no sheet open. Imports and edits of the previous test stay behind in their own
 * composition and cannot leak into this one. A test that left the editor broken
 * (page reloaded, home showing) is recovered by `ensureEditor`.
 */
export const IDS = PHONE_TEST_IDS
export const M1_IDS = PHONE_M1_TEST_IDS
export { FPS }
export const CLIP_WIDTH = 360
export const CLIP_HEIGHT = 640
export const COMP_WIDTH = 1080
export const COMP_HEIGHT = 1920

/** Not in contracts.ts: the top bar buttons the shell already names this way (shell/PhoneTopBar.tsx). */
export const TOPBAR_EXPORT = 'phone-topbar-export'
export const TOPBAR_PROJECTS = 'phone-topbar-projects'
/** Clip toolbar commands (action ids of actions/phoneActionCatalog.ts, selectors through phoneActionTestId). */
export const ACTION_DELETE = phoneActionTestId('delete')
export const ACTION_RIPPLE_DELETE = phoneActionTestId('ripple-delete')
export const ACTION_SPLIT = phoneActionTestId('split')
export const ACTION_TEXT = phoneActionTestId('text')
export const ACTION_MEDIA = phoneActionTestId('media')

// ---------------------------------------------------------------------------
// Generated media
// ---------------------------------------------------------------------------

export interface M1Media {
  /** 4 s, frames 0..119. */
  a: FrameCodeClip
  /** 3 s, frames 0..89. */
  b: FrameCodeClip
  /** 1 s, frames 0..29. */
  short: FrameCodeClip
  image: string
  audio: string
}

const MEDIA_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

/** File-name fragments that identify the frame-code clips in clip names (`...-120f-h264.mp4`). */
export const A_TAG = '-120f-'
export const B_TAG = '-90f-'

export async function generateM1Media(): Promise<M1Media> {
  const [a, b, short] = await Promise.all([4, 3, 1].map(seconds => frameCodeClip({ width: CLIP_WIDTH, height: CLIP_HEIGHT, fps: FPS, seconds })))
  await mkdir(MEDIA_DIR, { recursive: true })
  const image = path.join(MEDIA_DIR, 'm1-image-v1.png')
  if (!await access(image).then(() => true, () => false)) {
    const temporary = `${image}.${process.pid}.tmp`
    await sharp({ create: { width: CLIP_WIDTH, height: CLIP_HEIGHT, channels: 3, background: { r: 230, g: 120, b: 30 } } }).png().toFile(temporary)
    await rename(temporary, image)
  }
  const audio = path.join(MEDIA_DIR, 'm1-tone-v1.wav')
  if (!await access(audio).then(() => true, () => false)) {
    const temporary = `${audio}.${process.pid}.tmp.wav`
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-ac', '2', temporary])
    await rename(temporary, audio)
  }
  return { a, b, short, image, audio }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface M1Clip {
  id: string
  name: string
  start: number
  duration: number
  inPoint: number
  trackId: string
  trackType: 'video' | 'audio'
  sourceType?: string
}

export interface M1Timeline {
  playhead: number
  selectedIds: string[]
  activeCompositionId: string | null
  /** Every clip of every track, sorted by start. */
  all: M1Clip[]
  /** Frame-code (video source) clips on video tracks, sorted by start: the main track content. */
  main: M1Clip[]
}

interface BridgeClip { id: string; name: string; startTime: number; duration: number; inPoint?: number; sourceType?: string }
interface BridgeTrack { id: string; type: string; clips: BridgeClip[] }
interface BridgeTimeline {
  playheadPosition: number
  selectedClipIds: string[]
  activeCompositionId: string | null
  videoTracks: BridgeTrack[]
  audioTracks: BridgeTrack[]
}

export async function readM1Timeline(bridge: BridgeClient): Promise<M1Timeline> {
  const state = await bridge.toolData<BridgeTimeline>('getTimelineState')
  const convert = (track: BridgeTrack, trackType: 'video' | 'audio'): M1Clip[] => track.clips.map(clip => ({
    id: clip.id, name: clip.name, start: clip.startTime, duration: clip.duration, inPoint: clip.inPoint ?? 0,
    trackId: track.id, trackType, sourceType: clip.sourceType,
  }))
  const all = [...state.videoTracks.flatMap(track => convert(track, 'video')), ...state.audioTracks.flatMap(track => convert(track, 'audio'))]
    .toSorted((x, y) => x.start - y.start)
  const main = all.filter(clip => clip.trackType === 'video' && clip.sourceType === 'video')
  return { playhead: state.playheadPosition, selectedIds: state.selectedClipIds, activeCompositionId: state.activeCompositionId, all, main }
}

export { signatureOf }

/** The frame a frame-code clip shows at timeline time `time` (same rule as phoneFixture.expectedFrameAt). */
export function frameAt(clips: M1Clip[], time: number): { frame: number; clip: M1Clip } | null {
  const clip = clips.find(item => time >= item.start - 1e-6 && time < item.start + item.duration - 1e-6)
  return clip ? { frame: Math.floor((time - clip.start + clip.inPoint) * FPS + 1e-6), clip } : null
}

export interface M1World {
  context: BrowserContext
  page: Page
  bridge: BridgeClient
  touch: PhoneTouch
  cdp: CDPSession
  probe: PreviewProbe
  baseURL: string
  tabId: string
  media: M1Media
  /** Set once the project exists (created through the home); null while the home is still showing. */
  projectName: string | null
  compositionCounter: number
}

export interface M1Session extends M1World {
  timeline(): Promise<M1Timeline>
  surface: Locator
  toolbar: Locator
  playhead: Locator
  clips: Locator
  clip(id: string): Locator
  sheet: Locator
}

export const test = base.extend<{ m1: M1Session }, { world: M1World }>({
  world: [async ({ browser }, provide, workerInfo) => {
    const world = await openPhoneHome(browser, workerInfo)
    await provide(world)
    await world.context.close()
  }, { scope: 'worker', timeout: 300_000 }],

  m1: async ({ world }, provide, testInfo) => {
    await ensureEditor(world)
    await resetEditor(world, testInfo)
    const session: M1Session = {
      ...world,
      get projectName() { return world.projectName },
      timeline: () => readM1Timeline(world.bridge),
      surface: world.page.getByTestId(IDS.timelineSurface),
      toolbar: world.page.getByTestId(IDS.toolbar),
      playhead: world.page.getByTestId(IDS.playhead),
      clips: world.page.getByTestId(IDS.clip),
      clip: id => world.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${id}"]`),
      sheet: world.page.getByTestId(IDS.sheet),
    }
    await provide(session)
    if (testInfo.status !== testInfo.expectedStatus) {
      const body = await world.page.screenshot({ timeout: 5_000 }).catch(() => null)
      if (body) await testInfo.attach('phone-failure.png', { body, contentType: 'image/png' })
    }
  },
})

export { expect }

// ---------------------------------------------------------------------------
// Build: a fresh phone context on /m that shows the home
// ---------------------------------------------------------------------------

async function openPhoneHome(browser: Browser, workerInfo: WorkerInfo): Promise<M1World> {
  const use = workerInfo.project.use
  const baseURL = use.baseURL
  if (!baseURL) throw new Error('Playwright baseURL must be configured')
  if (!use.isMobile || !use.hasTouch || !use.viewport) throw new Error(`Project "${workerInfo.project.name}" must emulate a touch phone (viewport, isMobile, hasTouch)`)
  const media = await generateM1Media()
  const context = await browser.newContext({
    viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent, acceptDownloads: true,
  })
  const page = await context.newPage()
  const tabId = randomUUID()
  await warmGpu(page, baseURL)
  await installDeterministicStorage(page, tabId)
  await page.goto(new URL('/m', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByTestId(M1_IDS.home), 'the phone home did not appear on a fresh /m').toBeVisible({ timeout: 90_000 })
  const bridge = new BridgeClient({ baseURL, targetTabId: tabId })
  const touch = await PhoneTouch.attach(page)
  const cdp = await context.newCDPSession(page)
  const probe = new PreviewProbe(page)
  Object.defineProperty(probe, 'canvas', { value: page.getByTestId(IDS.previewRegion).getByTestId(IDS.previewCanvas) })
  return { context, page, bridge, touch, cdp, probe, baseURL, tabId, media, projectName: null, compositionCounter: 0 }
}

async function installDeterministicStorage(page: Page, tabId: string): Promise<void> {
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
    // The default profile keeps its project in browser storage; native pickers would block the flow.
    Reflect.deleteProperty(window, 'showDirectoryPicker')
    Reflect.deleteProperty(window, 'showSaveFilePicker')
    Reflect.deleteProperty(window, 'showOpenFilePicker')
  }, { tabId, version })
}

// ---------------------------------------------------------------------------
// Touch on locators
// ---------------------------------------------------------------------------

/** Real touch tap on the visible centre of `target`. */
export async function tapOn(world: Pick<M1World, 'touch' | 'page'>, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  await world.touch.tap(await visibleCentre(target, world.page.locator('body')))
}

export async function tapAction(world: Pick<M1World, 'touch' | 'page'>, actionTestId: string): Promise<void> {
  await tapOn(world, world.page.getByTestId(actionTestId))
}

/** Tap a clip tile at the visible part of it inside the timeline surface. */
export async function tapClip(m1: M1Session, clipId: string): Promise<void> {
  await expect(m1.clip(clipId), `no tile for clip ${clipId}`).toBeVisible()
  await m1.touch.tap(await visibleCentre(m1.clip(clipId), m1.surface))
}

/**
 * Press and hold on `from` until the long-press is recognised, then drag to
 * `to` and release. The hold is counted in animation frames (no timers): a
 * long-press is time by definition, and `holdFrames` frames (about 0.8 s at 60 Hz)
 * exceed every sensible threshold. Moves are one per frame like phoneTouch.pan.
 */
export async function longPressDrag(world: Pick<M1World, 'cdp' | 'touch'>, from: Point, to: Point, { holdFrames = 50, steps = 16, still = 3 }: { holdFrames?: number; steps?: number; still?: number } = {}): Promise<void> {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) => world.cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(point => ({ ...point, id: 0, radiusX: 1, radiusY: 1, force: 1 })),
  })
  await send('touchStart', [from])
  await world.touch.nextFrame(holdFrames)
  for (let step = 1; step <= steps; step++) {
    await send('touchMove', [{ x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }])
    await world.touch.nextFrame()
  }
  for (let index = 0; index < still; index++) {
    await send('touchMove', [to])
    await world.touch.nextFrame()
  }
  await send('touchEnd', [])
  await world.touch.nextFrame(2)
}

// ---------------------------------------------------------------------------
// Home, project, media: the phone UI flows the tests build on
// ---------------------------------------------------------------------------

/** New project from the phone home: format chip, name, Create. Resolves when the editor shell shows. */
export async function createProjectViaHome(world: M1World, { name, format }: { name: string; format: '9:16' | '16:9' | '1:1' | '4:5' }): Promise<void> {
  const { page } = world
  const createButton = page.getByTestId(M1_IDS.createProject)
  if (!await createButton.isVisible()) await tapOn(world, page.getByTestId(M1_IDS.newProject))
  await expect(createButton, 'the new-project form did not open').toBeVisible()
  const chip = page.locator(`[data-testid^="${M1_IDS.formatChip}"]`, { hasText: format })
  await expect(chip, `no format chip for ${format}`).toHaveCount(1)
  await tapOn(world, chip)
  await page.getByTestId(M1_IDS.projectNameInput).fill(name)
  await tapOn(world, createButton)
  await expect(page.getByTestId(IDS.root), 'the phone shell did not open after Create').toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(M1_IDS.home), 'the home stays on top of the editor').toHaveCount(0)
  world.projectName = name
  await world.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await world.bridge.authenticate()
  await waitForIdle(world)
}

export async function waitForIdle(world: Pick<M1World, 'bridge'>, timeoutMs = 30_000): Promise<void> {
  await expect.poll(async () => {
    const result = await world.bridge.tool<{ projectLoadProgress?: { active?: boolean; phase?: string } }>('getStats', {}, { timeoutMs: 3_000, fetchTimeoutMs: 5_000 }).catch(() => null)
    const progress = result?.data?.projectLoadProgress
    return Boolean(result?.success && progress?.active === false && (progress.phase === 'idle' || !progress.phase))
  }, { timeout: timeoutMs, message: 'the project did not become idle' }).toBe(true)
}

/**
 * Media sheet: Media tool -> hidden visual input (one `setInputFiles` per pick,
 * so the pick order is the order of the calls) -> optional audio input -> Done.
 * Resolves when the sheet is closed and `expectedClips` clips of the main
 * content (or `expectedTotal` clips overall) are on the timeline.
 */
export async function importViaSheet(m1: M1Session, picks: { visual?: string[]; audio?: string[] }, expected: { main?: number; total: number }): Promise<M1Timeline> {
  const { page } = m1
  await tapAction(m1, ACTION_MEDIA)
  await expect(m1.sheet, 'the media sheet did not open').toBeVisible()
  let shown = 0
  for (const file of picks.visual ?? []) {
    await page.getByTestId(M1_IDS.mediaInputVisual).setInputFiles(file)
    shown++
    await expect(page.getByTestId(M1_IDS.mediaPickedItem), `the media sheet lists ${shown} picked files`).toHaveCount(shown)
  }
  for (const file of picks.audio ?? []) {
    await page.getByTestId(M1_IDS.mediaInputAudio).setInputFiles(file)
    shown++
    await expect(page.getByTestId(M1_IDS.mediaPickedItem), `the media sheet lists ${shown} picked files`).toHaveCount(shown)
  }
  await tapOn(m1, page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the media sheet stayed open after Done').toBeHidden({ timeout: 30_000 })
  let state = await m1.timeline()
  await expect.poll(async () => { state = await m1.timeline(); return state.all.length }, {
    timeout: 60_000, message: `the imported files did not all reach the timeline (expected ${expected.total} clips)`,
  }).toBe(expected.total)
  if (expected.main !== undefined) expect(state.main.length, 'frame-code clips on the video track').toBe(expected.main)
  await waitForIdle(m1)
  return state
}

/** Vertical centre of the clip row and horizontal centre of the surface: where a finger scrubs. */
export async function rowPoint(m1: M1Session): Promise<Point> {
  const surface = await m1.surface.boundingBox()
  const tile = await m1.clips.first().boundingBox()
  if (!surface || !tile) throw new Error('timeline surface or clip tile is not rendered')
  return { x: surface.x + surface.width / 2, y: tile.y + tile.height / 2 }
}

/** Moves the playhead through the bridge (arrangement) and waits until the store reports it. */
export async function seek(m1: M1Session, time: number): Promise<void> {
  await m1.bridge.toolData('setPlayhead', { time })
  await expect.poll(async () => (await m1.timeline()).playhead, { message: `playhead did not reach ${time}` }).toBeCloseTo(time, 4)
}

/** Waits until the playhead stopped changing (two reads three frames apart agree). */
export async function settled(m1: M1Session, timeoutMs = 8_000): Promise<M1Timeline> {
  const deadline = Date.now() + timeoutMs
  let previous = await m1.timeline()
  while (Date.now() < deadline) {
    await m1.touch.nextFrame(3)
    const current = await m1.timeline()
    if (Math.abs(current.playhead - previous.playhead) < 1e-9) return current
    previous = current
  }
  throw new Error(`The playhead kept moving for ${timeoutMs} ms (last ${previous.playhead.toFixed(4)} s)`)
}

/** Reads the preview canvas pixels as RGB (CSS-pixel scale), for pixel differences. */
export async function previewPixels(probe: PreviewProbe): Promise<{ width: number; height: number; data: Buffer }> {
  const png = await probe.canvas.screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: 5_000 })
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/** Share of pixels below the frame-code band (top 20 %) whose channels differ by more than `threshold`. */
export function differingShare(before: { width: number; height: number; data: Buffer }, after: { width: number; height: number; data: Buffer }, threshold = 40): number {
  if (before.width !== after.width || before.height !== after.height) return 1
  const first = Math.floor(before.height * 0.2) * before.width
  const total = before.width * before.height - first
  let different = 0
  for (let pixel = first; pixel < before.width * before.height; pixel++) {
    const offset = pixel * 3
    if (Math.max(Math.abs(before.data[offset] - after.data[offset]), Math.abs(before.data[offset + 1] - after.data[offset + 1]),
      Math.abs(before.data[offset + 2] - after.data[offset + 2])) > threshold) different++
  }
  return different / total
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/** Opens the export sheet, taps Export and resolves when Save/Share are usable (file ready). */
export async function exportToReady(m1: M1Session, timeoutMs = 240_000): Promise<void> {
  const { page } = m1
  await tapOn(m1, page.getByTestId(TOPBAR_EXPORT))
  await expect(m1.sheet, 'the export sheet did not open').toBeVisible()
  await expect(page.getByTestId(M1_IDS.exportSummary)).toContainText(/\d/)
  await tapOn(m1, page.getByTestId(M1_IDS.exportStart))
  await expect(page.getByTestId(M1_IDS.exportSave), 'the export never finished').toHaveAttribute('aria-disabled', 'false', { timeout: timeoutMs })
}

/** Taps `target` and returns the download it triggers, saved under the test's output directory. */
export async function tapForDownload(m1: M1Session, target: Locator, testInfo: TestInfo, name: string): Promise<{ file: string; suggested: string }> {
  const [download] = await Promise.all([m1.page.waitForEvent('download', { timeout: 30_000 }), tapOn(m1, target)])
  const file = testInfo.outputPath(`${name}${path.extname(download.suggestedFilename()) || '.mp4'}`)
  await download.saveAs(file)
  return { file, suggested: download.suggestedFilename() }
}

export async function probeVideo(file: string): Promise<{ width: number; height: number; duration: number; frames: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', file])
  const parsed = JSON.parse(stdout) as { streams: Array<{ width: number; height: number; nb_read_frames?: string }>; format: { duration?: string } }
  const stream = parsed.streams[0]
  return { width: stream.width, height: stream.height, duration: Number(parsed.format.duration ?? 0), frames: Number(stream.nb_read_frames ?? 0) }
}

// ---------------------------------------------------------------------------
// Reset / recovery
// ---------------------------------------------------------------------------

/** Makes sure the editor shell shows: creates the project on the first call, reopens it from the home otherwise. */
export async function ensureEditor(world: M1World): Promise<void> {
  const { page } = world
  const root = page.getByTestId(IDS.root)
  const home = page.getByTestId(M1_IDS.home)
  await expect(root.or(home).first(), 'neither the phone shell nor the home shows').toBeVisible({ timeout: 90_000 })
  if (await root.isVisible() && !await home.isVisible()) return
  if (world.projectName === null) {
    await createProjectViaHome(world, { name: `Phone M1 ${world.tabId.slice(0, 8)}`, format: '9:16' })
    return
  }
  await tapOn(world, page.getByTestId(M1_IDS.projectRow).filter({ hasText: world.projectName }).first())
  await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
  await world.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await world.bridge.authenticate()
  await waitForIdle(world)
}

async function resetEditor(world: M1World, testInfo: TestInfo): Promise<void> {
  const { page, bridge, probe } = world
  // A sheet left open by the previous case is closed the way a person does it.
  const sheet = page.getByTestId(IDS.sheet)
  if (await sheet.isVisible()) {
    testInfo.annotations.push({ type: 'reset-sheet', description: 'a sheet was still open and was cancelled' })
    await tapOn(world, page.getByTestId(IDS.sheetCancel))
    await expect(sheet).toBeHidden({ timeout: 10_000 })
  }
  // A leftover "not yet" notice is modal: its backdrop would swallow the next case's first tap.
  const notice = page.getByTestId(IDS.unavailableNotice)
  if (await notice.isVisible()) {
    testInfo.annotations.push({ type: 'reset-notice', description: 'an unavailable notice was still open and was closed' })
    await tapOn(world, notice.getByRole('button', { name: 'OK' }))
    await expect(notice).toBeHidden({ timeout: 10_000 })
  }
  await bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await bridge.toolData('pause')
  await bridge.toolData('clearSelection')
  world.compositionCounter++
  const before = (await readM1Timeline(bridge)).activeCompositionId
  await bridge.toolData('createComposition', {
    name: `M1 case ${world.compositionCounter} ${randomUUID().slice(0, 4)}`, width: COMP_WIDTH, height: COMP_HEIGHT, frameRate: FPS, duration: 60,
  })
  await expect.poll(async () => (await readM1Timeline(bridge)).activeCompositionId, { message: 'the fresh composition did not open' }).not.toBe(before)
  await expect.poll(async () => (await readM1Timeline(bridge)).all.length, { message: 'the fresh composition is not empty' }).toBe(0)
  await bridge.toolData('setPlayhead', { time: 0 })
  await waitForIdle(world)
  probe.mark()
}
