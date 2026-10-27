import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PREVIEW_VIEW_TEST_IDS as VIEW } from '../../../src/components/mobileSkin/preview/phonePreviewViewIds'
import { expect, tapOn, type M1Session } from './m1Fixture'

/**
 * Helpers of the G3 on-preview handle journeys on the shared M1 phone world. The in-page probe READS
 * the shared stores (clip transform, masks, motion path, guides, view options); its only write puts
 * the per-viewer preview view options and the split compare back to their defaults before a case,
 * so cases never inherit another case's view.
 */

const PROBE_SOURCE = `
import { useTimelineStore } from '/src/stores/timeline/index.ts';
import { useMediaStore } from '/src/stores/mediaStore/index.ts';
import { useSplitCompareStore } from '/src/stores/splitCompareStore.ts';
import { usePhonePreviewViewStore } from '/src/components/mobileSkin/preview/phonePreviewViewStore.ts';

window.__phoneG3Probe = {
  clip(id) {
    const clip = useTimelineStore.getState().clips.find(c => c.id === id);
    if (!clip) return null;
    return {
      transform: clip.transform,
      masks: (clip.masks ?? []).map(m => ({ name: m.name, closed: m.closed, vertices: m.vertices.map(v => ({ x: v.x, y: v.y, hx: v.handleOut.x, hy: v.handleOut.y })) })),
      path: clip.motion?.shape?.primitive === 'path' ? clip.motion.shape.path ?? null : null,
      source: clip.source?.type ?? null,
      name: clip.name,
      appearance: (clip.motion?.appearance?.items ?? []).map(i => ({ kind: i.kind, visible: i.visible, width: i.width ?? null, opacity: i.opacity })),
      trackId: clip.trackId,
      startTime: clip.startTime,
    };
  },
  clips() {
    return useTimelineStore.getState().clips.map(c => ({ id: c.id, name: c.name, source: c.source?.type ?? null }));
  },
  guides() {
    const media = useMediaStore.getState();
    return (media.compositions.find(c => c.id === media.activeCompositionId)?.guides ?? []).map(g => ({ orientation: g.orientation, position: g.position }));
  },
  view() {
    const v = usePhonePreviewViewStore.getState();
    const c = useSplitCompareStore.getState();
    return { handles: v.handles, snap: v.snap, rulers: v.rulers, zoom: v.zoom, pan: v.pan, compare: c.enabled, comparePosition: c.position };
  },
  // Cleanup only.
  resetView() {
    const v = usePhonePreviewViewStore.getState();
    v.setHandles(true); v.setSnap(true); v.setRulers(false); v.setZoom('fit');
    const c = useSplitCompareStore.getState();
    c.setEnabled(false); c.setPosition(0.5); c.setFeather(0.006);
  },
};
`

export interface G3Clip {
  transform: { position: { x: number; y: number; z: number }; scale: { x: number; y: number; all?: number }; rotation: { x: number; y: number; z: number } }
  masks: Array<{ name: string; closed: boolean; vertices: Array<{ x: number; y: number; hx: number; hy: number }> }>
  path: { vertices: Array<{ x: number; y: number }>; closed: boolean; trim?: { start: number; end: number }; dash?: { length: number; gap: number } } | null
  source: string | null
  name: string
  appearance: Array<{ kind: string; visible: boolean; width: number | null; opacity: number }>
  trackId: string
  startTime: number
}
export interface G3View { handles: boolean; snap: boolean; rulers: boolean; zoom: string; pan: { x: number; y: number }; compare: boolean; comparePosition: number }

async function ensureProbe(page: Page): Promise<void> {
  if (await page.evaluate(() => Boolean((window as unknown as { __phoneG3Probe?: unknown }).__phoneG3Probe))) return
  await page.addScriptTag({ type: 'module', content: PROBE_SOURCE })
  await page.waitForFunction(() => Boolean((window as unknown as { __phoneG3Probe?: unknown }).__phoneG3Probe), undefined, { timeout: 30_000 })
}

async function call<T>(page: Page, method: string, arg?: unknown): Promise<T> {
  await ensureProbe(page)
  return page.evaluate(([name, value]) => (window as unknown as { __phoneG3Probe: Record<string, (v: unknown) => unknown> }).__phoneG3Probe[name as string](value) as T, [method, arg] as const)
}

export const g3Clip = (page: Page, id: string) => call<G3Clip | null>(page, 'clip', id)
export const g3Clips = (page: Page) => call<Array<{ id: string; name: string; source: string | null }>>(page, 'clips')
export const g3Guides = (page: Page) => call<Array<{ orientation: string; position: number }>>(page, 'guides')
export const g3View = (page: Page) => call<G3View>(page, 'view')
export const g3ResetView = (page: Page) => call<void>(page, 'resetView')

export async function canvasBox(m1: M1Session): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await m1.page.getByTestId(PHONE_TEST_IDS.previewRegion).getByTestId(PHONE_TEST_IDS.previewCanvas).boundingBox()
  if (!box) throw new Error('the preview canvas is not rendered')
  return box
}

export async function canvasPoint(m1: M1Session, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await canvasBox(m1)
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

/** Opens the Preview view sheet from the button on the preview. */
export async function openViewSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(VIEW.viewButton))
  await expect(m1.page.getByTestId(VIEW.sheet), 'the Preview view sheet did not open').toBeVisible()
}

/**
 * Two fingers `radius` px from `center`, turned from `fromDeg` to `toDeg` (screen degrees, clockwise
 * positive) in `steps` moves, one per frame. Real touch through CDP like phoneTouch.ts.
 */
export async function twist(m1: M1Session, center: { x: number; y: number }, radius: number, fromDeg: number, toDeg: number, steps = 12): Promise<void> {
  const fingers = (deg: number) => {
    const r = deg * Math.PI / 180
    return [
      { x: center.x - radius * Math.cos(r), y: center.y - radius * Math.sin(r), id: 0, radiusX: 1, radiusY: 1, force: 1 },
      { x: center.x + radius * Math.cos(r), y: center.y + radius * Math.sin(r), id: 1, radiusX: 1, radiusY: 1, force: 1 },
    ]
  }
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(fromDeg) })
  await m1.touch.nextFrame()
  for (let step = 1; step <= steps; step++) {
    await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(fromDeg + (toDeg - fromDeg) * step / steps) })
    await m1.touch.nextFrame()
  }
  for (let index = 0; index < 3; index++) {
    await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(toDeg) })
    await m1.touch.nextFrame()
  }
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await m1.touch.nextFrame()
}

/** One finger down, moved, then the touch is cancelled by the system (touchCancel) instead of lifted. */
export async function panThenCancel(m1: M1Session, from: { x: number; y: number }, delta: { x: number; y: number }, steps = 8): Promise<void> {
  const at = (t: number) => [{ x: from.x + delta.x * t, y: from.y + delta.y * t, id: 0, radiusX: 1, radiusY: 1, force: 1 }]
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) })
  await m1.touch.nextFrame()
  for (let step = 1; step <= steps; step++) {
    await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step / steps) })
    await m1.touch.nextFrame()
  }
  await m1.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await m1.touch.nextFrame()
}

/**
 * Share of near-white pixels (every channel above 220) in a region given in fractions of the preview.
 * The phone path line is drawn white; the overlays on the preview (accent lines, dark knobs) and the
 * frame-code clip's dark band under the bars are not, so this isolates the rendered line.
 */
export function whiteShare(px: { width: number; height: number; data: Buffer }, region: { x0: number; y0: number; x1: number; y1: number }): number {
  const x0 = Math.floor(px.width * region.x0)
  const x1 = Math.ceil(px.width * region.x1)
  const y0 = Math.floor(px.height * region.y0)
  const y1 = Math.ceil(px.height * region.y1)
  let white = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * px.width + x) * 3
      if (px.data[offset] > 220 && px.data[offset + 1] > 220 && px.data[offset + 2] > 220) white++
      total++
    }
  }
  return total > 0 ? white / total : 0
}
