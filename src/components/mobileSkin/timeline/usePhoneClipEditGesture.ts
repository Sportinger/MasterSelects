// Clip edit gestures of the phone timeline: drag a trim handle, or long-press a clip tile and
// drag it along the timeline / across lanes. While dragging only phone-local preview geometry
// changes (usePhoneClipEditPreviewStore); release commits ONE edit operation, a second finger or
// pointercancel restores everything. The navigation hook consults the returned arbiter so a
// pointer owned by an edit gesture never pans, pinches or taps.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { PhoneActionResult } from '../contracts';
import { commitPhoneClipDrop, commitPhoneClipTrim, computePhoneTrimTiming } from '../actions/phoneClipEditActions';
import { selectPhoneClip } from '../actions/phoneCutActions';
import { usePhoneUiStore } from '../state/phoneUiStore';
import type { PhoneLaneLayout } from './phoneTimelineGeometry';

const log = Logger.create('PhoneClipEditGesture');
export const PHONE_LONG_PRESS_MS = 400;
const LONG_PRESS_SLOP_PX = 8;

export interface PhoneClipEditPreview {
  kind: 'trim' | 'move';
  clipId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  edge?: 'start' | 'end';
}

interface PreviewState {
  preview: PhoneClipEditPreview | null;
  setPreview: (preview: PhoneClipEditPreview | null) => void;
}

/** Phone-local, serializable gesture geometry (never written to the timeline store). */
export const usePhoneClipEditPreviewStore = create<PreviewState>()(subscribeWithSelector((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
})));

/** Lets the navigation hook yield pointers that belong to an edit gesture. */
export interface PhoneClipEditArbiter {
  /** True for a pointerdown the edit gesture takes immediately (a trim handle). */
  claimsPointerDown: (event: PointerEvent) => boolean;
  /** True once the edit gesture owns this pointer (trim or long-press move). */
  consumedPointer: (pointerId: number) => boolean;
  /** True while a trim/move gesture runs (follow-playhead and new touches must yield). */
  isActive: () => boolean;
}

export interface PhoneClipEditContext {
  zoom: number;
  frameRate: number;
  /** Vertical lane scroll in CSS pixels. */
  vScroll: number;
  lanes: readonly PhoneLaneLayout[];
}

export interface UsePhoneClipEditGestureOptions {
  surfaceRef: RefObject<HTMLDivElement | null>;
  lanesViewportRef: RefObject<HTMLDivElement | null>;
  getContext: () => PhoneClipEditContext;
}

interface ActiveGesture {
  kind: 'pending' | 'trim' | 'move';
  pointerId: number;
  x0: number;
  y0: number;
  clip: TimelineClip;
  edge: 'start' | 'end';
  playhead: number;
  timer: ReturnType<typeof setTimeout> | null;
  seekRaf: number | null;
  seekTime: number | null;
}

const TRIM_SELECTOR = '[data-phone-trim-edge]';
const TILE_SELECTOR = '.phone-clip[data-clip-id]:not(.phone-clip--ghost)';

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

/** The lowest video track is the emphasized main track (same rule as PhoneTimeline). */
export function phoneMainTrackId(tracks: readonly TimelineTrack[]): string | null {
  return tracks.filter((track) => track.type === 'video').at(-1)?.id ?? null;
}

function report(result: PhoneActionResult): void {
  const ui = usePhoneUiStore.getState();
  if (!result.ok) ui.showToast(result.message, 'error');
  else if (result.message) ui.showToast(result.message, 'info');
}

export function usePhoneClipEditGesture({ surfaceRef, lanesViewportRef, getContext }: UsePhoneClipEditGestureOptions): PhoneClipEditArbiter {
  const activeRef = useRef<ActiveGesture | null>(null);
  const consumedRef = useRef(new Set<number>());
  const contextRef = useRef(getContext);
  useEffect(() => { contextRef.current = getContext; });

  const arbiter = useMemo<PhoneClipEditArbiter>(() => ({
    // Order-independent: true whether or not this hook's own pointerdown listener ran first.
    claimsPointerDown: (event) => closestElement(event.target, TRIM_SELECTOR) !== null,
    consumedPointer: (pointerId) => consumedRef.current.has(pointerId),
    isActive: () => activeRef.current !== null && activeRef.current.kind !== 'pending',
  }), []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const timeline = () => useTimelineStore.getState();
    const setPreview = usePhoneClipEditPreviewStore.getState().setPreview;
    const frame = (time: number) => {
      const fps = contextRef.current().frameRate;
      return fps > 0 ? Math.round(time * fps) / fps : time;
    };

    const scheduleSeek = (gesture: ActiveGesture, time: number) => {
      gesture.seekTime = time;
      if (gesture.seekRaf !== null) return;
      gesture.seekRaf = requestAnimationFrame(() => {
        gesture.seekRaf = null;
        if (gesture.seekTime !== null && activeRef.current === gesture) timeline().setPlayheadPosition(gesture.seekTime);
      });
    };

    /** Ends any gesture; restores the playhead the user was looking at before the drag. */
    const finish = (gesture: ActiveGesture) => {
      if (gesture.timer !== null) clearTimeout(gesture.timer);
      if (gesture.seekRaf !== null) cancelAnimationFrame(gesture.seekRaf);
      activeRef.current = null;
      if (gesture.kind === 'pending') return;
      setPreview(null);
      const state = timeline();
      if (state.isDraggingPlayhead) state.setDraggingPlayhead(false);
      if (Math.abs(state.playheadPosition - gesture.playhead) > 1e-9) state.setPlayheadPosition(gesture.playhead);
    };

    const cancel = (reason: string) => {
      const gesture = activeRef.current;
      if (!gesture) return;
      if (gesture.kind !== 'pending') log.debug('Clip edit gesture cancelled', { reason, kind: gesture.kind });
      finish(gesture);
    };

    const begin = (kind: 'trim' | 'move', gesture: ActiveGesture) => {
      const state = timeline();
      if (state.isExporting) { report({ ok: false, message: 'Editing is unavailable while an export is running.' }); finish(gesture); return false; }
      if (state.tracks.find((track) => track.id === gesture.clip.trackId)?.locked) {
        report({ ok: false, message: 'This track is locked. Unlock it to edit its clips.' });
        finish(gesture);
        return false;
      }
      if (state.isPlaying) state.pause();
      gesture.kind = kind;
      consumedRef.current.add(gesture.pointerId);
      const { clip } = gesture;
      setPreview({
        kind, clipId: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: clip.duration,
        inPoint: clip.inPoint, outPoint: clip.outPoint, edge: kind === 'trim' ? gesture.edge : undefined,
      });
      if (kind === 'trim') state.setDraggingPlayhead(true);
      return true;
    };

    const laneTrackAt = (clientY: number, sourceTrack: TimelineTrack | undefined): string | null => {
      const rect = lanesViewportRef.current?.getBoundingClientRect();
      if (!rect || !sourceTrack) return null;
      const { lanes, vScroll } = contextRef.current();
      const y = clientY - rect.top + vScroll;
      const lane = lanes.find((candidate) => y >= candidate.top && y < candidate.top + candidate.height);
      const track = lane ? timeline().tracks.find((candidate) => candidate.id === lane.trackId) : undefined;
      return track && track.type === sourceTrack.type && !track.locked ? track.id : null;
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      consumedRef.current.delete(event.pointerId);
      if (activeRef.current) {
        if (activeRef.current.pointerId !== event.pointerId) cancel('second pointer');
        return;
      }
      const handle = closestElement(event.target, TRIM_SELECTOR);
      const tile = handle ? null : closestElement(event.target, TILE_SELECTOR);
      const clipId = (handle ?? tile)?.dataset.clipId;
      const clip = clipId ? timeline().clips.find((candidate) => candidate.id === clipId) : undefined;
      if (!clip) return;
      const gesture: ActiveGesture = {
        kind: 'pending', pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, clip,
        edge: handle?.dataset.phoneTrimEdge === 'start' ? 'start' : 'end',
        playhead: timeline().playheadPosition, timer: null, seekRaf: null, seekTime: null,
      };
      activeRef.current = gesture;
      if (handle) {
        event.preventDefault();
        try { surface.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
        begin('trim', gesture);
        return;
      }
      gesture.timer = setTimeout(() => {
        gesture.timer = null;
        if (activeRef.current !== gesture || gesture.kind !== 'pending') return;
        if (!timeline().selectedClipIds.has(clip.id)) selectPhoneClip(clip.id);
        if (begin('move', gesture)) navigator.vibrate?.(12);
      }, PHONE_LONG_PRESS_MS);
    };

    const onMove = (event: PointerEvent) => {
      const gesture = activeRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x0;
      const dy = event.clientY - gesture.y0;
      if (gesture.kind === 'pending') {
        if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) cancel('moved before long-press');
        return;
      }
      const { zoom } = contextRef.current();
      const delta = zoom > 0 ? frame(dx / zoom) : 0;
      const { clip } = gesture;
      if (gesture.kind === 'trim') {
        const timing = computePhoneTrimTiming(clip, gesture.edge, delta, timeline().clips);
        setPreview({
          kind: 'trim', clipId: clip.id, trackId: clip.trackId, startTime: timing.newStartTime, duration: timing.newDuration,
          inPoint: timing.newInPoint, outPoint: timing.newOutPoint, edge: gesture.edge,
        });
        const fps = contextRef.current().frameRate;
        const lastFrame = Math.max(timing.newStartTime, timing.newStartTime + timing.newDuration - (fps > 0 ? 1 / fps : 0));
        scheduleSeek(gesture, gesture.edge === 'start' ? timing.newStartTime : lastFrame);
        return;
      }
      const sourceTrack = timeline().tracks.find((track) => track.id === clip.trackId);
      const current = usePhoneClipEditPreviewStore.getState().preview;
      const trackId = laneTrackAt(event.clientY, sourceTrack) ?? current?.trackId ?? clip.trackId;
      setPreview({
        kind: 'move', clipId: clip.id, trackId, startTime: Math.max(0, frame(clip.startTime + delta)), duration: clip.duration,
        inPoint: clip.inPoint, outPoint: clip.outPoint,
      });
    };

    const onUp = (event: PointerEvent) => {
      const gesture = activeRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const preview = usePhoneClipEditPreviewStore.getState().preview;
      const kind = gesture.kind;
      finish(gesture);
      if (kind === 'pending' || !preview) return;
      if (kind === 'trim') {
        const unchanged = Math.abs(preview.startTime - gesture.clip.startTime) < 1e-6 && Math.abs(preview.duration - gesture.clip.duration) < 1e-6;
        if (unchanged) return;
        const timing = computePhoneTrimTiming(
          gesture.clip, gesture.edge,
          gesture.edge === 'start' ? preview.startTime - gesture.clip.startTime : preview.duration - gesture.clip.duration,
          timeline().clips,
        );
        report(commitPhoneClipTrim(gesture.clip.id, timing));
        return;
      }
      report(commitPhoneClipDrop({
        clipId: gesture.clip.id, dropStart: preview.startTime, targetTrackId: preview.trackId,
        mainTrackId: phoneMainTrackId(timeline().tracks),
      }));
    };

    const onCancel = (event: PointerEvent) => {
      if (activeRef.current?.pointerId === event.pointerId) cancel(event.type);
    };
    const onContextMenu = (event: Event) => {
      if (activeRef.current) event.preventDefault();
    };

    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onCancel);
    surface.addEventListener('lostpointercapture', onCancel);
    surface.addEventListener('contextmenu', onContextMenu);
    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onCancel);
      surface.removeEventListener('lostpointercapture', onCancel);
      surface.removeEventListener('contextmenu', onContextMenu);
      cancel('unmount');
    };
  }, [lanesViewportRef, surfaceRef]);

  return arbiter;
}
