// useClipTrim - Clip edge trimming (in/out point adjustment)
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipTrimState } from '../types';
import type { TimelineEditOperation, TimelineEditResult } from '../../../stores/timeline/editOperations/types';
import type { TimelineToolId, TimelineToolPreview, TimelineToolPreviewGhostRange } from '../../../stores/timeline/types';
import { MIN_CLIP_DURATION } from '../timelineRenderConstants';
import { computeTrimTiming, trimOriginalsFromClip } from '../utils/clipTrimTiming';
import { createTimelineMouseMoveScheduler } from '../utils/clipDragMouseMoveScheduler';
import { isTimelineSnappingActive } from '../utils/timelineSnappingModifiers';
import { isFrameLockedClip, quantizeTimeToFrame } from '../../../utils/timelineFrameQuantization';

const EPSILON = 0.0001;
// Pixel radius within which a trim edge snaps to a clip edge / playhead / marker.
const TRIM_SNAP_PIXELS = 12;

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
  frameRate: number;
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

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
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
// visual clips and linked audio. Only unlinked audio/MIDI stays continuous.
interface TrimDeltaResult {
  delta: number;
  // The clip/playhead/marker time the edge snapped to (for the green snap line),
  // or null when frame-snapped or not snapped.
  snapTime: number | null;
}

function adjustTrimDelta(
  trim: ClipTrimState,
  rawDelta: number,
  frameLocked: boolean,
  frameRate: number,
  snap: TrimSnapContext,
): TrimDeltaResult {
  const originalEdge = trim.edge === 'left'
    ? trim.originalStartTime
    : trim.originalStartTime + trim.originalDuration;
  const desiredEdge = originalEdge + rawDelta;

  if (snap.enabled && snap.threshold > 0) {
    let best: number | null = null;
    let bestDist = snap.threshold;
    for (const target of snap.times) {
      const dist = Math.abs(desiredEdge - target);
      if (dist <= bestDist) {
        bestDist = dist;
        best = target;
      }
    }
    if (best !== null) {
      const resolvedEdge = frameLocked ? quantizeTimeToFrame(best, frameRate) : best;
      return { delta: resolvedEdge - originalEdge, snapTime: resolvedEdge };
    }
  }

  if (frameLocked) {
    const snappedEdge = quantizeTimeToFrame(desiredEdge, frameRate);
    return { delta: snappedEdge - originalEdge, snapTime: null };
  }

  return { delta: rawDelta, snapTime: null };
}

export function shouldIncludeLinkedTrim(
  clip: Pick<TimelineClip, 'id' | 'linkedClipId'>,
  selectedClipIds: Set<string>,
  singleClip = false,
): boolean {
  if (singleClip) return false;
  if (!clip.linkedClipId) return false;
  if (!selectedClipIds.has(clip.id)) return true;
  return selectedClipIds.has(clip.linkedClipId);
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
  if (
    activeTimelineToolId !== 'ripple-trim' &&
    activeTimelineToolId !== 'rolling-edit' &&
    activeTimelineToolId !== 'rate-stretch'
  ) return null;

  const clip = clipMap.get(trim.clipId);
  if (!clip) return null;

  const deltaTime = computeDelta(trim, pixelToTime(trim.currentX - trim.startX), clip).delta;
  const timing = resolveTrimDragTiming(clip, trim, deltaTime);
  const clips = [...clipMap.values()];
  const previewToolId = activeTimelineToolId;
  const includeLinked = trim.singleClip === true ? false : trim.includeLinked === true;
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
  frameRate,
  markers,
  selectClip,
  applyTimelineEditOperation,
  setTimelineToolPreview,
  pixelToTime,
}: UseClipTrimProps): UseClipTrimReturn {
  const [clipTrim, setClipTrim] = useState<ClipTrimState | null>(null);
  const clipTrimRef = useRef<ClipTrimState | null>(clipTrim);
  const playheadPositionRef = useRef(playheadPosition);
  playheadPositionRef.current = playheadPosition;

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
      const activePointerId = 'pointerId' in e.nativeEvent
        ? (e.nativeEvent as PointerEvent).pointerId
        : null;
      const isClipLocked = (candidate: TimelineClip): boolean =>
        tracks.find(track => track.id === candidate.trackId)?.locked === true;
      if (isClipLocked(clip)) return;
      const initialIncludeLinked = shouldIncludeLinkedTrim(clip, selectedClipIds);
      if (initialIncludeLinked && clip.linkedClipId) {
        const linkedClip = clipMap.get(clip.linkedClipId);
        if (linkedClip && isClipLocked(linkedClip)) return;
      }

      const trimSnapTimes = getTrimSnapTimes(
        clipMap,
        clipId,
        playheadPositionRef.current,
        markers,
      );
      const trimSnapThreshold = Math.abs(pixelToTime(TRIM_SNAP_PIXELS));
      const computeGestureAdjustedDelta = (
        trim: ClipTrimState,
        rawDelta: number,
        trimClip: TimelineClip,
      ): TrimDeltaResult => adjustTrimDelta(
        trim,
        rawDelta,
        isFrameLockedClip(trimClip),
        frameRate,
        {
          enabled: isTimelineSnappingActive(snappingEnabled, {
            altKey: trim.altKey,
            shiftKey: trim.shiftKey === true,
          }),
          times: trimSnapTimes,
          threshold: trimSnapThreshold,
        },
      );
      const publishesToolPreview = activeTimelineToolId === 'ripple-trim' ||
        activeTimelineToolId === 'rolling-edit' ||
        activeTimelineToolId === 'rate-stretch';

      // Preserve an existing multi-selection when grabbing one of its clips.
      // Grabbing an unselected linked clip uses linked trim by default, then
      // selects the direct clip for the rest of the gesture.
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
        shiftKey: e.shiftKey,
        includeLinked: initialIncludeLinked,
        snapIndicatorTime: null,
        isSnapping: false,
        appliedDelta: 0,
      };
      setClipTrim(initialTrim);
      clipTrimRef.current = initialTrim;
      if (publishesToolPreview) {
        setTimelineToolPreview(buildTrimToolPreview(
          initialTrim,
          clipMap,
          tracks,
          activeTimelineToolId,
          pixelToTime,
          computeGestureAdjustedDelta,
        ));
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newTrim = clipTrimRef.current;
        if (!newTrim) return;
        const base = {
          ...newTrim,
          currentX: moveEvent.clientX,
          altKey: moveEvent.altKey,
          shiftKey: moveEvent.shiftKey,
        };
        // Resolve the snapped delta once: drives the green snap line AND the live
        // clip resize (shared so the preview matches where the trim commits).
        const clipForSnap = clipMap.get(base.clipId);
        const includeLinked = clipForSnap ? shouldIncludeLinkedTrim(clipForSnap, selectedClipIds, base.singleClip === true) : false;
        const adjusted = clipForSnap
          ? computeGestureAdjustedDelta(base, pixelToTime(base.currentX - base.startX), clipForSnap)
          : { delta: pixelToTime(base.currentX - base.startX), snapTime: null };
        const updated: ClipTrimState = {
          ...base,
          snapIndicatorTime: adjusted.snapTime,
          isSnapping: adjusted.snapTime !== null,
          includeLinked,
          appliedDelta: adjusted.delta,
        };
        setClipTrim(updated);
        clipTrimRef.current = updated;
        if (publishesToolPreview) {
          setTimelineToolPreview(buildTrimToolPreview(
            updated,
            clipMap,
            tracks,
            activeTimelineToolId,
            pixelToTime,
            computeGestureAdjustedDelta,
          ));
        }
      };

      const mouseMoveScheduler = createTimelineMouseMoveScheduler(handleMouseMove);

      const cleanupListeners = () => {
        mouseMoveScheduler.clear();
        if (activePointerId === null) {
          document.removeEventListener('mousemove', mouseMoveScheduler.handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        } else {
          document.removeEventListener('pointermove', handlePointerMove);
          document.removeEventListener('pointerup', handlePointerUp);
          document.removeEventListener('pointercancel', handlePointerCancel);
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        mouseMoveScheduler.flushPendingMouseMove();
        handleMouseMove(upEvent);
        const trim = clipTrimRef.current;
        if (!trim) {
          setClipTrim(null);
          clipTrimRef.current = null;
          setTimelineToolPreview(null);
          cleanupListeners();
          return;
        }

        const clipToTrim = clipMap.get(trim.clipId);
        if (!clipToTrim) {
          setClipTrim(null);
          clipTrimRef.current = null;
          setTimelineToolPreview(null);
          cleanupListeners();
          return;
        }

        const commitTrim: ClipTrimState = {
          ...trim,
          altKey: upEvent.altKey,
          shiftKey: upEvent.shiftKey,
        };
        const rawDelta = pixelToTime(commitTrim.currentX - commitTrim.startX);
        const deltaTime = computeGestureAdjustedDelta(commitTrim, rawDelta, clipToTrim).delta;

        const timing = resolveTrimDragTiming(clipToTrim, commitTrim, deltaTime);
        const edge = timing.edge;
        const targetTime = timing.targetTime;
        const newStartTime = timing.newStartTime;
        const newInPoint = timing.newInPoint;
        const newOutPoint = timing.newOutPoint;
        const singleClip = commitTrim.singleClip === true;
        const includeLinked = shouldIncludeLinkedTrim(clipToTrim, selectedClipIds, singleClip);

        // Multi-select trim: apply the lead clip's (snapped) delta to every other
        // selected clip, each clamped to its own bounds ("only as much as each can").
        const extraClips: NonNullable<Extract<TimelineEditOperation, { type: 'trim-clip' }>['extraClips']> = [];
        if (!singleClip && selectedClipIds.size > 1 && selectedClipIds.has(clipToTrim.id)) {
          for (const otherId of selectedClipIds) {
            if (otherId === clipToTrim.id) continue;
            const otherClip = clipMap.get(otherId);
            if (!otherClip) continue;
            const otherTiming = computeTrimTiming(otherClip, commitTrim.edge, trimOriginalsFromClip(otherClip), deltaTime);
            extraClips.push({
              clipId: otherClip.id,
              inPoint: otherTiming.newInPoint,
              outPoint: otherTiming.newOutPoint,
              ...(commitTrim.edge === 'left' ? { startTime: otherTiming.newStartTime } : {}),
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
        cleanupListeners();
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId === activePointerId) mouseMoveScheduler.handleMouseMove(moveEvent);
      };
      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === activePointerId) handleMouseUp(upEvent);
      };
      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== activePointerId) return;
        setClipTrim(null);
        clipTrimRef.current = null;
        setTimelineToolPreview(null);
        cleanupListeners();
      };

      if (activePointerId === null) {
        document.addEventListener('mousemove', mouseMoveScheduler.handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      } else {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerCancel);
      }
    },
    [activeTimelineToolId, applyTimelineEditOperation, clipMap, tracks, isExporting, markers, pixelToTime, frameRate, selectClip, selectedClipIds, setTimelineToolPreview, snappingEnabled]
  );

  return {
    clipTrim,
    clipTrimRef,
    handleTrimStart,
  };
}
