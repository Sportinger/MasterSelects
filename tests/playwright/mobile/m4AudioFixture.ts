import { expect, type Locator, type Page } from '@playwright/test'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { IDS, M1_IDS, tapOn, type M1Session } from './m1Fixture'
import type { Point } from './phoneTouch'

/**
 * Helpers of the M4 audio editors journeys (m4-mixer.spec.ts, m4-pianoroll.spec.ts): the M1
 * phone world (one project, a fresh empty composition per case) turned to landscape, the editors
 * sheet, real two-finger gestures on any axis, and an in-page probe that reads the timeline store
 * the phone UI writes (same module instance, imported from the Vite dev server).
 */

/** Turns the phone emulation to landscape (the viewport's long side becomes its width). */
export async function landscape(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (!size) throw new Error('the page has no viewport')
  if (size.width < size.height) await page.setViewportSize({ width: size.height, height: size.width })
  await expect.poll(() => page.evaluate(() => window.matchMedia('(orientation: landscape)').matches), { message: 'the viewport did not turn to landscape' }).toBe(true)
}

export async function portrait(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (size && size.width > size.height) await page.setViewportSize({ width: size.height, height: size.width })
}

/** Closes a landscape editor a previous case left open, with its Back button. */
export async function closeWorkspaceIfOpen(m1: M1Session): Promise<void> {
  const root = m1.page.getByTestId(WS.root)
  if (await root.isVisible()) {
    await tapOn(m1, m1.page.getByTestId(WS.back))
    await expect(root).toBeHidden()
  }
}

/** Root toolbar "Editors" -> the editor's row; resolves when the editor is full screen. */
export async function openEditor(m1: M1Session, id: string): Promise<Locator> {
  await closeWorkspaceIfOpen(m1)
  await m1.bridge.toolData('clearSelection')
  await expect(m1.toolbar).toHaveAttribute('data-scope', 'root')
  const action = m1.page.getByTestId(phoneActionTestId('editors'))
  await expect(action, 'the root toolbar has no Editors action').toHaveCount(1)
  await tapOn(m1, action)
  await expect(m1.sheet, 'the editors sheet did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${WS.editorRow}-${id}`))
  const root = m1.page.getByTestId(WS.root)
  await expect(root, `the ${id} editor did not open`).toBeVisible()
  await expect(root).toHaveAttribute('data-workspace', id)
  await expect(m1.sheet).toBeHidden()
  return root
}

/** Collapses or expands one side with its toggle and checks the panel and the main area. */
export async function setSide(m1: M1Session, side: 'left' | 'right', open: boolean): Promise<void> {
  const panel = m1.page.getByTestId(side === 'left' ? WS.sideLeft : WS.sideRight)
  const toggle = m1.page.getByTestId(side === 'left' ? WS.toggleLeft : WS.toggleRight)
  if (await panel.isVisible() !== open) await tapOn(m1, toggle)
  await expect(panel).toBeVisible({ visible: open })
  await expect(toggle).toHaveAttribute('aria-pressed', String(open))
}

/** Reload /m and come back to the same project (the home lists it under recent projects). */
export async function reloadIntoProject(m1: M1Session): Promise<void> {
  const { page } = m1
  await page.reload({ waitUntil: 'domcontentloaded' })
  const home = page.getByTestId(M1_IDS.home)
  const root = page.getByTestId(IDS.root)
  await expect(home.or(root).first()).toBeVisible({ timeout: 90_000 })
  if (await home.isVisible()) {
    await tapOn(m1, page.getByTestId(M1_IDS.projectRow).filter({ hasText: m1.projectName! }).first())
  }
  await expect(page.getByTestId(IDS.timeline)).toBeVisible({ timeout: 60_000 })
  await m1.bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await m1.bridge.authenticate()
}

// ---------------------------------------------------------------------------
// Touch on any axis
// ---------------------------------------------------------------------------

async function touchSend(m1: M1Session, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<Point & { id: number }>): Promise<void> {
  await m1.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })) })
}

/**
 * Two fingers around `center`, `startGap` apart along `axis`, moved to `endGap` while the pair's
 * midpoint travels by `pan`. One move per animation frame, a few still moves at the end.
 */
export async function twoFinger(m1: M1Session, center: Point, { axis, startGap, endGap, pan = { x: 0, y: 0 }, steps = 12 }: {
  axis: 'x' | 'y'; startGap: number; endGap: number; pan?: Point; steps?: number
}): Promise<void> {
  const fingers = (gap: number, t: number): Array<Point & { id: number }> => {
    const cx = center.x + pan.x * t, cy = center.y + pan.y * t
    return axis === 'x'
      ? [{ x: cx - gap / 2, y: cy, id: 0 }, { x: cx + gap / 2, y: cy, id: 1 }]
      : [{ x: cx, y: cy - gap / 2, id: 0 }, { x: cx, y: cy + gap / 2, id: 1 }]
  }
  await touchSend(m1, 'touchStart', fingers(startGap, 0))
  await m1.touch.nextFrame()
  for (let step = 1; step <= steps; step++) {
    await touchSend(m1, 'touchMove', fingers(startGap + (endGap - startGap) * step / steps, step / steps))
    await m1.touch.nextFrame()
  }
  for (let index = 0; index < 3; index++) {
    await touchSend(m1, 'touchMove', fingers(endGap, 1))
    await m1.touch.nextFrame()
  }
  await touchSend(m1, 'touchEnd', [])
  await m1.touch.nextFrame(2)
}

export async function boxOf(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox()
  if (!box) throw new Error('the element is not rendered')
  return box
}

export function centreOf(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// ---------------------------------------------------------------------------
// In-page store probe
// ---------------------------------------------------------------------------

const PROBE_SOURCE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { hasOpenEditorGestures } from '/src/services/project/repository/transaction/editorGestureOwnership.ts';
import { getEditorRepositorySession } from '/src/services/project/repository/transaction/editorMutationRuntime.ts';
window.__phoneM4AudioProbe = {
  // Diagnostics: label/source of the latest local revisions, newest first.
  recentRevisions() {
    const coordinator = getEditorRepositorySession()?.coordinator;
    const chain = [];
    let cursor = coordinator?.getStatus().revisionId;
    while (cursor && chain.length < 6 && coordinator.localRevisions?.get(cursor)) {
      const revision = coordinator.localRevisions.get(cursor);
      chain.push(revision.label + '/' + revision.source);
      cursor = revision.parentRevisionId;
    }
    return chain;
  },
  openGestures() {
    return hasOpenEditorGestures();
  },
  tracks() {
    return useTimelineStore.getState().tracks.map(track => ({
      id: track.id, name: track.name, type: track.type,
      volumeDb: track.audioState?.volumeDb ?? 0, pan: track.audioState?.pan ?? 0,
      muted: track.audioState?.muted === true || track.muted === true, solo: track.audioState?.solo === true || track.solo === true,
      recordArm: track.audioState?.recordArm === true, sends: (track.audioState?.sends ?? []).length,
    }));
  },
  master() {
    const master = useTimelineStore.getState().masterAudioState;
    return { volumeDb: master?.volumeDb ?? 0 };
  },
  notes(clipId) {
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    return clip ? (clip.midiData?.notes ?? []).map(note => ({ id: note.id, pitch: note.pitch, start: note.start, duration: note.duration }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch) : null;
  },
  midiClips() {
    return useTimelineStore.getState().clips.filter(clip => clip.source?.type === 'midi').map(clip => ({ id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration }));
  },
  selected() {
    return [...useTimelineStore.getState().selectedClipIds];
  },
};
`

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneM4AudioProbe?: unknown }).__phoneM4AudioProbe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneM4AudioProbe?: unknown }).__phoneM4AudioProbe), undefined, { timeout: 30_000 })
}

export interface ProbeTrack { id: string; name: string; type: string; volumeDb: number; pan: number; muted: boolean; solo: boolean; recordArm: boolean; sends: number }
export interface ProbeNote { id: string; pitch: number; start: number; duration: number }

type ProbeApi = {
  recentRevisions(): string[]
  openGestures(): boolean
  tracks(): ProbeTrack[]
  master(): { volumeDb: number }
  notes(clipId: string): ProbeNote[] | null
  midiClips(): Array<{ id: string; trackId: string; startTime: number; duration: number }>
  selected(): string[]
}

async function probe<T>(page: Page, call: (api: ProbeApi, arg: string) => T, arg = ''): Promise<T> {
  await ensureProbe(page)
  return page.evaluate(({ source, value }) => {
    const api = (window as unknown as { __phoneM4AudioProbe: ProbeApi }).__phoneM4AudioProbe
    return (new Function('api', 'arg', `return (${source})(api, arg)`) as (api: ProbeApi, arg: string) => T)(api, value)
  }, { source: call.toString(), value: arg })
}

export const storeTracks = (page: Page) => probe(page, api => api.tracks())
export const storeMaster = (page: Page) => probe(page, api => api.master())
export const storeNotes = (page: Page, clipId: string) => probe(page, (api, id) => api.notes(id), clipId)
export const storeMidiClips = (page: Page) => probe(page, api => api.midiClips())
export const storeSelected = (page: Page) => probe(page, api => api.selected())

/**
 * Waits until the editor closed its input gesture (it commits one undo step about 200 ms after the
 * last change of a press), so the next tap is its own undo step, as for a person tapping calmly.
 */
export async function historySettled(page: Page): Promise<void> {
  await expect.poll(() => probe(page, api => api.openGestures()), { message: 'an editor gesture stayed open' }).toBe(false)
}

/** Diagnostics for failure messages: the latest undo steps (label/source), newest first. */
export const recentRevisions = (page: Page) => probe(page, api => api.recentRevisions())
