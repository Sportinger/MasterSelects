import type { Locator, Page } from '@playwright/test'
import { UI_WAIT_MS } from './deviceEnv'
import { PHONE_TEST_IDS as IDS } from '../../../src/components/mobileSkin/contracts'
import type { PreviewProbe } from '../fixtures/previewProbe'
import { parseClipLabel, parsePhoneTimeFrames } from './deviceParsing'

/**
 * What the phone shows, read from the page itself: production has no Dev Bridge, so the journeys
 * read the clip tiles (data-clip-id, data-track-id, aria-selected and the accessible name "…, starts
 * at 1.50 s, 2.00 s long"), the transport time ("mm:ss.ff", frame exact) and the preview pixels.
 * Tiles exist only for clips inside the rendered time window; keep the playhead near the clips you
 * read, or read at several positions.
 */

/** New phone projects are 30 fps (usePhoneProjectCommands.ts, PHONE_PROJECT_FRAME_RATE). */
export const COMP_FPS = 30

export interface TileState {
  id: string
  trackId: string
  /** phone-clip--video | --audio | --other (text and other generated clips sit on video tracks too). */
  lane: string
  selected: boolean
  name: string
  startFrame: number
  durationFrames: number
}

export async function readTiles(page: Page, fps = COMP_FPS): Promise<TileState[]> {
  const raw = await page.locator(`[data-testid="${IDS.clip}"]`).evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-clip-id') ?? '',
    trackId: node.getAttribute('data-track-id') ?? '',
    lane: /phone-clip--(video|audio|other)/.exec(node.className)?.[1] ?? 'unknown',
    selected: node.getAttribute('aria-selected') === 'true',
    label: node.getAttribute('aria-label') ?? '',
  })))
  return raw.flatMap(tile => {
    const label = parseClipLabel(tile.label)
    if (!label) return []
    return [{ id: tile.id, trackId: tile.trackId, lane: tile.lane, selected: tile.selected, name: label.name,
      startFrame: Math.round(label.start * fps), durationFrames: Math.round(label.duration * fps) }]
  }).toSorted((a, b) => a.startFrame - b.startFrame)
}

export function tile(page: Page, id: string): Locator {
  return page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${id}"]`)
}

/** The playhead as a frame number, from the transport time. */
export async function readPlayheadFrame(page: Page, fps = COMP_FPS): Promise<number> {
  const text = await page.getByTestId(IDS.time).locator('.phone-transport__now').textContent({ timeout: UI_WAIT_MS })
  const frame = parsePhoneTimeFrames(text ?? '', fps)
  if (frame === null) throw new Error(`The transport time "${text}" is not mm:ss.ff`)
  return frame
}

/**
 * Puts the playhead on `frame` exactly: the timeline's own keyboard stepping (Shift+Arrow = 10
 * frames, Arrow = 1 frame, usePhoneTimelineNavigation), then waits until the transport shows it.
 * This is arrangement, not the action under test; the phone keeps no hidden fractional position
 * because every step snaps to the frame grid (stepTimeByFrames).
 */
export async function seekToFrame(page: Page, frame: number, { fps = COMP_FPS, timeoutMs = 20_000 } = {}): Promise<void> {
  const surface = page.getByTestId(IDS.timelineSurface)
  const deadline = Date.now() + timeoutMs
  for (let round = 0; round < 4; round++) {
    const current = await readPlayheadFrame(page, fps)
    const delta = frame - current
    if (delta === 0) return
    await surface.focus()
    const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft'
    for (let index = 0; index < Math.floor(Math.abs(delta) / 10); index++) await page.keyboard.press(`Shift+${key}`)
    for (let index = 0; index < Math.abs(delta) % 10; index++) await page.keyboard.press(key)
    while (Date.now() < deadline) {
      const now = await readPlayheadFrame(page, fps)
      if (now === frame) return
      if (Math.sign(frame - now) !== Math.sign(delta)) break
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      if (now === await readPlayheadFrame(page, fps)) break
    }
  }
  const landed = await readPlayheadFrame(page, fps)
  if (landed !== frame) throw new Error(`The playhead stopped at frame ${landed}, not ${frame} (end of the content?)`)
}

/**
 * Seeks to timeline frame `frame` and waits until the preview shows `expected` there (a frame code,
 * or null for nothing: a gap shows a flat picture), on two consecutive reads. Only the frame shown
 * before the seek (`previous`) and the pictures of the timeline frames the seek stepped through
 * (`passed`, see seekPathPictures: strictly between start and target, none on a cut) may appear on the
 * way; any other valid frame fails at once, because
 * the preview then showed a wrong picture (the Vorschau-Wahrheit rule, fixtures/previewProbe.ts).
 * Waiting for a known frame matters on a phone: a seek into long-GOP footage can keep the old
 * frame on screen for several reads, so "two equal reads" alone would accept a stale picture.
 */
export async function expectContentAt(page: Page, probe: PreviewProbe, frame: number, expected: number | null,
  { previous = null, passed = new Set<number>(), timeoutMs = UI_WAIT_MS }:
  { previous?: number | null; passed?: ReadonlySet<number>; timeoutMs?: number } = {}): Promise<void> {
  await seekToFrame(page, frame)
  probe.mark()
  // The keyboard seek steps through the frames between start and target; a phone decoder may still show
  // the picture of the last step it finished (`passed`) for a moment. Any picture the edit does not put on
  // that path is still a wrong frame and fails at once.
  const onTheWay = (shown: number) => shown === previous || passed.has(shown)
  if (expected !== null) {
    await probe.waitForFrame(expected, { timeoutMs, allowed: onTheWay })
      .catch((error: Error) => { throw new Error(`Timeline frame ${frame}: ${error.message}`) })
    return
  }
  const deadline = Date.now() + timeoutMs
  let streak = 0
  while (Date.now() < deadline) {
    const { reading, observation } = await probe.read()
    if (!reading.valid && reading.reason === 'flat') {
      if (++streak >= 2) return
      continue
    }
    streak = 0
    if (reading.valid && !onTheWay(reading.frame!)) {
      throw new Error(`Timeline frame ${frame} should show nothing (a gap), but the preview showed frame ${reading.frame} at ${observation.at} ms. ${probe.summary()}`)
    }
  }
  throw new Error(`Timeline frame ${frame} should show nothing (a gap); the preview did not go flat within ${timeoutMs} ms. ${probe.summary()}`)
}
