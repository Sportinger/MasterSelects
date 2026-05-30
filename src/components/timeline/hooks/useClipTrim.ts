// useClipTrim - Clip edge trimming (in/out point adjustment)
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { isVectorAnimationSourceType, shouldLoopVectorAnimation } from '../../../types/vectorAnimation';
import type { ClipTrimState } from '../types';
import type { TimelineEditOperation, TimelineEditResult } from '../../../stores/timeline/editOperations/types';
import type { TimelineToolId, TimelineToolPreview, TimelineToolPreviewGhostRange } from '../../../stores/timeline/types';
import { LAYER_BUILDER_CONSTANTS } from '../../../services/layerBuilder/types';

const MIN_CLIP_DURATION = 0.1;
const EPSILON = 0.0001;
// Pixel radius within which a trim edge snaps to a clip edge / playhead / marker.
const TRIM_SNAP_PIXELS = 12;

interface TrimOriginals {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

interface TrimSnapContext {
  enabled: boolean;
  times: number[];
  threshold: number;
}

interface UseClipTrimProps {
  // Clip data
  clipMap: Map<string, TimelineClip>;
  tracks: TimelineTrack[];
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;

  // Selection + snapping context
  selectedClipIds: Set<string>;
  snappingEnabled: boolean;
  playheadPosition: number;
  markers?: ReadonlyArray<{ time: number }>;

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

function isAudioClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio';
}

// Snap targets for a trim edge: every other clip's edges, the playhead, markers,
// and the timeline start. The dragged clip's own edges are excluded.
function getTrimSnapTimes(
  clipMap: Map<string, TimelineClip>,
  draggedClipId: string,
  playheadPosition: number,
  markers: ReadonlyArray<{ time: number }> | undefined,
): number[] {
  const times: number[] = [0, playheadPosition];
  for (const candidate of clipMap.values()) {
    if (candidate.id === draggedClipId) continue;
    times.push(candidate.startTime, candidate.startTime + candidate.duration);
  }
  if (markers) {
    for (const marker of markers) times.push(marker.time);
  }
  return times;
}

// Turn a raw drag delta into the applied delta: first snap the resulting edge to
// nearby targets (clips/playhead/markers), else quantize to a frame boundary for
// visual clips. Audio stays continuous (sample-accurate). Alt suppresses snapping.
interface TrimDeltaResult {
  delta: number;
  // The clip/playhead/marker time the edge snapped to (for the green snap line),
  // or null when frame-snapped or not snapped.
  snapTime: number | null;
}

function adjustTrimDelta(
  trim: ClipTrimState,
  rawDelta: number,
  isAudio: boolean,
  snap: TrimSnapContext,
): TrimDeltaResult {
  const originalEdge = trim.edge === 'left'
    ? trim.originalStartTime
    : trim.originalStartTime + trim.originalDuration;
  const desiredEdge = originalEdge + rawDelta;

  if (snap.enabled && !trim.altKey && snap.threshold > 0) {
    let best: number | null = null;
    let bestDist = snap.threshold;
    for (const target of snap.times) {
      const dist = Math.abs(desiredEdge - target);
      if (dist <= bestDist) {
        bestDist = dist;
        best = target;
      }
    }
    if (best !== null) return { delta: best - originalEdge, snapTime: best };
  }

  if (!isAudio) {
    const fps = LAYER_BUILDER_CONSTANTS.FRAME_RATE;
    const snappedEdge = Math.round(desiredEdge * fps) / fps;
    return { delta: snappedEdge - originalEdge, snapTime: null };
  }

  return { delta: rawDelta, snapTime: null };
}

// Clamp a trim delta to a clip's own bounds and return the resulting timing.
// Works for any clip from its current state, so multi-select followers each clamp
// independently ("only as much as each clip can").
function computeTrimTiming(
  clip: TimelineClip,
  edge: 'left' | 'right',
  orig: TrimOriginals,
  deltaTime: number,
) {
  const maxDuration = isInfiniteTrimSource(clip)
    ? Number.MAX_SAFE_INTEGER
    : (clip.source?.naturalDuration || orig.duration);

  let newStartTime = orig.startTime;
  let newInPoint = orig.inPoint;
  let newOutPoint = orig.outPoint;

  if (edge === 'left') {
    const maxTrim = orig.duration - MIN_CLIP_DURATION;
    const minTrim = isInfiniteTrimSource(clip)
      ? -orig.startTime
      : -orig.inPoint;
    const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
    newStartTime = orig.startTime + clampedDelta;
    newInPoint = orig.inPoint + clampedDelta;
  } else {
    const maxExtend = canLoopExtendVectorClip(clip)
      ? Number.MAX_SAFE_INTEGER
      : maxDuration - orig.outPoint;
    const minTrim = -(orig.duration - MIN_CLIP_DURATION);
    const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
    newOutPoint = orig.outPoint + clampedDelta;
  }

  const resultEdge: 'start' | 'end' = edge === 'left' ? 'start' : 'end';
  const targetTime = resultEdge === 'start'
    ? Math.max(0, newStartTime)
    : clip.startTime + (newOutPoint - clip.inPoint);

  return {
    edge: resultEdge,
    targetTime,
    newStartTime: Math.max(0, newStartTime),
    newInPoint,
    newOutPoint,
    newDuration: Math.max(MIN_CLIP_DURATION, newOutPoint - newInPoint),
  };
}

function trimOriginalsFromClip(clip: TimelineClip): TrimOriginals {
  return {
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
  };
}

function resolveTrimDragTiming(clip: TimelineClip, trim: ClipTrimState, deltaTime: number) {
  return computeTrimTiming(clip, trim.edge, {
    startTime: trim.originalStartTime,
    duration: trim.originalDuration,
    inPoint: trim.originalInPoint,
    outPoint: trim.originalOutPoint,
  }, deltaTime);
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
  computeDelta: (trim: ClipTrimState, rawDelta: number, clip: TimelineClip) => TrimDeltaResult,
): TimelineToolPreview | null {
  const clip = clipMap.get(trim.clipId);
  if (!clip) return null;

  const deltaTime = computeDelta(trim, pixelToTime(trim.currentX - trim.startX), clip).delta;
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
  }
  // Default edge-trim shows no blue ghost: the clips themselves resize live
  // (yellow), including every selected clip during a multi-trim.

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
  selectedClipIds,
  snappingEnabled,
  playheadPosition,
  markers,
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

  // Convert a raw drag delta into the applied delta (snap to clips/playhead/markers,
  // else frame-quantize visual clips; audio stays continuous). Shared by the live
  // preview and the commit so both agree on where the edge lands.
  const computeAdjustedDelta = useCallback(
    (trim: ClipTrimState, rawDelta: number, clip: TimelineClip): TrimDeltaResult => {
      const snapTimes = getTrimSnapTimes(clipMap, trim.clipId, playheadPosition, markers);
      const threshold = Math.abs(pixelToTime(TRIM_SNAP_PIXELS));
      return adjustTrimDelta(trim, rawDelta, isAudioClip(clip), {
        enabled: snappingEnabled,
        times: snapTimes,
        threshold,
      });
    },
    [clipMap, playheadPosition, markers, pixelToTime, snappingEnabled],
  );

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

      // Preserve an existing multi-selection when grabbing one of its clips, so
      // the whole selection trims together. Grabbing an unselected clip selects
      // just that one (single-clip trim).
      if (!selectedClipIds.has(clipId)) {
        selectClip(clipId);
      }

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
        snapIndicatorTime: null,
        isSnapping: false,
        appliedDelta: 0,
      };
      setClipTrim(initialTrim);
      clipTrimRef.current = initialTrim;
      setTimelineToolPreview(buildTrimToolPreview(initialTrim, clipMap, tracks, activeTimelineToolId, pixelToTime, computeAdjustedDelta));

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newTrim = clipTrimRef.current;
        if (!newTrim) return;
        const base = {
          ...newTrim,
          currentX: moveEvent.clientX,
          altKey: moveEvent.altKey,
        };
        // Resolve the snapped delta once: drives the green snap line AND the live
        // clip resize (shared so the preview matches where the trim commits).
        const clipForSnap = clipMap.get(base.clipId);
        const adjusted = clipForSnap
          ? computeAdjustedDelta(base, pixelToTime(base.currentX - base.startX), clipForSnap)
          : { delta: pixelToTime(base.currentX - base.startX), snapTime: null };
        const updated: ClipTrimState = {
          ...base,
          snapIndicatorTime: adjusted.snapTime,
          isSnapping: adjusted.snapTime !== null,
          appliedDelta: adjusted.delta,
        };
        setClipTrim(updated);
        clipTrimRef.current = updated;
        setTimelineToolPreview(buildTrimToolPreview(updated, clipMap, tracks, activeTimelineToolId, pixelToTime, computeAdjustedDelta));
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

        const rawDelta = pixelToTime(trim.currentX - trim.startX);
        const deltaTime = computeAdjustedDelta(trim, rawDelta, clipToTrim).delta;

        const timing = resolveTrimDragTiming(clipToTrim, trim, deltaTime);
        const edge = timing.edge;
        const targetTime = timing.targetTime;
        const newStartTime = timing.newStartTime;
        const newInPoint = timing.newInPoint;
        const newOutPoint = timing.newOutPoint;
        const includeLinked = !trim.altKey;

        // Multi-select trim: apply the lead clip's (snapped) delta to every other
        // selected clip, each clamped to its own bounds ("only as much as each can").
        const extraClips: NonNullable<Extract<TimelineEditOperation, { type: 'trim-clip' }>['extraClips']> = [];
        if (selectedClipIds.size > 1 && selectedClipIds.has(clipToTrim.id)) {
          for (const otherId of selectedClipIds) {
            if (otherId === clipToTrim.id) continue;
            const otherClip = clipMap.get(otherId);
            if (!otherClip) continue;
            const otherTiming = computeTrimTiming(otherClip, trim.edge, trimOriginalsFromClip(otherClip), deltaTime);
            extraClips.push({
              clipId: otherClip.id,
              inPoint: otherTiming.newInPoint,
              outPoint: otherTiming.newOutPoint,
              ...(trim.edge === 'left' ? { startTime: otherTiming.newStartTime } : {}),
            });
          }
        }

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
            ...(extraClips.length > 0 ? { extraClips } : {}),
          }, { source: 'ui', historyLabel: extraClips.length > 0 ? 'Trim clips' : 'Trim clip edge' });
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
    [activeTimelineToolId, applyTimelineEditOperation, clipMap, tracks, isExporting, pixelToTime, selectClip, setTimelineToolPreview, computeAdjustedDelta, selectedClipIds]
  );

  return {
    clipTrim,
    clipTrimRef,
    handleTrimStart,
  };
}
