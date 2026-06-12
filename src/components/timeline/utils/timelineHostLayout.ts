import type {
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type {
  TimelineClipDragPreview,
  TimelineTrackFocusMode,
} from '../../../stores/timeline/types';
import { isManualLinkedGroupId } from '../../../stores/timeline/helpers/idGenerator';
import type { ClipDragState } from '../types';
import {
  COLLAPSED_TRACK_HEIGHT,
  SPLIT_FOCUS_EDGE_THRESHOLD_PX,
  TRACK_SCROLL_GLIDE_MAX_MS,
  TRACK_SCROLL_GLIDE_MIN_MS,
  TRACK_SCROLL_GLIDE_PX_PER_MS,
  TRACK_SCROLL_LIVE_TARGET_APPROACH,
  TRACK_SCROLL_MAX_STEPS_PER_GESTURE,
  TRACK_SCROLL_SNAP_EPSILON_PX,
  TRACK_SCROLL_STEP_DELTA_PX,
} from './timelineHostConstants';
import type {
  KeyframeAreaRevealSnapshot,
  TrackSectionKind,
} from './timelineHostTypes';

export function clipDragAffectsTrack(
  drag: ClipDragState | null,
  trackId: string,
  clipMap: Map<string, TimelineClip>,
): boolean {
  if (!drag) return false;
  if (drag.originalTrackId === trackId || drag.currentTrackId === trackId) return true;

  const draggedClip = clipMap.get(drag.clipId);
  if (draggedClip?.trackId === trackId) return true;
  if (draggedClip?.linkedClipId && clipMap.get(draggedClip.linkedClipId)?.trackId === trackId) return true;

  if (draggedClip?.linkedGroupId && isManualLinkedGroupId(draggedClip.linkedGroupId)) {
    for (const clip of clipMap.values()) {
      if (clip.linkedGroupId === draggedClip.linkedGroupId && clip.trackId === trackId) {
        return true;
      }
    }
  }

  if (drag.multiSelectClipIds?.some((clipId) => clipMap.get(clipId)?.trackId === trackId)) return true;
  if (drag.overlapClipIds?.some((clipId) => clipMap.get(clipId)?.trackId === trackId)) return true;
  return false;
}

export function clipDragPreviewAffectsTrack(
  preview: TimelineClipDragPreview | null,
  trackId: string,
  clipMap: Map<string, TimelineClip>,
): boolean {
  if (!preview) return false;

  for (const [clipId, patch] of Object.entries(preview.patches)) {
    const clip = clipMap.get(clipId);
    if (clip?.trackId === trackId) return true;
    if ((patch.trackId ?? clip?.trackId) === trackId) return true;
  }

  return false;
}

export function isVideoBakeModifierPressed(event: Pick<MouseEvent | ReactMouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey;
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampScrollY(scrollY: number, contentHeight: number, viewportHeight: number): number {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maxScroll, scrollY));
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function getSectionScrollGlideDuration(distancePx: number): number {
  return clampValue(
    Math.abs(distancePx) / TRACK_SCROLL_GLIDE_PX_PER_MS,
    TRACK_SCROLL_GLIDE_MIN_MS,
    TRACK_SCROLL_GLIDE_MAX_MS,
  );
}

function getSectionScrollGestureStepCount(accumulatedDeltaY: number): number {
  if (accumulatedDeltaY === 0) return 0;
  return clampValue(
    Math.ceil(Math.abs(accumulatedDeltaY) / TRACK_SCROLL_STEP_DELTA_PX),
    1,
    TRACK_SCROLL_MAX_STEPS_PER_GESTURE,
  );
}

export function buildSectionScrollSnapPositions(
  tracks: TimelineTrack[],
  sectionKind: TrackSectionKind,
  viewportHeight: number,
  contentHeight: number,
  getTrackHeight: (track: TimelineTrack) => number,
): number[] {
  const maxScrollY = Math.max(0, contentHeight - viewportHeight);
  if (maxScrollY <= 0) return [0];

  const positions = [0, maxScrollY];
  let trackTop = 0;

  tracks.forEach((track) => {
    const trackHeight = Math.max(0, getTrackHeight(track));
    if (sectionKind === 'audio') {
      positions.push(trackTop);
    }

    trackTop += trackHeight;

    if (sectionKind === 'video') {
      positions.push(trackTop - viewportHeight);
    }
  });

  return Array.from(new Set(
    positions.map((position) => Math.round(clampScrollY(position, contentHeight, viewportHeight) * 100) / 100)
  )).sort((a, b) => a - b);
}

export function getSettledSectionScrollSnapPosition(
  startScrollY: number,
  accumulatedDeltaY: number,
  snapPositions: readonly number[],
  contentHeight: number,
  viewportHeight: number,
): number {
  const start = clampScrollY(startScrollY, contentHeight, viewportHeight);
  const stepCount = getSectionScrollGestureStepCount(accumulatedDeltaY);
  if (snapPositions.length <= 1 || stepCount === 0) return start;

  if (accumulatedDeltaY > 0) {
    let startIndex = 0;
    for (let index = snapPositions.length - 1; index >= 0; index--) {
      if (snapPositions[index] <= start + TRACK_SCROLL_SNAP_EPSILON_PX) {
        startIndex = index;
        break;
      }
    }

    return snapPositions[Math.min(snapPositions.length - 1, startIndex + stepCount)];
  }

  let startIndex = snapPositions.length - 1;
  for (let index = snapPositions.length - 1; index >= 0; index--) {
    if (snapPositions[index] < start - TRACK_SCROLL_SNAP_EPSILON_PX) {
      break;
    }
    startIndex = index;
  }

  return snapPositions[Math.max(0, startIndex - stepCount)];
}

export function getLiveSectionScrollY(
  currentScrollY: number,
  rawNextScrollY: number,
  targetScrollY: number,
  direction: number,
): number {
  const targetDistance = targetScrollY - currentScrollY;
  if (direction > 0 && targetDistance > 0 && rawNextScrollY > targetScrollY) {
    return currentScrollY + Math.max(1, targetDistance * TRACK_SCROLL_LIVE_TARGET_APPROACH);
  }

  if (direction < 0 && targetDistance < 0 && rawNextScrollY < targetScrollY) {
    return currentScrollY - Math.max(1, Math.abs(targetDistance) * TRACK_SCROLL_LIVE_TARGET_APPROACH);
  }

  return rawNextScrollY;
}

export function shouldIgnoreTimelineSurfaceToolTarget(target: EventTarget | null): boolean {
  // Use Element (not HTMLElement) so clicks that land on an SVG icon inside a
  // control — e.g. a tool-palette button's glyph — are still recognized as UI
  // targets. SVGElement is an Element and supports closest(); it is not an
  // HTMLElement, so an HTMLElement check would let hand/zoom pan-capture steal
  // the click and prevent the palette button from activating.
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest([
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="menuitem"]',
    '.timeline-ruler-control-strip',
    '.timeline-layer-divider-resize-handle',
    '.track-header',
    '.timeline-split-divider',
    '.playhead',
    '.timeline-marker',
    '.in-out-marker',
    '.timeline-context-menu',
    '.timeline-tool-flyout',
  ].join(',')));
}

export function getNormalizedWheelDeltaY(e: ReactWheelEvent, viewportHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * 40;
  if (e.deltaMode === 2) return e.deltaY * viewportHeight;
  return e.deltaY;
}

export function applyKeyframeAreaRevealScroll(
  currentScrollY: number,
  snapshot: KeyframeAreaRevealSnapshot,
): number {
  const viewportHeight = Math.max(0, snapshot.viewportHeight);
  if (viewportHeight <= 0 || snapshot.contentHeight <= viewportHeight) {
    return 0;
  }

  const padding = 10;
  const visibleTop = currentScrollY;
  const visibleBottom = currentScrollY + viewportHeight;
  const targetTop = Math.max(0, snapshot.keyframeAreaTop - padding);
  const targetBottom = Math.min(snapshot.contentHeight, snapshot.keyframeAreaBottom + padding);
  let nextScrollY = currentScrollY;

  if (targetBottom > visibleBottom) {
    nextScrollY = targetBottom - viewportHeight;
  }

  if (targetTop < visibleTop && targetBottom - targetTop <= viewportHeight) {
    nextScrollY = targetTop;
  }

  return clampScrollY(nextScrollY, snapshot.contentHeight, viewportHeight);
}

export function getTrackFocusModeForSplitPosition(videoHeight: number, availableHeight: number): TimelineTrackFocusMode {
  const edgeThreshold = Math.min(
    Math.max(COLLAPSED_TRACK_HEIGHT + 8, availableHeight * 0.12),
    SPLIT_FOCUS_EDGE_THRESHOLD_PX,
  );
  if (videoHeight <= edgeThreshold) return 'audio';
  if (availableHeight - videoHeight <= edgeThreshold) return 'video';
  return 'balanced';
}
