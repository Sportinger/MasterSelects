// Pure geometry of the phone timeline with a FIXED centre playhead.
//
// For viewport width W, centre padding P = W/2, zoom z (px/s) and phone scroll s:
//   screenX(t)  = P + t*z - s
//   centreTime  = s / z
// Half-viewport padding on both ends lets time 0 and the content end reach the centre.
// The phone scroll is local; the desktop timeline scrollX/zoom is never written.

import {
  PHONE_TIMELINE_MAX_ZOOM,
  PHONE_TIMELINE_MIN_ZOOM,
} from '../contracts';
import { sanitizeTimelineFrameRate } from '../../../utils/timelineFrameQuantization';

export interface PhoneTimelineView {
  /** Surface width in CSS pixels. */
  width: number;
  /** Pixels per second. */
  zoom: number;
  /** Phone-local scroll in pixels: scroll = centreTime * zoom. */
  scroll: number;
}

export interface PhoneTimeWindow {
  start: number;
  end: number;
}

export interface PhoneLaneLayout {
  trackId: string;
  /** Top edge inside the lane content, in CSS pixels. */
  top: number;
  height: number;
}

export interface PhoneGeometryClip {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
}

const FRAME_EPSILON = 1e-6;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampPhoneZoom(zoom: number): number {
  const safe = finiteOr(zoom, PHONE_TIMELINE_MIN_ZOOM);
  return Math.min(PHONE_TIMELINE_MAX_ZOOM, Math.max(PHONE_TIMELINE_MIN_ZOOM, safe));
}

export function centrePadding(width: number): number {
  return Math.max(0, finiteOr(width, 0)) / 2;
}

export function timeToScreenX(time: number, view: PhoneTimelineView): number {
  return centrePadding(view.width) + time * view.zoom - view.scroll;
}

export function screenXToTime(x: number, view: PhoneTimelineView): number {
  return view.zoom > 0 ? (x - centrePadding(view.width) + view.scroll) / view.zoom : 0;
}

export function scrollForTime(time: number, zoom: number): number {
  return finiteOr(time, 0) * zoom;
}

/** Time under the fixed centre playhead. */
export function centreTimeForScroll(scroll: number, zoom: number): number {
  return zoom > 0 ? finiteOr(scroll, 0) / zoom : 0;
}

export function clampTime(time: number, end: number): number {
  const safeEnd = Math.max(0, finiteOr(end, 0));
  return Math.min(safeEnd, Math.max(0, finiteOr(time, 0)));
}

export function clampScroll(scroll: number, end: number, zoom: number): number {
  const max = Math.max(0, finiteOr(end, 0)) * zoom;
  return Math.min(max, Math.max(0, finiteOr(scroll, 0)));
}

/** Width of the scrollable content including half-viewport padding on both sides. */
export function paddedContentWidth(end: number, zoom: number, width: number): number {
  return Math.max(0, end) * zoom + 2 * centrePadding(width);
}

export interface PinchInput {
  startScroll: number;
  startZoom: number;
  startMidpointX: number;
  nextZoom: number;
  nextMidpointX: number;
  width: number;
}

/** Time under the pinch midpoint when the pinch started. */
export function pinchAnchorTime(startScroll: number, startMidpointX: number, startZoom: number, width: number): number {
  return startZoom > 0 ? (startScroll + startMidpointX - centrePadding(width)) / startZoom : 0;
}

/** Scroll that keeps the pinch anchor time under the (possibly moved) midpoint. */
export function pinchScroll(input: PinchInput): number {
  const anchor = pinchAnchorTime(input.startScroll, input.startMidpointX, input.startZoom, input.width);
  return centrePadding(input.width) + anchor * input.nextZoom - input.nextMidpointX;
}

/** Start of the last frame that begins before `end` (the last frame that still shows content). */
export function lastFrameStart(end: number, frameRate: number): number {
  const fps = sanitizeTimelineFrameRate(frameRate);
  const safeEnd = Math.max(0, finiteOr(end, 0));
  const frames = Math.ceil(safeEnd * fps - FRAME_EPSILON);
  return Math.max(0, frames - 1) / fps;
}

/** Nearest frame start at the composition frame rate, clamped to [0, last frame start]. */
export function alignTimeToFrame(time: number, frameRate: number, end?: number): number {
  const fps = sanitizeTimelineFrameRate(frameRate);
  const aligned = Math.max(0, Math.round(finiteOr(time, 0) * fps)) / fps;
  if (end === undefined) return aligned;
  return Math.min(aligned, lastFrameStart(end, fps));
}

/** Times at the left and right edges of the surface. */
export function viewTimeRange(view: PhoneTimelineView): PhoneTimeWindow {
  return { start: screenXToTime(0, view), end: screenXToTime(view.width, view) };
}

/** Visible range expanded by `overscanPx` on each side. */
export function overscanWindow(view: PhoneTimelineView, overscanPx: number): PhoneTimeWindow {
  const range = viewTimeRange(view);
  const pad = view.zoom > 0 ? overscanPx / view.zoom : 0;
  return { start: range.start - pad, end: range.end + pad };
}

/** True once the view comes within `marginPx` of the rendered timeWindow edge (or leaves it). */
export function windowNeedsRefresh(view: PhoneTimelineView, timeWindow: PhoneTimeWindow, marginPx: number): boolean {
  const range = viewTimeRange(view);
  const margin = view.zoom > 0 ? marginPx / view.zoom : 0;
  return range.start < timeWindow.start + margin || range.end > timeWindow.end - margin;
}

export function clipIntersectsWindow(clip: PhoneGeometryClip, timeWindow: PhoneTimeWindow): boolean {
  return clip.startTime < timeWindow.end && clip.startTime + clip.duration > timeWindow.start;
}

/** Clips that intersect the timeWindow: the only ones rendered (virtualization). */
export function visibleClipsInWindow<T extends PhoneGeometryClip>(clips: readonly T[], timeWindow: PhoneTimeWindow): T[] {
  return clips.filter((clip) => clipIntersectsWindow(clip, timeWindow));
}

export interface PhoneHitTestInput {
  /** Surface-relative x in CSS pixels. */
  x: number;
  /** y inside the lane content (viewport y plus vertical lane scroll). */
  y: number;
  view: PhoneTimelineView;
  lanes: readonly PhoneLaneLayout[];
  clips: readonly PhoneGeometryClip[];
  /** Short clips get at least this hit width in pixels. */
  minHitWidthPx?: number;
}

export function hitTestClip(input: PhoneHitTestInput): string | null {
  const lane = input.lanes.find((candidate) => input.y >= candidate.top && input.y < candidate.top + candidate.height);
  if (!lane) return null;
  const minWidth = Math.max(0, input.minHitWidthPx ?? 16);
  let best: { id: string; distance: number } | null = null;
  for (const clip of input.clips) {
    if (clip.trackId !== lane.trackId) continue;
    const left = timeToScreenX(clip.startTime, input.view);
    const width = clip.duration * input.view.zoom;
    const grow = Math.max(0, (minWidth - width) / 2);
    if (input.x < left - grow || input.x > left + width + grow) continue;
    const centre = left + width / 2;
    const distance = Math.abs(input.x - centre);
    if (!best || distance < best.distance) best = { id: clip.id, distance };
  }
  return best?.id ?? null;
}

const RULER_STEPS = [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Smallest "nice" tick step whose pixel spacing is at least `minSpacingPx`. */
export function rulerTickStep(zoom: number, minSpacingPx = 72): number {
  for (const step of RULER_STEPS) {
    if (step * zoom >= minSpacingPx) return step;
  }
  return RULER_STEPS[RULER_STEPS.length - 1];
}

export function rulerTicks(timeWindow: PhoneTimeWindow, step: number, end: number): number[] {
  if (!(step > 0)) return [];
  const first = Math.max(0, Math.ceil(timeWindow.start / step - FRAME_EPSILON));
  const last = Math.floor(Math.min(timeWindow.end, Math.max(0, end)) / step + FRAME_EPSILON);
  const ticks: number[] = [];
  for (let index = first; index <= last && ticks.length < 400; index += 1) ticks.push(index * step);
  return ticks;
}

export function formatRulerTime(time: number, step: number): string {
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  const secondsText = step < 1 ? seconds.toFixed(1).padStart(4, '0') : String(Math.round(seconds)).padStart(2, '0');
  return `${minutes}:${secondsText}`;
}

/** The phone scrolls to the authored content end, not the padded workspace duration. */
export function timelineContentEnd(clips: readonly PhoneGeometryClip[], duration: number): number {
  let end = 0;
  for (const clip of clips) end = Math.max(end, clip.startTime + clip.duration);
  const safeDuration = Math.max(0, finiteOr(duration, 0));
  if (end <= 0) return safeDuration;
  return safeDuration > 0 ? Math.min(end, safeDuration) : end;
}
