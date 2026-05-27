// useClipTrim - Clip edge trimming (in/out point adjustment)
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { isVectorAnimationSourceType, shouldLoopVectorAnimation } from '../../../types/vectorAnimation';
import type { ClipTrimState } from '../types';
import type { TimelineEditOperation, TimelineEditResult } from '../../../stores/timeline/editOperations/types';
import type { TimelineToolId, TimelineToolPreview, TimelineToolPreviewGhostRange } from '../../../stores/timeline/types';

const MIN_CLIP_DURATION = 0.1;
const EPSILON = 0.0001;

interface UseClipTrimProps {
  // Clip data
  clipMap: Map<string, TimelineClip>;
  tracks: TimelineTrack[];
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;

  // Actions
  selectClip: (clipId: string | null, addToSelection?: boolean) => void;
  applyTimelineEditOperation: (
    operation: TimelineEditOperation,
    options: { source: 'ui'; historyLabel?: string },
  ) => TimelineEditResult;
  setTimelineToolPreview: (preview: TimelineToolPreview | null) => void;

  // Helpers
  pixelToTime: (pixel: number) => number;
}

interface UseClipTrimReturn {
  clipTrim: ClipTrimState | null;
  clipTrimRef: React.MutableRefObject<ClipTrimState | null>;
  handleTrimStart: (e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => void;
}

function canLoopExtendVectorClip(clip: TimelineClip): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function isInfiniteTrimSource(clip: TimelineClip): boolean {
  const sourceType = clip.source?.type;
  return sourceType === 'text' ||
    sourceType === 'image' ||
    sourceType === 'solid' ||
    sourceType === 'camera' ||
    sourceType === 'splat-effector' ||
    sourceType === 'math-scene';
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function findPreviousClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  return (clips
    .filter((candidate) => candidate.trackId === clip.trackId && getClipEnd(candidate) <= clip.startTime + EPSILON)
    .toSorted((left, right) => getClipEnd(right) - getClipEnd(left)))[0] ?? null;
}

function findNextClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  return (clips
    .filter((candidate) => candidate.trackId === clip.trackId && candidate.startTime >= getClipEnd(clip) - EPSILON)
    .toSorted((left, right) => left.startTime - right.startTime))[0] ?? null;
}

function createGhostRange(
  clip: TimelineClip,
  startTime: number,
  endTime: number,
  variant: TimelineToolPreviewGhostRange['variant'],
  label?: string,
): TimelineToolPreviewGhostRange | null {
  const start = Math.max(0, Math.min(startTime, endTime));
  const end = Math.max(start + EPSILON, Math.max(startTime, endTime));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    id: `${clip.id}:${variant ?? 'ghost'}:${start.toFixed(4)}:${end.toFixed(4)}`,
    trackId: clip.trackId,
    startTime: start,
    endTime: end,
    variant,
    label,
  };
}

function resolveTrimDragTiming(clip: TimelineClip, trim: ClipTrimState, deltaTime: number) {
  const maxDuration = isInfiniteTrimSource(clip)
    ? Number.MAX_SAFE_INTEGER
    : (clip.source?.naturalDuration || clip.duration);

  let newStartTime = trim.originalStartTime;
  let newInPoint = trim.originalInPoint;
  let newOutPoint = trim.originalOutPoint;

  if (trim.edge === 'left') {
    const maxTrim = trim.originalDuration - MIN_CLIP_DURATION;
    const minTrim = isInfiniteTrimSource(clip)
      ? -trim.originalStartTime
      : -trim.originalInPoint;
    const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
    newStartTime = trim.originalStartTime + clampedDelta;
    newInPoint = trim.originalInPoint + clampedDelta;
  } else {
    const maxExtend = canLoopExtendVectorClip(clip)
      ? Number.MAX_SAFE_INTEGER
      : maxDuration - trim.originalOutPoint;
    const minTrim = -(trim.originalDuration - MIN_CLIP_DURATION);
    const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
    newOutPoint = trim.originalOutPoint + clampedDelta;
  }

  const edge = trim.edge === 'left' ? 'start' : 'end';
  const targetTime = edge === 'start'
    ? Math.max(0, newStartTime)
    : clip.startTime + (newOutPoint - clip.inPoint);

  return {
    edge,
    targetTime,
    newStartTime: Math.max(0, newStartTime),
    newInPoint,
    newOutPoint,
    newDuration: Math.max(MIN_CLIP_DURATION, newOutPoint - newInPoint),
  };
}

function addLinkedTrimGhost(
  ghostRanges: TimelineToolPreviewGhostRange[],
  clips: TimelineClip[],
  clip: TimelineClip,
  removedDuration: number,
  includeLinked: boolean,
  variant: TimelineToolPreviewGhostRange['variant'],
): TimelineClip | null {
  if (!includeLinked || !clip.linkedClipId) return null;
  const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId) ?? null;
  if (!linkedClip) return null;
  const ghost = createGhostRange(
    linkedClip,
    linkedClip.startTime,
    getClipEnd(linkedClip) - removedDuration,
    variant,
  );
  if (ghost) ghostRanges.push(ghost);
  return linkedClip;
}

function buildTrimToolPreview(
  trim: ClipTrimState,
  clipMap: Map<string, TimelineClip>,
  tracks: TimelineTrack[],
  activeTimelineToolId: TimelineToolId,
  pixelToTime: (pixel: number) => number,
): TimelineToolPreview | null {
  const clip = clipMap.get(trim.clipId);
  if (!clip) return null;

  const deltaTime = pixelToTime(trim.currentX - trim.startX);
  const timing = resolveTrimDragTiming(clip, trim, deltaTime);
  const clips = [...clipMap.values()];
  const previewToolId = activeTimelineToolId === 'select' ? 'edge-trim' : activeTimelineToolId;
  const includeLinked = !trim.altKey;
  const ghostRanges: TimelineToolPreviewGhostRange[] = [];

  if (activeTimelineToolId === 'ripple-trim') {
    const originalStart = clip.startTime;
    const originalEnd = getClipEnd(clip);
    const isValid = timing.edge === 'start'
      ? timing.targetTime > originalStart + EPSILON && timing.targetTime < originalEnd - MIN_CLIP_DURATION
      : timing.targetTime > originalStart + MIN_CLIP_DURATION && timing.targetTime < originalEnd - EPSILON;
    if (!isValid) {
      return {
        toolId: previewToolId,
        plane: 'section-scrolled',
        trackId: clip.trackId,
        clipId: clip.id,
        time: timing.targetTime,
        blocked: true,
        message: 'Ripple trim must stay inside the clip.',
      };
    }

    const removedDuration = timing.edge === 'start'
      ? timing.targetTime - originalStart
      : originalEnd - timing.targetTime;
    const targetGhost = createGhostRange(clip, originalStart, originalEnd - removedDuration, 'trim-target');
    if (targetGhost) ghostRanges.push(targetGhost);
    const linkedClip = addLinkedTrimGhost(ghostRanges, clips, clip, removedDuration, includeLinked, 'trim-target');

    const protectedClipIds = new Set([clip.id, ...(linkedClip ? [linkedClip.id] : [])]);
    const rippleTrackIds = new Set([clip.trackId, ...(linkedClip ? [linkedClip.trackId] : [])]);
    for (const candidate of clips) {
      if (!rippleTrackIds.has(candidate.trackId) || protectedClipIds.has(candidate.id)) continue;
      if (candidate.startTime < originalEnd - EPSILON || isTrackLocked(tracks, candidate.trackId)) continue;
      const shiftedGhost = createGhostRange(
        candidate,
        candidate.startTime - removedDuration,
        getClipEnd(candidate) - removedDuration,
        'ripple-shift',
      );
      if (shiftedGhost) ghostRanges.push(shiftedGhost);
    }
  } else if (activeTimelineToolId === 'rolling-edit') {
    const pair = timing.edge === 'start'
      ? { left: findPreviousClip(clips, clip), right: clip }
      : { left: clip, right: findNextClip(clips, clip) };
    if (!pair.left || !pair.right) {
      return {
        toolId: previewToolId,
        plane: 'section-scrolled',
        trackId: clip.trackId,
        clipId: clip.id,
        time: timing.targetTime,
        blocked: true,
        message: 'Rolling edit needs an adjacent clip.',
      };
    }

    const leftDuration = timing.targetTime - pair.left.startTime;
    const rightDuration = getClipEnd(pair.right) - timing.targetTime;
    if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) {
      return {
        toolId: previewToolId,
        plane: 'section-scrolled',
        trackId: clip.trackId,
        clipId: clip.id,
        time: timing.targetTime,
        blocked: true,
        message: 'Rolling edit would make a clip too short.',
      };
    }

    const leftGhost = createGhostRange(pair.left, pair.left.startTime, timing.targetTime, 'rolling-neighbor');
    const rightGhost = createGhostRange(pair.right, timing.targetTime, getClipEnd(pair.right), 'rolling-neighbor');
    if (leftGhost) ghostRanges.push(leftGhost);
    if (rightGhost) ghostRanges.push(rightGhost);
  } else if (activeTimelineToolId === 'rate-stretch') {
    const ghost = createGhostRange(
      clip,
      timing.edge === 'start' ? timing.targetTime : clip.startTime,
      timing.edge === 'start' ? getClipEnd(clip) : timing.targetTime,
      'rate-stretch',
    );
    if (ghost) ghostRanges.push(ghost);
  } else {
    const ghost = createGhostRange(
      clip,
      timing.newStartTime,
      timing.newStartTime + timing.newDuration,
      'trim-target',
    );
    if (ghost) ghostRanges.push(ghost);
  }

  if (ghostRanges.length === 0) return null;
  return {
    toolId: previewToolId,
    plane: 'section-scrolled',
    trackId: clip.trackId,
    clipId: clip.id,
    time: timing.targetTime,
    ghostRanges,
  };
}

export function useClipTrim({
  clipMap,
  tracks,
  isExporting,
  activeTimelineToolId,
  selectClip,
  applyTimelineEditOperation,
  setTimelineToolPreview,
  pixelToTime,
}: UseClipTrimProps): UseClipTrimReturn {
  const [clipTrim, setClipTrim] = useState<ClipTrimState | null>(null);
  const clipTrimRef = useRef<ClipTrimState | null>(clipTrim);

  useEffect(() => {
    clipTrimRef.current = clipTrim;
  }, [clipTrim]);

  const handleTrimStart = useCallback(
    (e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      if (isExporting) return;

      const clip = clipMap.get(clipId);
      if (!clip) return;
      const isClipLocked = (candidate: TimelineClip): boolean =>
        tracks.find(track => track.id === candidate.trackId)?.locked === true;
      if (isClipLocked(clip)) return;
      if (!e.altKey && clip.linkedClipId) {
        const linkedClip = clipMap.get(clip.linkedClipId);
        if (linkedClip && isClipLocked(linkedClip)) return;
      }

      selectClip(clipId);

      const initialTrim: ClipTrimState = {
        clipId,
        edge,
        originalStartTime: clip.startTime,
        originalDuration: clip.duration,
        originalInPoint: clip.inPoint,
        originalOutPoint: clip.outPoint,
        startX: e.clientX,
        currentX: e.clientX,
        altKey: e.altKey,
      };
      setClipTrim(initialTrim);
      clipTrimRef.current = initialTrim;
      setTimelineToolPreview(buildTrimToolPreview(initialTrim, clipMap, tracks, activeTimelineToolId, pixelToTime));

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newTrim = clipTrimRef.current;
        if (!newTrim) return;
        const updated = {
          ...newTrim,
          currentX: moveEvent.clientX,
          altKey: moveEvent.altKey,
        };
        setClipTrim(updated);
        clipTrimRef.current = updated;
        setTimelineToolPreview(buildTrimToolPreview(updated, clipMap, tracks, activeTimelineToolId, pixelToTime));
      };

      const handleMouseUp = () => {
        const trim = clipTrimRef.current;
        if (!trim) {
          setClipTrim(null);
          clipTrimRef.current = null;
          setTimelineToolPreview(null);
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          return;
        }

        const clipToTrim = clipMap.get(trim.clipId);
        if (!clipToTrim) {
          setClipTrim(null);
          clipTrimRef.current = null;
          setTimelineToolPreview(null);
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          return;
        }

        const deltaX = trim.currentX - trim.startX;
        const deltaTime = pixelToTime(deltaX);

        // Generated clips can be extended infinitely (no natural duration limit)
        const sourceType = clipToTrim.source?.type;
        const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'math-scene';
        const canLoopExtendRight = canLoopExtendVectorClip(clipToTrim);
        const maxDuration = isInfiniteClip
          ? Number.MAX_SAFE_INTEGER
          : (clipToTrim.source?.naturalDuration || clipToTrim.duration);

        let newStartTime = trim.originalStartTime;
        let newInPoint = trim.originalInPoint;
        let newOutPoint = trim.originalOutPoint;

        if (trim.edge === 'left') {
          const maxTrim = trim.originalDuration - 0.1;
          // For infinite clips (text/image), allow extending left up to timeline start (0)
          // For video/audio, limit to existing in-point (can't reveal non-existent media)
          const minTrim = isInfiniteClip
            ? -trim.originalStartTime  // Can extend left until startTime reaches 0
            : -trim.originalInPoint;
          const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
          newStartTime = trim.originalStartTime + clampedDelta;
          newInPoint = trim.originalInPoint + clampedDelta;
        } else {
          const maxExtend = canLoopExtendRight
            ? Number.MAX_SAFE_INTEGER
            : maxDuration - trim.originalOutPoint;
          const minTrim = -(trim.originalDuration - 0.1);
          const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
          newOutPoint = trim.originalOutPoint + clampedDelta;
        }

        const edge = trim.edge === 'left' ? 'start' : 'end';
        const targetTime = trim.edge === 'left' ? Math.max(0, newStartTime) : clipToTrim.startTime + (newOutPoint - clipToTrim.inPoint);
        const includeLinked = !trim.altKey;

        if (activeTimelineToolId === 'ripple-trim') {
          applyTimelineEditOperation({
            id: `ripple-trim:${clipToTrim.id}:${edge}:${targetTime}`,
            type: 'ripple-trim-edge-to-time',
            clipIds: [clipToTrim.id],
            edge,
            time: targetTime,
            includeLinked,
          }, { source: 'ui', historyLabel: 'Ripple trim' });
        } else if (activeTimelineToolId === 'rolling-edit') {
          applyTimelineEditOperation({
            id: `rolling-edit:${clipToTrim.id}:${edge}:${targetTime}`,
            type: 'rolling-edit',
            clipId: clipToTrim.id,
            edge,
            time: targetTime,
            includeLinked,
          }, { source: 'ui', historyLabel: 'Rolling edit' });
        } else if (activeTimelineToolId === 'rate-stretch') {
          applyTimelineEditOperation({
            id: `rate-stretch:${clipToTrim.id}:${edge}:${targetTime}`,
            type: 'rate-stretch-clip',
            clipId: clipToTrim.id,
            edge,
            time: targetTime,
            includeLinked,
          }, { source: 'ui', historyLabel: 'Rate stretch clip' });
        } else {
          applyTimelineEditOperation({
            id: `edge-trim:${clipToTrim.id}:${edge}:${targetTime}`,
            type: 'trim-clip',
            clipId: clipToTrim.id,
            inPoint: newInPoint,
            outPoint: newOutPoint,
            ...(trim.edge === 'left' ? { startTime: Math.max(0, newStartTime) } : {}),
            includeLinked,
          }, { source: 'ui', historyLabel: 'Trim clip edge' });
        }

        setClipTrim(null);
        clipTrimRef.current = null;
        setTimelineToolPreview(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [activeTimelineToolId, applyTimelineEditOperation, clipMap, tracks, isExporting, pixelToTime, selectClip, setTimelineToolPreview]
  );

  return {
    clipTrim,
    clipTrimRef,
    handleTrimStart,
  };
}
