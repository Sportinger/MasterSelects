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

export function isTimelineClipCanvasTrimPreviewClip(
  clip: Pick<TimelinePaintSourceClip, 'id' | 'linkedClipId'>,
  clipTrim?: ClipTrimState | null,
): boolean {
  if (!clipTrim) return false;
  const includeLinked = clipTrim.singleClip === true ? false : clipTrim.includeLinked === true;
  return clip.id === clipTrim.clipId || (includeLinked && clip.linkedClipId === clipTrim.clipId);
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
  const dragTimelineDelta = clipDrag && clipDrag.snappedTime !== null
    ? clipDrag.snappedTime - clipDrag.originalStartTime
    : null;
  const movesWithDirectDrag = Boolean(
    clipDrag &&
      dragTimelineDelta !== null &&
      !clipDrag.altKeyPressed &&
      !isPrimaryDragClip &&
      (
        clipDrag.multiSelectClipIds?.includes(clip.id) ||
        clip.linkedClipId === clipDrag.clipId ||
        clip.id === clipDrag.linkedClipId ||
        (clipDrag.linkedGroupId && clip.linkedGroupId === clipDrag.linkedGroupId)
      ),
  );
  const isLinkedSlipClip = Boolean(
    clipDrag?.toolGesture === 'slip' &&
      !clipDrag.altKeyPressed &&
      (clip.linkedClipId === clipDrag.clipId || clip.id === clipDrag.linkedClipId),
  );

  if (isPrimaryDragClip) {
    visible = clipDrag.currentTrackId === trackId;
    const previewStartTime = dragPreviewPatch ? Math.max(0, dragPreviewPatch.startTime) : startTime;
    startTime = clipDrag.snappedTime !== null ? clipDrag.snappedTime : previewStartTime;
  } else if (movesWithDirectDrag) {
    startTime = Math.max(0, clip.startTime + (clipDrag?.multiSelectClipIds?.includes(clip.id)
      ? clipDrag.multiSelectTimeDelta ?? dragTimelineDelta ?? 0
      : dragTimelineDelta ?? 0));
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

  if (clipTrim && isTimelineClipCanvasTrimPreviewClip(clip, clipTrim)) {
    trimEdge = clipTrim.edge;
    const deltaTime = clipTrim.appliedDelta;
    const isPrimaryTrimClip = clip.id === clipTrim.clipId;
    const originalStartTime = isPrimaryTrimClip ? clipTrim.originalStartTime : clip.startTime;
    const originalDuration = isPrimaryTrimClip ? clipTrim.originalDuration : clip.duration;
    const originalInPoint = isPrimaryTrimClip ? clipTrim.originalInPoint : inPoint;
    const originalOutPoint = isPrimaryTrimClip ? clipTrim.originalOutPoint : outPoint;
    const sourceType = clip.source?.type;
    const isInfiniteClip = isInfiniteTimelineSourceType(sourceType);
    if (clipTrim.edge === 'left') {
      const maxTrim = originalDuration - MIN_CLIP_DURATION;
      const minTrim = isInfiniteClip
        ? -originalStartTime
        : -originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      startTime = originalStartTime + clampedDelta;
      duration = originalDuration - clampedDelta;
      inPoint = originalInPoint + clampedDelta;
      outPoint = originalOutPoint;
    } else {
      const maxExtend = isInfiniteClip || canLoopExtendTimelineVectorClip(clip)
        ? Number.MAX_SAFE_INTEGER
        : sourceDuration - originalOutPoint;
      const minTrim = -(originalDuration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      startTime = originalStartTime;
      duration = originalDuration + clampedDelta;
      inPoint = originalInPoint;
      outPoint = originalOutPoint + clampedDelta;
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

export function createWorkerDrawableClips<TClip extends TimelinePaintSourceClip>(
  clips: readonly TClip[],
  props: TimelineClipCanvasGeometryInput,
): readonly TClip[] {
  const drawableClips: TClip[] = [];
  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    drawableClips.push({
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    } as TClip);
  }
  return drawableClips;
}
