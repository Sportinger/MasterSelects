// The single gesture owner of the phone timeline surface (Pointer Events).
// One finger horizontal = scrub (seeks coalesced to animation frames, frame-aligned on release),
// one finger vertical = lane scroll, two fingers = pinch zoom, short tap = select/deselect.
// While playing, the content follows the live playhead under the fixed centre marker without
// seeking. The phone scroll is derived from the centre time and never written to the desktop.
// Clip edit gestures (trim handles, long-press move) run in usePhoneClipEditGesture; pointers they
// own are yielded here so they never pan, pinch or tap.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { Logger } from '../../../services/logger';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useTimelineStore } from '../../../stores/timeline';
import { stepTimeByFrames } from '../../../utils/timelineFrameQuantization';
import { selectPhoneClip } from '../actions/phoneCutActions';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneClipEditGesture } from './usePhoneClipEditGesture';
import {
  alignTimeToFrame, clampPhoneZoom, clampTime, hitTestClip, overscanWindow, pinchScroll,
  scrollForTime, windowNeedsRefresh,
  type PhoneGeometryClip, type PhoneLaneLayout, type PhoneTimelineView, type PhoneTimeWindow,
} from './phoneTimelineGeometry';

const log = Logger.create('PhoneTimelineNav');

/**
 * Pinch anchor. 'playhead' keeps the frame under the fixed playhead (M0 acceptance: zooming
 * never changes the previewed frame). 'midpoint' keeps the time under the fingers' midpoint and
 * seeks the playhead to follow; the geometry supports both.
 */
export const PHONE_PINCH_ANCHOR: 'playhead' | 'midpoint' = 'playhead';
const MOVE_THRESHOLD_PX = 6;
const TAP_MAX_MS = 500;

export interface PhoneTimelineLayers {
  /** Clip tiles and ruler ticks: translated horizontally (and vertically for lanes). */
  clips: RefObject<HTMLDivElement | null>;
  ruler: RefObject<HTMLDivElement | null>;
  /** Lane backgrounds: translated vertically only. */
  laneBacks: RefObject<HTMLDivElement | null>;
  lanesViewport: RefObject<HTMLDivElement | null>;
}

export interface UsePhoneTimelineNavigationOptions {
  surfaceRef: RefObject<HTMLDivElement | null>;
  layers: PhoneTimelineLayers;
  width: number;
  contentEnd: number;
  frameRate: number;
  lanes: readonly PhoneLaneLayout[];
  laneContentHeight: number;
  lanesViewportHeight: number;
  clips: readonly PhoneGeometryClip[];
}

type Mode = 'idle' | 'pending' | 'pan' | 'vscroll' | 'pinch' | 'ignored';

interface PointerPoint { x: number; y: number }

function storeState() {
  return useTimelineStore.getState();
}

function pausePlayback(): void {
  const state = storeState();
  if (state.isPlaying) state.pause();
}

export function usePhoneTimelineNavigation(options: UsePhoneTimelineNavigationOptions) {
  const { surfaceRef, width } = options;
  const zoom = usePhoneUiStore((state) => state.timelineZoom);
  const [timeWindow, setTimeWindow] = useState<PhoneTimeWindow>({ start: 0, end: 0 });

  const optsRef = useRef(options);
  // Declared first so every later layout effect and event handler reads this render's options.
  useLayoutEffect(() => {
    optsRef.current = options;
  });
  /** The zoom the tiles are currently rendered at. */
  const zoomRef = useRef(clampPhoneZoom(zoom));
  const centreRef = useRef(clampTime(storeState().playheadPosition, Number.MAX_SAFE_INTEGER));
  const vScrollRef = useRef(0);
  const windowRef = useRef<PhoneTimeWindow>(timeWindow);
  const modeRef = useRef<Mode>('idle');
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const gestureRef = useRef({ x: 0, y: 0, t0: 0, centre: 0, vScroll: 0, zoom: 0, dist: 1, midX: 0, dragging: false });
  const seekRef = useRef<{ time: number | null; raf: number | null }>({ time: null, raf: null });
  const zoomRafRef = useRef<{ zoom: number | null; raf: number | null }>({ zoom: null, raf: null });

  const editArbiter = usePhoneClipEditGesture({
    surfaceRef,
    lanesViewportRef: options.layers.lanesViewport,
    getContext: () => ({
      zoom: zoomRef.current,
      frameRate: optsRef.current.frameRate,
      vScroll: vScrollRef.current,
      lanes: optsRef.current.lanes,
    }),
  });

  const view = useCallback((): PhoneTimelineView => ({
    width: optsRef.current.width,
    zoom: zoomRef.current,
    scroll: scrollForTime(centreRef.current, zoomRef.current),
  }), []);

  /** Moves the content layers; re-renders tiles only when the visible window must change. */
  const applyTransform = useCallback((forceWindow = false) => {
    const { layers: l, width: w, laneContentHeight, lanesViewportHeight } = optsRef.current;
    const maxV = Math.max(0, laneContentHeight - lanesViewportHeight);
    vScrollRef.current = Math.min(maxV, Math.max(0, vScrollRef.current));
    const x = w / 2 - scrollForTime(centreRef.current, zoomRef.current);
    const y = -vScrollRef.current;
    if (l.clips.current) l.clips.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (l.ruler.current) l.ruler.current.style.transform = `translate3d(${x}px, 0, 0)`;
    if (l.laneBacks.current) l.laneBacks.current.style.transform = `translate3d(0, ${y}px, 0)`;
    if (w <= 0) return;
    const current = view();
    if (forceWindow || windowNeedsRefresh(current, windowRef.current, w / 2)) {
      const next = overscanWindow(current, w);
      windowRef.current = next;
      setTimeWindow(next);
    }
  }, [view]);

  const scheduleSeek = useCallback((time: number) => {
    seekRef.current.time = time;
    if (seekRef.current.raf !== null) return;
    seekRef.current.raf = requestAnimationFrame(() => {
      seekRef.current.raf = null;
      const pending = seekRef.current.time;
      seekRef.current.time = null;
      if (pending !== null) storeState().setPlayheadPosition(pending);
    });
  }, []);

  const commitSeek = useCallback((time: number) => {
    if (seekRef.current.raf !== null) cancelAnimationFrame(seekRef.current.raf);
    seekRef.current = { time: null, raf: null };
    const { contentEnd, frameRate } = optsRef.current;
    const aligned = alignTimeToFrame(time, frameRate, contentEnd > 0 ? contentEnd : undefined);
    centreRef.current = aligned;
    applyTransform();
    const state = storeState();
    if (state.isDraggingPlayhead) state.setDraggingPlayhead(false);
    state.setPlayheadPosition(aligned);
  }, [applyTransform]);

  const scheduleZoom = useCallback((next: number) => {
    zoomRafRef.current.zoom = next;
    if (zoomRafRef.current.raf !== null) return;
    zoomRafRef.current.raf = requestAnimationFrame(() => {
      zoomRafRef.current.raf = null;
      const pending = zoomRafRef.current.zoom;
      zoomRafRef.current.zoom = null;
      if (pending !== null) usePhoneUiStore.getState().setTimelineZoom(pending);
    });
  }, []);

  const beginDrag = useCallback(() => {
    pausePlayback();
    gestureRef.current.dragging = true;
    storeState().setDraggingPlayhead(true);
  }, []);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const { surfaceRef: s, layers: l, lanes, clips } = optsRef.current;
    const surfaceRect = s.current?.getBoundingClientRect();
    const lanesRect = l.lanesViewport.current?.getBoundingClientRect();
    if (!surfaceRect || !lanesRect) return;
    if (clientY < lanesRect.top || clientY > lanesRect.bottom) return;
    const hit = hitTestClip({
      x: clientX - surfaceRect.left,
      y: clientY - lanesRect.top + vScrollRef.current,
      view: view(),
      lanes,
      clips,
    });
    const state = storeState();
    selectPhoneClip(hit !== null && state.primarySelectedClipId === hit && state.selectedClipIds.has(hit) ? null : hit);
  }, [view]);

  // Pointer, wheel and keyboard handling, bound once to the surface.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const gesture = gestureRef.current;
    const local = (event: PointerEvent): PointerPoint => {
      const rect = surface.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pinchMetrics = () => {
      const [a, b] = [...pointersRef.current.values()];
      return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2 };
    };
    const startPinch = () => {
      const metrics = pinchMetrics();
      pausePlayback();
      Object.assign(gestureRef.current, { zoom: zoomRef.current, centre: centreRef.current, ...metrics });
      if (PHONE_PINCH_ANCHOR === 'midpoint' && !gestureRef.current.dragging) beginDrag();
      modeRef.current = 'pinch';
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // Trim handles and running edit gestures own their pointers (a second finger cancels them).
      if (editArbiter.claimsPointerDown(event) || editArbiter.isActive()) return;
      try { surface.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      const point = local(event);
      pointersRef.current.set(event.pointerId, point);
      if (pointersRef.current.size === 1) {
        modeRef.current = 'pending';
        Object.assign(gestureRef.current, {
          x: point.x, y: point.y, t0: performance.now(), centre: centreRef.current, vScroll: vScrollRef.current, dragging: false,
        });
      } else if (pointersRef.current.size === 2) {
        startPinch();
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      if (editArbiter.consumedPointer(event.pointerId)) {
        // A long-press turned this pointer into a clip drag: stop treating it as pan or tap.
        if (modeRef.current === 'pending') modeRef.current = 'ignored';
        return;
      }
      const point = local(event);
      pointersRef.current.set(event.pointerId, point);
      const g = gestureRef.current;
      const { contentEnd, laneContentHeight, lanesViewportHeight, width: w } = optsRef.current;
      const dx = point.x - g.x;
      const dy = point.y - g.y;
      if (modeRef.current === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > MOVE_THRESHOLD_PX) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          modeRef.current = 'pan';
          beginDrag();
        } else {
          modeRef.current = laneContentHeight > lanesViewportHeight ? 'vscroll' : 'ignored';
        }
      }
      if (modeRef.current === 'pan') {
        centreRef.current = clampTime(g.centre - dx / zoomRef.current, contentEnd);
        applyTransform();
        scheduleSeek(centreRef.current);
      } else if (modeRef.current === 'vscroll') {
        vScrollRef.current = g.vScroll - dy;
        applyTransform();
      } else if (modeRef.current === 'pinch' && pointersRef.current.size >= 2) {
        const metrics = pinchMetrics();
        const nextZoom = clampPhoneZoom(g.zoom * (metrics.dist / g.dist));
        if (PHONE_PINCH_ANCHOR === 'midpoint') {
          const scroll = pinchScroll({
            startScroll: scrollForTime(g.centre, g.zoom), startZoom: g.zoom, startMidpointX: g.midX,
            nextZoom, nextMidpointX: metrics.midX, width: w,
          });
          centreRef.current = clampTime(scroll / nextZoom, contentEnd);
          scheduleSeek(centreRef.current);
        }
        // Tiles re-render at the new zoom first; the layout effect then moves the layers, so
        // layout and transform never disagree for a frame.
        if (nextZoom === zoomRef.current) applyTransform();
        else scheduleZoom(nextZoom);
      }
    };
    const onEnd = (event: PointerEvent, cancelled: boolean) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.delete(event.pointerId);
      const mode = modeRef.current;
      const g = gestureRef.current;
      if (mode === 'pinch') {
        modeRef.current = pointersRef.current.size > 0 ? 'ignored' : 'idle';
      } else if (pointersRef.current.size === 0) {
        modeRef.current = 'idle';
      }
      if (pointersRef.current.size > 0) return;
      if (mode === 'pending' && !cancelled && !editArbiter.consumedPointer(event.pointerId) && performance.now() - g.t0 <= TAP_MAX_MS) {
        handleTap(event.clientX, event.clientY);
      }
      if (g.dragging) {
        g.dragging = false;
        commitSeek(centreRef.current);
      }
    };
    const onUp = (event: PointerEvent) => onEnd(event, false);
    const onCancel = (event: PointerEvent) => onEnd(event, true);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        scheduleZoom(clampPhoneZoom((zoomRafRef.current.zoom ?? zoomRef.current) * Math.exp(-event.deltaY * 0.01)));
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      pausePlayback();
      centreRef.current = clampTime(centreRef.current + delta / zoomRef.current, optsRef.current.contentEnd);
      applyTransform();
      scheduleSeek(alignTimeToFrame(centreRef.current, optsRef.current.frameRate));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Trim handles use the arrow keys to trim by a frame.
      if (event.target instanceof Element && event.target.closest('[data-phone-trim-edge]')) return;
      if (event.key === 'Escape') { selectPhoneClip(null); return; }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      pausePlayback();
      const { frameRate, contentEnd } = optsRef.current;
      const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1);
      commitSeek(stepTimeByFrames(centreRef.current, step, frameRate, contentEnd));
    };
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onCancel);
    surface.addEventListener('lostpointercapture', onCancel);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('keydown', onKeyDown);
    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onCancel);
      surface.removeEventListener('lostpointercapture', onCancel);
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('keydown', onKeyDown);
      if (gesture.dragging) {
        gesture.dragging = false;
        storeState().setDraggingPlayhead(false);
      }
    };
  }, [applyTransform, beginDrag, commitSeek, editArbiter, handleTap, scheduleSeek, scheduleZoom, surfaceRef]);

  // Zoom from the store (pinch commit, other controls) and width changes re-layout the window.
  useLayoutEffect(() => {
    zoomRef.current = clampPhoneZoom(zoom);
    applyTransform(true);
  }, [applyTransform, zoom, width, options.laneContentHeight, options.lanesViewportHeight]);

  // Follow the playhead: per animation frame while playing, on store changes while paused.
  useEffect(() => {
    let raf: number | null = null;
    // Trim previews seek the playhead to the dragged edge; the content must not follow those seeks.
    const userGesture = () => modeRef.current === 'pan' || modeRef.current === 'pinch' || editArbiter.isActive();
    const follow = (time: number) => {
      if (userGesture()) return;
      const end = Math.max(optsRef.current.contentEnd, storeState().duration);
      const next = clampTime(time, end);
      if (Math.abs(next - centreRef.current) < 1e-9) return;
      centreRef.current = next;
      applyTransform();
    };
    const tick = () => {
      raf = null;
      const state = storeState();
      if (!state.isPlaying) return;
      follow(getPlayheadPosition(state.playheadPosition));
      raf = requestAnimationFrame(tick);
    };
    const startLoop = () => { if (raf === null) raf = requestAnimationFrame(tick); };
    if (storeState().isPlaying) startLoop();
    const unsubPlaying = useTimelineStore.subscribe((s) => s.isPlaying, (playing) => {
      if (playing) {
        if (modeRef.current === 'pan') log.debug('Playback started during a scrub gesture');
        startLoop();
      }
    });
    const unsubPosition = useTimelineStore.subscribe((s) => s.playheadPosition, (position) => {
      if (!storeState().isPlaying && seekRef.current.raf === null) follow(position);
    });
    follow(storeState().playheadPosition);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      unsubPlaying();
      unsubPosition();
    };
  }, [applyTransform, editArbiter]);

  useEffect(() => () => {
    if (seekRef.current.raf !== null) cancelAnimationFrame(seekRef.current.raf);
    if (zoomRafRef.current.raf !== null) cancelAnimationFrame(zoomRafRef.current.raf);
  }, []);

  return { timeWindow, zoom: clampPhoneZoom(zoom) };
}
