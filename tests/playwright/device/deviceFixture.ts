import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS, phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { frameIndexAt, PHONE_FOOTAGE_PROFILES, type FootageExpectation, type PhoneFootageProfileId } from '../fixtures/phoneFootageProfiles.ts'
import { visibleCentre } from '../mobile/phoneFixture'
import { PhoneTouch } from '../mobile/phoneTouch'
import { connectDevice, disconnectDevice, type DeviceSession } from './deviceConnection'
import { UI_WAIT_MS, isDeviceProjectName, resolveDeviceEnv } from './deviceEnv'
import { ensureDeviceFootage, isPhoneFootageProfile, type PhoneFootage } from './deviceFootage'
import { DEVICE_TAB_MARKER, sourceSecondsAt, type TimelineSegment } from './deviceParsing'
import { DevicePreviewProbe } from './devicePreview'
import { COMP_FPS, readPlayheadFrame, readTiles, seekToFrame, type TileState } from './deviceTimeline'

/**
 * The real-device world: one worker, one phone, one marked test tab (reused across runs), one test project built through the
 * phone UI and carried from journey to journey (the cases run in order; each one checks the state
 * it starts from and skips with a reason when an earlier case did not get there). Production has no
 * Dev Bridge, so nothing is arranged behind the UI: the page is read from the DOM, the preview
 * pixels and the load telemetry, and every action under test is real touch
 * (`Input.dispatchTouchEvent` through mobile/phoneTouch.ts). Typing a name and stepping the playhead
 * with the timeline's arrow keys are arrangement, not actions under test.
 */
export const IDS = PHONE_TEST_IDS
export const M1_IDS = PHONE_M1_TEST_IDS
export const TOPBAR_EXPORT = 'phone-topbar-export'
export const TOPBAR_PROJECTS = 'phone-topbar-projects'
export const ACTION_MEDIA = phoneActionTestId('media')
export const ACTION_SPLIT = phoneActionTestId('split')
export { UI_WAIT_MS }
export const ACTION_TEXT = phoneActionTestId('text')

/** What the journeys hand on to the next one. */
export interface JourneyState {
  projectName: string | null
  /** Main clip after import (one video tile, starts at 0). */
  clip: TileState | null
  splitFrame: number | null
  /** The footage on the timeline as pieces (video tiles), after the latest edit. */
  segments: TimelineSegment[] | null
  title: { id: string; startFrame: number; durationFrames: number } | null
  /** Every tile before the reload (lane, span, name), for the reopen comparison. */
  signature: string | null
  /** End of all content in timeline frames. */
  endFrame: number | null
}

export interface DeviceWorld extends DeviceSession {
  touch: PhoneTouch
  probe: DevicePreviewProbe
  footage: PhoneFootage
  profileId: PhoneFootageProfileId
  journey: JourneyState
}

export const test = base.extend<{ dev: DeviceWorld }, { world: DeviceWorld }>({
  world: [async ({ browserName: _browserName }, provide) => {
    const env = resolveDeviceEnv()
    if (!isPhoneFootageProfile(env.footageProfile)) {
      throw new Error(`MASTERSELECTS_DEVICE_FOOTAGE_PROFILE "${env.footageProfile}" is unknown; known: ${Object.keys(PHONE_FOOTAGE_PROFILES).join(', ')}`)
    }
    const profileId = env.footageProfile
    // Generated on the PC first (minutes for the long profiles), before the phone is involved.
    const footage = await ensureDeviceFootage(profileId, line => process.stdout.write(`[device footage] ${line}\n`))
    const session = await connectDevice(env)
    const touch = await PhoneTouch.attach(session.page)
    const probe = new DevicePreviewProbe(session.page)
    const journey: JourneyState = { projectName: null, clip: null, splitFrame: null, segments: null, title: null, signature: null, endFrame: null }
    process.stdout.write(`[device] ${session.device.model}, Android ${session.device.android} (SDK ${session.device.sdk}), Chrome ${session.device.chrome}; `
      + `${session.tab === 'reused' ? 'reused its marked test tab' : 'opened a new test tab'}`
      + `${session.parkedTabs ? `, parked ${session.parkedTabs} older harness tab(s) on about:blank` : ''}; `
      + `${session.foreignPages} tab(s) of the owner left untouched; target ${env.baseURL}/m#${DEVICE_TAB_MARKER}\n`)
    try {
      await provide({ ...session, touch, probe, footage, profileId, journey })
    } finally {
      await disconnectDevice(session)
    }
  }, { scope: 'worker', timeout: 1_800_000 }],

  dev: async ({ world }, provide, testInfo) => {
    await world.adb.assertUnlocked()
    await provide(world)
    if (testInfo.status !== testInfo.expectedStatus) await attachFailureEvidence(world, testInfo)
  },
})

export { expect }

async function attachFailureEvidence(world: DeviceWorld, testInfo: TestInfo): Promise<void> {
  const shot = await world.page.screenshot({ timeout: 10_000 }).catch(() => null)
  if (shot) await testInfo.attach('device-failure.png', { body: shot, contentType: 'image/png' })
  const keyguard = await world.adb.keyguardShowing().catch(() => null)
  await testInfo.attach('device-state.json', {
    body: JSON.stringify({ keyguardShowing: keyguard, keepAwake: world.adb.keepAwakeLog.slice(-10), path: new URL(world.page.url()).pathname,
      preview: world.probe.summary() }, null, 2),
    contentType: 'application/json',
  })
}

/** Attaches a JSON record to the case and prints a one-line summary. */
export async function record(testInfo: TestInfo, name: string, body: unknown, line?: string): Promise<void> {
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(body, null, 2), contentType: 'application/json' })
  if (line) {
    testInfo.annotations.push({ type: name, description: line })
    process.stdout.write(`[device] ${name}: ${line}\n`)
  }
}

/** Skips the case with a reason when an earlier case did not produce what it builds on. */
export function needs<T>(value: T | null | undefined, what: string): T {
  test.skip(value === null || value === undefined, `needs ${what} from an earlier case`)
  return value as T
}

// ---------------------------------------------------------------------------
// Touch on locators
// ---------------------------------------------------------------------------

/** How long a tap target and the visual viewport must hold still before the tap is aimed. */
export const TAP_STILL_MS = 250

/**
 * Resolves once `target`'s box and the visual viewport stayed the same for TAP_STILL_MS (page clock).
 * A sheet slides in, and the on-screen keyboard an autofocused field opens lifts it by the keyboard's
 * height a moment later: a tap aimed before that lands where the control was (D5 title, run 16: Done
 * missed, the sheet stayed open). A target that keeps moving fails with that reason.
 */
export async function waitUntilStill(target: Locator, timeoutMs = UI_WAIT_MS): Promise<void> {
  const still = await target.evaluate((element, { stillMs, timeoutMs }) => new Promise<boolean>((resolve) => {
    const started = performance.now()
    let last = '', since = started
    const step = (now: number) => {
      const box = element.getBoundingClientRect(), viewport = window.visualViewport
      const key = [box.x, box.y, box.width, box.height, viewport?.height, viewport?.offsetTop, window.innerHeight].map(value => Math.round(value ?? -1)).join(',')
      if (key !== last) { last = key; since = now }
      if (now - since >= stillMs) resolve(true)
      else if (now - started >= timeoutMs) resolve(false)
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }), { stillMs: TAP_STILL_MS, timeoutMs })
  if (!still) throw new Error(`The tap target kept moving for ${timeoutMs} ms (box or visual viewport changed); refusing to tap where it was`)
}

/**
 * Real touch tap on the visible centre of `target` (inside `within`, default the page body), aimed
 * once the target holds still and sent as one down/up pair (PhoneTouch.tapAtOnce: a DevTools stall
 * cannot turn it into a long press).
 */
export async function tapOn(world: Pick<DeviceWorld, 'touch' | 'page'>, target: Locator, within?: Locator): Promise<void> {
  await expect(target, 'tap target is not visible').toBeVisible({ timeout: 30_000 })
  await target.scrollIntoViewIfNeeded()
  await waitUntilStill(target)
  await world.touch.tapAtOnce(await visibleCentre(target, within ?? world.page.locator('body')))
}

export async function tapTile(world: DeviceWorld, id: string): Promise<void> {
  await tapOn(world, world.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${id}"]`), world.page.getByTestId(IDS.timelineSurface))
}

/** Taps a project row, but only one of a Device test project: the owner's projects are never opened by the harness. */
export async function tapDeviceProjectRow(world: DeviceWorld, name: string): Promise<void> {
  if (!isDeviceProjectName(name)) throw new Error(`Refusing to open "${name}": the harness only opens "Device test" projects`)
  await tapOn(world, world.page.locator(`[data-testid="${M1_IDS.projectRow}"][data-project-name="${name}"]`).first())
}

// ---------------------------------------------------------------------------
// Expectations of the footage
// ---------------------------------------------------------------------------

/** Length of the footage on a 30 fps timeline, in frames (end of the last frame). */
export function footageTimelineFrames(model: FootageExpectation): number {
  return Math.round(model.endTicks / model.profile.timescale * COMP_FPS)
}

/** The frame code a correct player shows at timeline frame `frame` (null in a gap). */
export function expectedFrameAt(model: FootageExpectation, segments: readonly TimelineSegment[], frame: number): number | null {
  const seconds = sourceSecondsAt(segments, frame, COMP_FPS)
  return seconds === null ? null : frameIndexAt(model, seconds)
}

/**
 * A source time is "clear" when no presentation time of the footage lies within 2 ms of it and, for
 * a nominal-grid profile, the last-timestamp rule and the nominal grid agree. Jittered phone
 * timestamps make the frame at an exact grid time depend on the player's rounding policy; the
 * preview cases sample clear frames so that they judge the edit, not that policy (the export case
 * judges every frame and reports the policy differences separately).
 */
export function isClearSource(model: FootageExpectation, seconds: number): boolean {
  const tick = seconds * model.profile.timescale, margin = 0.002 * model.profile.timescale
  if (model.pts.some(pts => Math.abs(pts - tick) < margin)) return false
  const { timing } = model.profile
  if (timing.kind === 'grid') return frameIndexAt(model, seconds) === Math.round(seconds * timing.fps[0] / timing.fps[1])
  return true
}

/** Whether timeline frame `frame` shows a clear source time (gaps count as clear). */
export function isClearFrame(model: FootageExpectation, segments: readonly TimelineSegment[], frame: number): boolean {
  const seconds = sourceSecondsAt(segments, frame, COMP_FPS)
  return seconds === null || isClearSource(model, seconds)
}

/** The nearest clear frame from `frame` in direction `step`, staying inside [min, max]. */
export function clearFrameNear(model: FootageExpectation, segments: readonly TimelineSegment[], frame: number, step: 1 | -1,
  { min = 0, max = Number.MAX_SAFE_INTEGER, limit = 60 }: { min?: number; max?: number; limit?: number } = {}): number {
  for (let offset = 0; offset <= limit; offset++) {
    const candidate = frame + offset * step
    if (candidate < min || candidate > max) break
    if (isClearFrame(model, segments, candidate)) return candidate
  }
  throw new Error(`No clear frame within ${limit} frames of ${frame} (between ${min} and ${max})`)
}

/** The footage pieces on the timeline, from the video tiles of the footage clip (not titles or audio). */
export function segmentsFromTiles(tiles: readonly TileState[], sourceStartSeconds: (tile: TileState) => number): TimelineSegment[] {
  return tiles.filter(tile => tile.lane === 'video').map(tile => ({
    startFrame: tile.startFrame, endFrame: tile.startFrame + tile.durationFrames, sourceStartSeconds: sourceStartSeconds(tile),
  })).toSorted((a, b) => a.startFrame - b.startFrame)
}

// ---------------------------------------------------------------------------
// Tiles across the whole timeline
// ---------------------------------------------------------------------------

/**
 * Every tile of the timeline: tiles exist only around the playhead, so the playhead steps through
 * the content in 3 s strides and the tiles are collected by id. Ends where it started.
 */
export async function readAllTiles(page: Page, endFrame: number): Promise<TileState[]> {
  const start = await readPlayheadFrame(page)
  const found = new Map<string, TileState>()
  for (let frame = 0; ; frame += 90) {
    await seekToFrame(page, Math.min(frame, Math.max(0, endFrame - 1)))
    for (const tile of await readTiles(page)) found.set(tile.id, tile)
    if (frame >= endFrame) break
  }
  await seekToFrame(page, start)
  return [...found.values()].toSorted((a, b) => a.startFrame - b.startFrame || a.lane.localeCompare(b.lane))
}

/** Lane, span and name of every tile: ids may be renewed by a reload, the arrangement may not. */
export function tileSignature(tiles: readonly TileState[]): string {
  return tiles.map(tile => `${tile.lane}:${tile.startFrame}+${tile.durationFrames}:${tile.name}`).join(' | ')
}

/** Waits until the storage status no longer reports pending work (when the status is shown). */
export async function waitForSaved(world: DeviceWorld, timeoutMs = 120_000): Promise<void> {
  const status = world.page.getByTestId(M1_IDS.storageStatus).first()
  if (await status.isVisible().catch(() => false)) {
    await expect(status, 'the project is saved').not.toContainText(/pending|saving|unsaved|fail|error/i, { timeout: timeoutMs })
  }
}
