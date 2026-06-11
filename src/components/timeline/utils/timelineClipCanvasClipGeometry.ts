// Clip geometry resolution for the canvas clip renderer (issue #228). Pure
// functions extracted from TimelineClipCanvas so the canvas host stays a thin
// orchestrator: they fold the live drag/slip/trim interaction state into the
// paint-time start/duration/in/out for each clip.

import type { TimelineClipDragPreview } from '../../../stores/timeline/types';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { MIN_CLIP_DURATION } from '../timelineRenderConstants';
import type { ClipDragState, ClipTrimState } from '../types';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
  isInfiniteTimelineSourceType,
} from './clipSourceTiming';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';

export interface TimelineClipCanvasGeometryInput {
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  trackId: string;
}

export function resolveClipGeometry(
  clip: TimelinePaintSourceClip,
  props: TimelineClipCanvasGeometryInput,
): TimelineClipCanvasTrimGeometry {
  const { clipDrag, clipDragPreview, clipTrim, trackId } = props;
  let startTime = clip.startTime;
  let duration = clip.duration;
  let inPoint = clip.inPoint ?? 0;
  let outPoint = clip.outPoint ?? inPoint + duration;
  let visible = clip.trackId === trackId;
  let trimEdge: 'left' | 'right' | undefined;
  const sourceDuration = getTimelineClipSourceDuration(clip);
  const dragPreviewPatch = clipDragPreview?.patches[clip.id];
  const isPrimaryDragClip = clipDrag?.clipId === clip.id;
  const isLinkedSlipClip = Boolean(
    clipDrag?.toolGesture === 'slip' &&
      !clipDrag.altKeyPressed &&
      clip.linkedClipId === clipDrag.clipId,
  );

  if (isPrimaryDragClip) {
    visible = clipDrag.currentTrackId === trackId;
    const previewStartTime = dragPreviewPatch ? Math.max(0, dragPreviewPatch.startTime) : startTime;
    startTime = clipDrag.snappedTime !== null ? clipDrag.snappedTime : previewStartTime;
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    startTime = Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta);
  } else if (dragPreviewPatch) {
    startTime = Math.max(0, dragPreviewPatch.startTime);
    visible = (dragPreviewPatch.trackId ?? clip.trackId) === trackId;
  }

  if (
    clipDrag?.toolGesture === 'slip' &&
    (isPrimaryDragClip || isLinkedSlipClip) &&
    typeof clipDrag.sourceTimeDelta === 'number'
  ) {
    const visibleSourceDuration = Math.max(0.001, outPoint - inPoint);
    const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
    const nextInPoint = Math.max(0, Math.min(maxInPoint, inPoint + clipDrag.sourceTimeDelta));
    inPoint = nextInPoint;
    outPoint = nextInPoint + visibleSourceDuration;
  }

  if (clipTrim?.clipId === clip.id) {
    trimEdge = clipTrim.edge;
    const deltaTime = clipTrim.appliedDelta;
    const sourceType = clip.source?.type;
    const isInfiniteClip = isInfiniteTimelineSourceType(sourceType);
    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - MIN_CLIP_DURATION;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      startTime = clipTrim.originalStartTime + clampedDelta;
      duration = clipTrim.originalDuration - clampedDelta;
      inPoint = clipTrim.originalInPoint + clampedDelta;
      outPoint = clipTrim.originalOutPoint;
    } else {
      const maxExtend = isInfiniteClip || canLoopExtendTimelineVectorClip(clip)
        ? Number.MAX_SAFE_INTEGER
        : sourceDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      startTime = clipTrim.originalStartTime;
      duration = clipTrim.originalDuration + clampedDelta;
      inPoint = clipTrim.originalInPoint;
      outPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  }

  return {
    startTime,
    duration: Math.max(0.001, duration),
    inPoint,
    outPoint,
    visible,
    trimEdge,
    originalStartTime: clip.startTime,
    originalEndTime: clip.startTime + clip.duration,
    sourceDuration,
  };
}

export function createWorkerDrawableClips(
  clips: readonly TimelinePaintSourceClip[],
  props: TimelineClipCanvasGeometryInput,
): readonly TimelinePaintSourceClip[] {
  const drawableClips: TimelinePaintSourceClip[] = [];
  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    drawableClips.push({
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    });
  }
  return drawableClips;
}
