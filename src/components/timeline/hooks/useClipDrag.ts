// useClipDrag - Premiere-style clip dragging with snapping
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipDragState } from '../types';
import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { requestMediaSourceReveal } from '../../../services/mediaSourceReveal';
import { openPianoRoll } from '../../pianoRoll/PianoRollBoot';
import type { TimelineClipDragPreview, TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditOperation, TimelineEditResult } from '../../../stores/timeline/editOperations/types';
import {
  createResolvedClipMoveOperationPlan,
  resolveClipMoveRequest,
  type ResolvedClipMove,
  type ResolvedClipMoveOperationPlan,
} from '../../../stores/timeline/editOperations';
import {
  findNearestCompatibleClipDragTrackId,
  getClipDragNewTrackId,
  getClipDragNewTrackType,
  getClipDragTrackRequirement,
  isClipDragTrackCompatible,
  resolveCompatibleClipDragTrackId,
} from '../utils/clipDragTrackTargeting';
import { findSweptClipSnap } from '../utils/clipDragSnapping';

const log = Logger.create('useClipDrag');
const MIN_TOOL_GESTURE_DURATION = 0.1;
const CLIP_DRAG_COMMIT_EPSILON_SECONDS = 0.000001;
const CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS = 33;
const CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS = 66;
const CLIP_DRAG_RESOLVED_MOVE_BLOCK_REASONS = new Set([
  'fallback-track',
  'overlap-trim',
  'selected-linked-pair',
]);

interface UseClipDragProps {
  // Refs
  trackLanesRef: React.RefObject<HTMLDivElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;

  // State
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipMap: Map<string, TimelineClip>;
  selectedClipIds: Set<string>;
  scrollX: number;
  snappingEnabled: boolean;
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;

  // Actions
  selectClip: (clipId: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  applyTimelineEditOperation: (
    operation: TimelineEditOperation,
    options: { source: 'ui'; historyLabel?: string },
  ) => TimelineEditResult;
  openCompositionTab: (compositionId: string) => void;

  // Helpers
  pixelToTime: (pixel: number) => number;
  getRenderedTrackHeight: (track: TimelineTrack) => number;
  getSnappedPosition: (clipId: string, rawTime: number, trackId: string) => { startTime: number; snapped: boolean; snapEdgeTime: number };
  getPositionWithResistance: (clipId: string, rawTime: number, trackId: string, duration: number, zoom?: number, excludeClipIds?: string[]) => { startTime: number; forcingOverlap: boolean; noFreeSpace?: boolean };
}

interface UseClipDragReturn {
  clipDrag: ClipDragState | null;
  clipDragRef: React.MutableRefObject<ClipDragState | null>;
  handleClipMouseDown: (e: React.MouseEvent, clipId: string) => void;
  handleClipDoubleClick: (e: React.MouseEvent, clipId: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function timeRangesOverlap(startA: number, durationA: number, startB: number, durationB: number): boolean {
  const endA = startA + durationA;
  const endB = startB + durationB;
  return endA > startB && startA < endB;
}

function getSourceDuration(clip: TimelineClip): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, MIN_TOOL_GESTURE_DURATION);
}

function getSortedTrackClips(clips: TimelineClip[], trackId: string, excludeClipId: string): TimelineClip[] {
  return clips
    .filter((candidate) => candidate.trackId === trackId && candidate.id !== excludeClipId)
    .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
}

function findPreviousClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  const candidates = getSortedTrackClips(clips, clip.trackId, clip.id)
    .filter((candidate) => getClipEnd(candidate) <= clip.startTime + 0.0001);
  return candidates[candidates.length - 1] ?? null;
}

function findNextClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  return getSortedTrackClips(clips, clip.trackId, clip.id)
    .find((candidate) => candidate.startTime >= getClipEnd(clip) - 0.0001) ?? null;
}

function clampSlipSourceDelta(clip: TimelineClip, sourceDelta: number): number {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const sourceDuration = getSourceDuration(clip);
  const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
  const nextInPoint = clamp(clip.inPoint + sourceDelta, 0, maxInPoint);
  return nextInPoint - clip.inPoint;
}

function clampSlideTimelineDelta(clips: TimelineClip[], clip: TimelineClip, timelineDelta: number): number {
  const previousClip = findPreviousClip(clips, clip);
  const nextClip = findNextClip(clips, clip);
  if (!previousClip || !nextClip) return 0;

  const minDelta = -(previousClip.duration - MIN_TOOL_GESTURE_DURATION);
  const maxDelta = nextClip.duration - MIN_TOOL_GESTURE_DURATION;
  return clamp(timelineDelta, minDelta, maxDelta);
}

export function createClipDragTypedMoveCommitOperation(
  resolutionId: string,
  resolvedMoves: readonly ResolvedClipMove[],
  operationPlan: ResolvedClipMoveOperationPlan,
): TimelineEditOperation | null {
  if (operationPlan.canApplyWithMoveClipsOperation) {
    return operationPlan.operation;
  }

  const canApplyResolvedMove =
    operationPlan.blockedReasons.length > 0 &&
    operationPlan.blockedReasons.every(reason => CLIP_DRAG_RESOLVED_MOVE_BLOCK_REASONS.has(reason));

  if (!canApplyResolvedMove) return null;

  return {
    id: resolutionId,
    type: 'move-clips-resolved',
    resolvedMoves: [...resolvedMoves],
  };
}

function collectDragExcludeClipIds(
  selectedClipIds: Iterable<string>,
  clipMap: Map<string, TimelineClip>,
): string[] {
  const excludeClipIds = new Set(selectedClipIds);
  for (const clipId of excludeClipIds) {
    const clip = clipMap.get(clipId);
    if (clip?.linkedClipId) {
      excludeClipIds.add(clip.linkedClipId);
    }
  }
  return [...excludeClipIds];
}

function buildClipDragPreview(
  drag: ClipDragState,
  clipMap: Map<string, TimelineClip>,
): TimelineClipDragPreview | null {
  if (drag.toolGesture) return null;

  const movingClip = clipMap.get(drag.clipId);
  const previewStartTime = drag.snappedTime;
  if (!movingClip || previewStartTime === null) return null;

  const patches: TimelineClipDragPreview['patches'] = {};
  const movedClipIds = new Set<string>();
  const timeDelta = previewStartTime - movingClip.startTime;
  const shouldMoveLinkedOrGrouped = !drag.altKeyPressed;

  const addPatch = (clip: TimelineClip, startTime: number, trackId = clip.trackId) => {
    patches[clip.id] = { startTime, trackId };
    movedClipIds.add(clip.id);
  };

  addPatch(movingClip, previewStartTime, drag.currentTrackId);

  const selectedDragIds = drag.multiSelectClipIds ?? [];
  if (selectedDragIds.length > 0 && drag.multiSelectTimeDelta !== undefined) {
    for (const selectedId of selectedDragIds) {
      const selectedClip = clipMap.get(selectedId);
      if (!selectedClip || movedClipIds.has(selectedClip.id)) continue;
      addPatch(selectedClip, selectedClip.startTime + drag.multiSelectTimeDelta);
    }
  }

  if (shouldMoveLinkedOrGrouped) {
    for (const movedId of [...movedClipIds]) {
      const clip = clipMap.get(movedId);
      const linkedClip = clip?.linkedClipId ? clipMap.get(clip.linkedClipId) : undefined;
      if (linkedClip && !movedClipIds.has(linkedClip.id)) {
        addPatch(linkedClip, linkedClip.startTime + timeDelta);
      }
    }

    if (movingClip.linkedGroupId) {
      for (const clip of clipMap.values()) {
        if (clip.linkedGroupId !== movingClip.linkedGroupId || movedClipIds.has(clip.id)) continue;
        addPatch(clip, clip.startTime + timeDelta);
      }
    }
  }

  return Object.keys(patches).length > 0 ? { patches } : null;
}

let lastClipDragPreviewPublishAt = 0;
let pendingClipDragPreviewInput: { drag: ClipDragState; clipMap: Map<string, TimelineClip> } | null = null;
let pendingClipDragPreviewTimer: number | null = null;

function publishClipDragPreview(preview: TimelineClipDragPreview | null): void {
  lastClipDragPreviewPublishAt = performance.now();
  useTimelineStore.setState({ clipDragPreview: preview });
}

function clearPendingClipDragPreviewTimer(): void {
  if (pendingClipDragPreviewTimer !== null) {
    window.clearTimeout(pendingClipDragPreviewTimer);
    pendingClipDragPreviewTimer = null;
  }
  pendingClipDragPreviewInput = null;
}

function setClipDragPreviewFromDrag(drag: ClipDragState | null, clipMap: Map<string, TimelineClip>): void {
  if (drag === null) {
    clearPendingClipDragPreviewTimer();
    publishClipDragPreview(null);
    return;
  }

  const now = performance.now();
  const elapsed = now - lastClipDragPreviewPublishAt;
  if (elapsed >= CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS) {
    clearPendingClipDragPreviewTimer();
    publishClipDragPreview(buildClipDragPreview(drag, clipMap));
    return;
  }

  pendingClipDragPreviewInput = { drag, clipMap };
  if (pendingClipDragPreviewTimer !== null) return;

  pendingClipDragPreviewTimer = window.setTimeout(() => {
    pendingClipDragPreviewTimer = null;
    const nextInput = pendingClipDragPreviewInput;
    pendingClipDragPreviewInput = null;
    if (nextInput) {
      publishClipDragPreview(buildClipDragPreview(nextInput.drag, nextInput.clipMap));
    }
  }, Math.max(0, CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS - elapsed));
}

function getClipDragOverlapClipIds(
  clipMap: Map<string, TimelineClip>,
  drag: ClipDragState,
  primaryStartTime: number,
  primaryTrackId: string,
  timeDelta: number,
  excludeClipIds: string[],
): string[] {
  const movingClip = clipMap.get(drag.clipId);
  if (!movingClip) return [];

  const movedClips = new Map<string, { clip: TimelineClip; startTime: number; trackId: string }>();
  const excludedIds = new Set(excludeClipIds);
  const addMovedClip = (clip: TimelineClip, startTime: number, trackId = clip.trackId) => {
    movedClips.set(clip.id, { clip, startTime, trackId });
    excludedIds.add(clip.id);
  };

  addMovedClip(movingClip, primaryStartTime, primaryTrackId);

  if (drag.multiSelectClipIds?.length && drag.multiSelectTimeDelta !== undefined) {
    for (const selectedId of drag.multiSelectClipIds) {
      const selectedClip = clipMap.get(selectedId);
      if (selectedClip) addMovedClip(selectedClip, selectedClip.startTime + drag.multiSelectTimeDelta);
    }
  }

  if (!drag.altKeyPressed) {
    for (const moved of Array.from(movedClips.values())) {
      const linkedClip = moved.clip.linkedClipId ? clipMap.get(moved.clip.linkedClipId) : undefined;
      if (linkedClip && !movedClips.has(linkedClip.id)) {
        addMovedClip(linkedClip, linkedClip.startTime + timeDelta);
      }
    }

    if (movingClip.linkedGroupId) {
      for (const clip of clipMap.values()) {
        if (clip.linkedGroupId === movingClip.linkedGroupId && !movedClips.has(clip.id)) {
          addMovedClip(clip, clip.startTime + timeDelta);
        }
      }
    }
  }

  const overlapIds = new Set<string>();
  for (const moved of movedClips.values()) {
    for (const candidate of clipMap.values()) {
      if (excludedIds.has(candidate.id) || candidate.trackId !== moved.trackId) continue;
      if (timeRangesOverlap(moved.startTime, moved.clip.duration, candidate.startTime, candidate.duration)) {
        overlapIds.add(candidate.id);
      }
    }
  }

  return [...overlapIds];
}

export function useClipDrag({
  trackLanesRef,
  timelineRef,
  clips: _clips,
  tracks,
  clipMap,
  selectedClipIds,
  scrollX,
  snappingEnabled,
  isExporting,
  activeTimelineToolId,
  selectClip,
  applyTimelineEditOperation,
  openCompositionTab,
  pixelToTime,
  getRenderedTrackHeight,
  getSnappedPosition,
  getPositionWithResistance,
}: UseClipDragProps): UseClipDragReturn {
  const [clipDrag, setClipDrag] = useState<ClipDragState | null>(null);
  const clipDragRef = useRef<ClipDragState | null>(clipDrag);
  const lastClipDragStatePublishAtRef = useRef(0);
  const pendingClipDragStateRef = useRef<ClipDragState | null>(null);
  const pendingClipDragStateTimerRef = useRef<number | null>(null);

  // Keep refs to current values for use in event handlers (avoid stale closures)
  const selectedClipIdsRef = useRef<Set<string>>(selectedClipIds);
  const clipMapRef = useRef<Map<string, TimelineClip>>(clipMap);

  useEffect(() => {
    selectedClipIdsRef.current = selectedClipIds;
  }, [selectedClipIds]);

  useEffect(() => {
    clipMapRef.current = clipMap;
  }, [clipMap]);

  const clearPendingClipDragStateTimer = useCallback(() => {
    if (pendingClipDragStateTimerRef.current !== null) {
      window.clearTimeout(pendingClipDragStateTimerRef.current);
      pendingClipDragStateTimerRef.current = null;
    }
    pendingClipDragStateRef.current = null;
  }, []);

  const publishClipDragState = useCallback((nextDrag: ClipDragState | null) => {
    lastClipDragStatePublishAtRef.current = performance.now();
    setClipDrag(nextDrag);
  }, []);

  const setClipDragStateForInteraction = useCallback((nextDrag: ClipDragState | null) => {
    clipDragRef.current = nextDrag;

    if (nextDrag === null) {
      clearPendingClipDragStateTimer();
      publishClipDragState(null);
      return;
    }

    const now = performance.now();
    const elapsed = now - lastClipDragStatePublishAtRef.current;
    if (elapsed >= CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS) {
      clearPendingClipDragStateTimer();
      publishClipDragState(nextDrag);
      return;
    }

    pendingClipDragStateRef.current = nextDrag;
    if (pendingClipDragStateTimerRef.current !== null) return;

    pendingClipDragStateTimerRef.current = window.setTimeout(() => {
      pendingClipDragStateTimerRef.current = null;
      const pendingDrag = pendingClipDragStateRef.current;
      pendingClipDragStateRef.current = null;
      if (pendingDrag) {
        publishClipDragState(pendingDrag);
      }
    }, Math.max(0, CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS - elapsed));
  }, [clearPendingClipDragStateTimer, publishClipDragState]);

  useEffect(() => () => {
    clearPendingClipDragStateTimer();
    setClipDragPreviewFromDrag(null, clipMapRef.current);
  }, [clearPendingClipDragStateTimer]);

  // Premiere-style clip drag
  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (isExporting) return;

      // Use ref for current clipMap to avoid stale closure
      const currentClipMap = clipMapRef.current;
      const clip = currentClipMap.get(clipId);
      if (!clip) return;
      const isClipLocked = (id: string): boolean => {
        const candidate = currentClipMap.get(id);
        return !!candidate && tracks.find(track => track.id === candidate.trackId)?.locked === true;
      };
      if (isClipLocked(clipId)) return;

      // Shift+Click: Toggle selection (add/remove from multi-selection)
      if (e.shiftKey) {
        selectClip(clipId, true); // addToSelection = true
        return; // Don't start drag on shift+click
      }

      // Use ref for current selection to avoid stale closure
      const currentSelectedIds = selectedClipIdsRef.current;

      // If clip is not selected, select it (+ linked clip)
      // If already selected, keep selection but update primary for Properties panel
      if (!currentSelectedIds.has(clipId)) {
        selectClip(clipId);
      } else {
        selectClip(clipId, false, true); // setPrimaryOnly: keep existing selection, just update primary
      }

      // Capture other selected clip IDs for multi-select drag (re-read after potential selection change)
      const finalSelectedIds = selectedClipIdsRef.current;
      const otherSelectedIds = finalSelectedIds.size > 1 && finalSelectedIds.has(clipId)
        ? [...finalSelectedIds].filter(id => id !== clipId)
        : [];
      if ([clipId, ...otherSelectedIds].some(isClipLocked)) return;

      const clipElement = e.currentTarget as HTMLElement;
      const clipRect = clipElement.getBoundingClientRect();
      const pxPerSecondUnit = pixelToTime(1);
      const pxPerSecond = pxPerSecondUnit !== 0 ? 1 / pxPerSecondUnit : 0;
      const clipLeft = clipElement.classList.contains('track-clip-row')
        ? clipRect.left + clip.startTime * pxPerSecond
        : clipRect.left;
      const grabOffsetX = e.clientX - clipLeft;
      const lanesRectInit = trackLanesRef.current?.getBoundingClientRect();
      const grabY = lanesRectInit ? e.clientY - lanesRectInit.top : 0;
      const toolGesture = activeTimelineToolId === 'slip' || activeTimelineToolId === 'slide'
        ? activeTimelineToolId
        : undefined;

      const initialDrag: ClipDragState = {
        clipId,
        toolGesture,
        originalStartTime: clip.startTime,
        originalTrackId: clip.trackId,
        grabOffsetX,
        grabY,
        gestureStartX: e.clientX,
        currentX: e.clientX,
        currentTrackId: clip.trackId,
        snappedTime: clip.startTime,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        newTrackType: null,
        altKeyPressed: e.altKey, // Capture Alt state for independent drag
        forcingOverlap: false,
        overlapClipIds: [],
        dragStartTime: Date.now(), // Track when drag started for track-change delay
        // Multi-select support
        multiSelectClipIds: otherSelectedIds.length > 0 ? otherSelectedIds : undefined,
        multiSelectTimeDelta: 0,
      };
      setClipDragStateForInteraction(initialDrag);
      setClipDragPreviewFromDrag(initialDrag, currentClipMap);

      const processMouseMove = (moveEvent: MouseEvent) => {
        const drag = clipDragRef.current;
        if (!drag || !trackLanesRef.current || !timelineRef.current) return;

        if (drag.toolGesture === 'slip' || drag.toolGesture === 'slide') {
          const currentClip = clipMapRef.current.get(drag.clipId);
          if (!currentClip) return;

          const rawDelta = pixelToTime(moveEvent.clientX - (drag.gestureStartX ?? drag.currentX));
          const clampedDelta = drag.toolGesture === 'slip'
            ? clampSlipSourceDelta(currentClip, rawDelta)
            : clampSlideTimelineDelta([...clipMapRef.current.values()], currentClip, rawDelta);
          const newDrag: ClipDragState = {
            ...drag,
            currentX: moveEvent.clientX,
            currentTrackId: currentClip.trackId,
            snappedTime: drag.toolGesture === 'slide'
              ? Math.max(0, currentClip.startTime + clampedDelta)
              : currentClip.startTime,
            snapIndicatorTime: null,
            isSnapping: false,
            trackChangeGuideTime: null,
            newTrackType: null,
            altKeyPressed: moveEvent.altKey,
            forcingOverlap: false,
            overlapClipIds: [],
            multiSelectTimeDelta: drag.toolGesture === 'slide' ? clampedDelta : undefined,
            sourceTimeDelta: drag.toolGesture === 'slip' ? clampedDelta : undefined,
          };
          setClipDragStateForInteraction(newDrag);
          setClipDragPreviewFromDrag(newDrag, clipMapRef.current);
          return;
        }

        const lanesRect = trackLanesRef.current.getBoundingClientRect();
        const mouseY = moveEvent.clientY - lanesRect.top;

        // Track change requires BOTH a time delay (300ms) AND a vertical distance (20px from grab point)
        const TRACK_CHANGE_DELAY_MS = 300;
        const TRACK_CHANGE_RESISTANCE_PX = 30;
        const trackChangeAllowed = Date.now() - drag.dragStartTime >= TRACK_CHANGE_DELAY_MS
          && Math.abs(mouseY - drag.grabY) >= TRACK_CHANGE_RESISTANCE_PX;

        const clipForTrackCheck = clipMap.get(drag.clipId);
        const requiredTrackType = getClipDragTrackRequirement(clipForTrackCheck, tracks);
        let newTrackId = resolveCompatibleClipDragTrackId(
          drag.currentTrackId,
          drag.originalTrackId,
          clipForTrackCheck,
          tracks,
        );
        const targetTrackId = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>('.track-lane[data-track-id]')
          ?.dataset.trackId;
        const hoveredTrack = targetTrackId
          ? tracks.find(track => track.id === targetTrackId)
          : undefined;

        let trackAtMouse = hoveredTrack;
        if (!trackAtMouse) {
          let currentY = 24;
          for (const track of tracks) {
            const trackHeight = getRenderedTrackHeight(track);
            if (mouseY >= currentY && mouseY < currentY + trackHeight) {
              trackAtMouse = track;
              break;
            }
            currentY += trackHeight;
          }
        }

        const newTrackType = trackChangeAllowed && !hoveredTrack
          ? getClipDragNewTrackType(
              tracks,
              mouseY,
              getRenderedTrackHeight,
              requiredTrackType,
              24,
              drag.newTrackType ?? null,
            )
          : null;

        if (newTrackType) {
          newTrackId = getClipDragNewTrackId(newTrackType);
        } else {
          if (hoveredTrack) {
            if (
              (trackChangeAllowed || hoveredTrack.id === drag.originalTrackId) &&
              isClipDragTrackCompatible(hoveredTrack, requiredTrackType)
            ) {
              newTrackId = hoveredTrack.id;
            }
          } else if (
            trackAtMouse &&
            (trackChangeAllowed || trackAtMouse.id === drag.originalTrackId) &&
            isClipDragTrackCompatible(trackAtMouse, requiredTrackType)
          ) {
            newTrackId = trackAtMouse.id;
          }

          if (
            trackChangeAllowed &&
            trackAtMouse &&
            !isClipDragTrackCompatible(trackAtMouse, requiredTrackType)
          ) {
            const nearestCompatibleTrackId = findNearestCompatibleClipDragTrackId(
              tracks,
              mouseY,
              getRenderedTrackHeight,
              requiredTrackType,
            );
            if (nearestCompatibleTrackId) {
              newTrackId = nearestCompatibleTrackId;
            }
          }
        }

        const rect = timelineRef.current.getBoundingClientRect();
        const previousX = drag.currentX - rect.left + scrollX - drag.grabOffsetX;
        const x = moveEvent.clientX - rect.left + scrollX - drag.grabOffsetX;
        const rawTime = Math.max(0, pixelToTime(x));

        // Snapping with Alt-key toggle:
        // - When snapping enabled: snap by default, Alt temporarily disables
        // - When snapping disabled: don't snap, Alt temporarily enables
        const shouldSnap = snappingEnabled !== moveEvent.altKey;

        // First check for edge snapping (only if snapping should be active)
        // Snap hysteresis: once snapped, user must drag SNAP_BREAKOUT_PX pixels to break free
        const SNAP_BREAKOUT_PX = 20; // pixels of drag to break out of snap
        let snapped = false;
        let snappedTime = rawTime;
        let snapEdgeTime = 0;

        if (shouldSnap) {
          // If currently snapped, check if user has dragged far enough (in pixels) to break free
          if (drag.isSnapping && drag.snapIndicatorTime !== null && drag.snappedTime !== null) {
            const draggedClipForSnap = clipMap.get(drag.clipId);
            const dur = draggedClipForSnap?.duration || 0;
            // Convert breakout threshold from pixels to time using pixelToTime
            const breakoutTimeDist = pixelToTime(SNAP_BREAKOUT_PX);
            // Distance in time from raw position edges to the snap edge
            const distStart = Math.abs(rawTime - drag.snapIndicatorTime);
            const distEnd = Math.abs((rawTime + dur) - drag.snapIndicatorTime);
            const minDist = Math.min(distStart, distEnd);

            if (minDist < breakoutTimeDist) {
              // Still within breakout zone — keep snapping at previous position
              snapped = true;
              snappedTime = drag.snappedTime;
              snapEdgeTime = drag.snapIndicatorTime;
            }
          }

          // If not held by hysteresis, check for new snap points
          if (!snapped) {
            const snapResult = getSnappedPosition(drag.clipId, rawTime, newTrackId);
            snapped = snapResult.snapped;
            snappedTime = snapResult.startTime;
            snapEdgeTime = snapResult.snapEdgeTime;

            if (!snapped) {
              const sweptSnapResult = findSweptClipSnap({
                clipId: drag.clipId,
                previousX,
                currentX: x,
                trackId: newTrackId,
                pixelToTime,
                getSnappedPosition,
              });
              if (sweptSnapResult) {
                snapped = true;
                snappedTime = sweptSnapResult.startTime;
                snapEdgeTime = sweptSnapResult.snapEdgeTime;
              }
            }

            // When moving to a different track, also snap to original position
            // so the user can precisely move clips up/down without horizontal drift
            if (!snapped && newTrackId !== drag.originalTrackId) {
              const draggedClipForOrig = clipMap.get(drag.clipId);
              const dur = draggedClipForOrig?.duration || 0;
              const origEnd = drag.originalStartTime + dur;
              const snapThresholdTime = pixelToTime(SNAP_BREAKOUT_PX / 2);

              // Snap start to original start
              if (Math.abs(rawTime - drag.originalStartTime) < snapThresholdTime) {
                snapped = true;
                snappedTime = drag.originalStartTime;
                snapEdgeTime = drag.originalStartTime;
              }
              // Snap end to original end
              else if (Math.abs((rawTime + dur) - origEnd) < snapThresholdTime) {
                snapped = true;
                snappedTime = drag.originalStartTime;
                snapEdgeTime = origEnd;
              }
            }
          }
        }

        // Then apply resistance for overlap prevention
        const draggedClip = clipMap.get(drag.clipId);
        const clipDuration = draggedClip?.duration || 0;
        const baseTime = snapped ? snappedTime : rawTime;

        // Get all selected clip IDs AND their linked clips (for excluding from collision detection)
        // This ensures video+audio pairs move as a unit
        const allSelectedIds = drag.multiSelectClipIds
          ? [drag.clipId, ...drag.multiSelectClipIds]
          : [drag.clipId];

        // Also collect all linked clips of selected clips
        const allExcludedIds = [...allSelectedIds];
        for (const selId of allSelectedIds) {
          const selClip = clipMap.get(selId);
          if (selClip?.linkedClipId && !allExcludedIds.includes(selClip.linkedClipId)) {
            allExcludedIds.push(selClip.linkedClipId);
          }
        }
        const rawTimeDelta = baseTime - (draggedClip?.startTime ?? drag.originalStartTime);
        const overlapClipIds = getClipDragOverlapClipIds(
          clipMap,
          {
            ...drag,
            currentTrackId: newTrackId,
            snappedTime: baseTime,
            altKeyPressed: moveEvent.altKey,
            multiSelectTimeDelta: drag.multiSelectClipIds?.length ? rawTimeDelta : undefined,
          },
          baseTime,
          newTrackId,
          rawTimeDelta,
          allExcludedIds,
        );

        // Check primary clip with all related clips excluded
        const resistanceResult = getPositionWithResistance(
          drag.clipId,
          baseTime,
          newTrackId,
          clipDuration,
          undefined, // zoom
          allExcludedIds // exclude all selected clips and their linked clips
        );
        let resistedTime = resistanceResult.startTime;
        let forcingOverlap = resistanceResult.forcingOverlap;
        const { noFreeSpace } = resistanceResult;

        // If no free space on target track (cross-track move), try other tracks of same type
        if (noFreeSpace && newTrackId !== drag.originalTrackId) {
          const targetTrack = tracks.find(t => t.id === newTrackId);
          if (targetTrack) {
            const altTracks = tracks.filter(t =>
              t.type === targetTrack.type && t.id !== newTrackId && t.id !== drag.originalTrackId && !t.locked
            );
            for (const alt of altTracks) {
              const altResult = getPositionWithResistance(
                drag.clipId, baseTime, alt.id, clipDuration, undefined, allExcludedIds
              );
              if (!altResult.noFreeSpace) {
                newTrackId = alt.id;
                resistedTime = altResult.startTime;
                forcingOverlap = altResult.forcingOverlap;
                break;
              }
            }
          }
        }

        let timeDelta = resistedTime - (draggedClip?.startTime ?? drag.originalStartTime);

        // Check ALL linked clips for resistance (not just the primary dragged clip's linked clip)
        if (!moveEvent.altKey) {
          for (const selId of allSelectedIds) {
            const selClip = clipMap.get(selId);
            if (!selClip?.linkedClipId) continue;

            const linkedClip = clipMap.get(selClip.linkedClipId);
            if (!linkedClip) continue;

            const linkedNewTime = linkedClip.startTime + timeDelta;
            const linkedResult = getPositionWithResistance(
              linkedClip.id,
              linkedNewTime,
              linkedClip.trackId,
              linkedClip.duration,
              undefined,
              allExcludedIds
            );
            // If linked clip has more resistance, use that position
            const linkedTimeDelta = linkedResult.startTime - linkedClip.startTime;
            if (Math.abs(linkedTimeDelta) < Math.abs(timeDelta)) {
              // Linked clip is more constrained - adjust for the whole group
              timeDelta = linkedTimeDelta;
              resistedTime = (draggedClip?.startTime ?? drag.originalStartTime) + timeDelta;
              forcingOverlap = linkedResult.forcingOverlap || forcingOverlap;
            }
          }
        }

        // For multi-select: check all other selected clips for resistance too
        // The whole group should stop if ANY clip hits an obstacle
        if (drag.multiSelectClipIds?.length && !forcingOverlap) {
          for (const selectedId of drag.multiSelectClipIds) {
            const selectedClip = clipMap.get(selectedId);
            if (!selectedClip) continue;

            const selectedNewTime = selectedClip.startTime + timeDelta;
            const selectedResult = getPositionWithResistance(
              selectedClip.id,
              selectedNewTime,
              selectedClip.trackId,
              selectedClip.duration,
              undefined,
              allExcludedIds
            );

            // If this clip is more constrained, reduce the timeDelta for the whole group
            const selectedActualDelta = selectedResult.startTime - selectedClip.startTime;
            if (Math.abs(selectedActualDelta) < Math.abs(timeDelta)) {
              timeDelta = selectedActualDelta;
              resistedTime = (draggedClip?.startTime ?? drag.originalStartTime) + timeDelta;
              forcingOverlap = selectedResult.forcingOverlap || forcingOverlap;
            }
          }
        }

        // Calculate time delta for multi-select preview
        const multiSelectTimeDelta = drag.multiSelectClipIds?.length
          ? timeDelta
          : undefined;

        const newDrag: ClipDragState = {
          ...drag,
          currentX: moveEvent.clientX,
          currentTrackId: newTrackId,
          snappedTime: resistedTime,
          snapIndicatorTime: snapped && !forcingOverlap ? snapEdgeTime : null,
          isSnapping: snapped && !forcingOverlap,
          trackChangeGuideTime: newTrackId !== drag.originalTrackId ? drag.originalStartTime : null,
          newTrackType,
          altKeyPressed: moveEvent.altKey, // Update Alt state dynamically
          forcingOverlap,
          overlapClipIds,
          multiSelectTimeDelta,
        };
        setClipDragStateForInteraction(newDrag);
        setClipDragPreviewFromDrag(newDrag, clipMapRef.current);
      };

      let pendingMoveEvent: MouseEvent | null = null;
      let moveAnimationFrameId: number | null = null;

      const cancelPendingMouseMoveFrame = () => {
        if (moveAnimationFrameId !== null) {
          window.cancelAnimationFrame(moveAnimationFrameId);
          moveAnimationFrameId = null;
        }
      };

      const flushPendingMouseMove = () => {
        cancelPendingMouseMoveFrame();
        const moveEvent = pendingMoveEvent;
        pendingMoveEvent = null;
        if (moveEvent) {
          processMouseMove(moveEvent);
        }
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        pendingMoveEvent = moveEvent;
        if (moveAnimationFrameId !== null) return;

        moveAnimationFrameId = window.requestAnimationFrame(() => {
          moveAnimationFrameId = null;
          const latestMoveEvent = pendingMoveEvent;
          pendingMoveEvent = null;
          if (latestMoveEvent) {
            processMouseMove(latestMoveEvent);
          }
        });
      };

      const cleanupDragListeners = () => {
        cancelPendingMouseMoveFrame();
        pendingMoveEvent = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        flushPendingMouseMove();
        processMouseMove(upEvent);
        const drag = clipDragRef.current;
        if (drag && timelineRef.current) {
          if (drag.toolGesture === 'slip' || drag.toolGesture === 'slide') {
            const currentClip = clipMapRef.current.get(drag.clipId);
            if (currentClip) {
              const rawDelta = pixelToTime(upEvent.clientX - (drag.gestureStartX ?? drag.currentX));
              const delta = drag.toolGesture === 'slip'
                ? drag.sourceTimeDelta ?? clampSlipSourceDelta(currentClip, rawDelta)
                : drag.multiSelectTimeDelta ?? clampSlideTimelineDelta([...clipMapRef.current.values()], currentClip, rawDelta);
              if (drag.toolGesture === 'slip') {
                applyTimelineEditOperation({
                  id: `slip:${drag.clipId}:${Date.now()}`,
                  type: 'slip-clip',
                  clipId: drag.clipId,
                  sourceDelta: delta,
                  includeLinked: !drag.altKeyPressed,
                }, {
                  source: 'ui',
                  historyLabel: 'Slip clip',
                });
              } else {
                applyTimelineEditOperation({
                  id: `slide:${drag.clipId}:${Date.now()}`,
                  type: 'slide-clip',
                  clipId: drag.clipId,
                  timelineDelta: delta,
                  includeLinked: !drag.altKeyPressed,
                }, {
                  source: 'ui',
                  historyLabel: 'Slide clip',
                });
              }
            }
            setClipDragStateForInteraction(null);
            setClipDragPreviewFromDrag(null, clipMapRef.current);
            cleanupDragListeners();
            return;
          }

          // Use refs to get current values (avoid stale closures)
          const currentSelectedIds = selectedClipIdsRef.current;
          const currentClipMap = clipMapRef.current;
          const draggedClipForDrop = currentClipMap.get(drag.clipId);
          const finalTrackId = drag.newTrackType
            ? getClipDragNewTrackId(drag.newTrackType)
            : resolveCompatibleClipDragTrackId(
                drag.currentTrackId,
                drag.originalTrackId,
                draggedClipForDrop,
                tracks,
              );
          const currentTracksForCommit = useTimelineStore.getState().tracks;

          // Commit the already-calculated drag preview position. This keeps
          // snap hysteresis honest: if the clip is still visually held at a
          // snap point on mouseup, the saved position must be that snap point.
          const isMultiSelect = currentSelectedIds.size > 1 && currentSelectedIds.has(drag.clipId);

          let finalStartTime: number;
          let timeDelta: number;

          if (drag.snappedTime !== null) {
            const draggedClip = currentClipMap.get(drag.clipId);
            finalStartTime = drag.snappedTime;
            timeDelta = isMultiSelect && drag.multiSelectTimeDelta !== undefined
              ? drag.multiSelectTimeDelta
              : finalStartTime - (draggedClip?.startTime ?? drag.originalStartTime);
          } else {
            // Fallback for incomplete drag state.
            const rect = timelineRef.current.getBoundingClientRect();
            const x = upEvent.clientX - rect.left + scrollX - drag.grabOffsetX;
            finalStartTime = Math.max(0, pixelToTime(x));
            const draggedClip = currentClipMap.get(drag.clipId);
            timeDelta = finalStartTime - (draggedClip?.startTime ?? drag.originalStartTime);
          }

          log.debug('Multi-select drag check', {
            selectedCount: currentSelectedIds.size,
            selectedIds: [...currentSelectedIds],
            dragClipId: drag.clipId,
            hasDragClip: currentSelectedIds.has(drag.clipId),
            timeDelta,
            finalStartTime,
            finalTrackId,
            usedDragPreviewPosition: drag.snappedTime !== null,
          });

          const draggedClip = currentClipMap.get(drag.clipId);
          const shouldCommitMove =
            isMultiSelect
              ? finalTrackId !== draggedClip?.trackId ||
                Math.abs(timeDelta) > CLIP_DRAG_COMMIT_EPSILON_SECONDS
              : !draggedClip ||
                finalTrackId !== draggedClip.trackId ||
                Math.abs(finalStartTime - draggedClip.startTime) > CLIP_DRAG_COMMIT_EPSILON_SECONDS;
          const allExcludedIds = collectDragExcludeClipIds(currentSelectedIds, currentClipMap);

          if (shouldCommitMove) {
            const resolution = resolveClipMoveRequest({
              id: `move:${drag.clipId}:${Date.now()}`,
              clips: [...currentClipMap.values()],
              tracks: currentTracksForCommit,
              clipId: drag.clipId,
              requestedStartTime: finalStartTime,
              requestedTrackId: finalTrackId,
              requestedNewTrackType: drag.newTrackType ?? undefined,
              selectedClipIds: isMultiSelect ? currentSelectedIds : undefined,
              includeLinked: !drag.altKeyPressed,
              includeGroups: !drag.altKeyPressed,
              excludeClipIds: allExcludedIds,
              getPositionWithResistance: (clipId, startTime, trackId, duration, excludeClipIds) =>
                getPositionWithResistance(
                  clipId,
                  startTime,
                  trackId,
                  duration,
                  undefined,
                  excludeClipIds ? [...excludeClipIds] : undefined,
                ),
            });
            const operationPlan = createResolvedClipMoveOperationPlan(
              resolution.id,
              resolution.resolvedMoves,
              resolution.warnings,
            );
            const operationToApply = createClipDragTypedMoveCommitOperation(
              resolution.id,
              resolution.resolvedMoves,
              operationPlan,
            );

            if (operationToApply) {
              const applyResult = applyTimelineEditOperation(operationToApply, {
                source: 'ui',
                historyLabel: isMultiSelect ? 'Move selected clips' : 'Move clip',
              });
              if (!applyResult.success) {
                log.warn('Typed clip drag commit failed', {
                  operationId: operationToApply.id,
                  warnings: applyResult.warnings,
                });
              }
            } else {
              log.warn('Typed clip drag commit blocked', {
                blockedReasons: operationPlan.blockedReasons,
                warnings: resolution.warnings,
              });
            }
          }
        }
        setClipDragStateForInteraction(null);
        setClipDragPreviewFromDrag(null, clipMapRef.current);
        cleanupDragListeners();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [activeTimelineToolId, applyTimelineEditOperation, trackLanesRef, timelineRef, clipMap, tracks, scrollX, snappingEnabled, isExporting, pixelToTime, getRenderedTrackHeight, selectClip, getSnappedPosition, getPositionWithResistance, setClipDragStateForInteraction]
  );

  // Handle double-click on clip - open composition if it's a nested comp
  const handleClipDoubleClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = clipMap.get(clipId);
      if (!clip) return;

      // MIDI clips open the detached piano-roll editor (issue #182).
      if (clip.source?.type === 'midi') {
        openPianoRoll(clip.id);
        return;
      }

      // If this clip is a composition, open it in a new tab and switch to it.
      if (clip.isComposition && clip.compositionId) {
        log.debug('Double-click on composition clip, opening:', clip.compositionId);
        openCompositionTab(clip.compositionId);
        return;
      }

      const track = tracks.find((candidate) => candidate.id === clip.trackId);
      const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
      const sourceType = clip.source?.type;
      const isMediaLayerClip =
        track?.type === 'video' ||
        track?.type === 'audio' ||
        sourceType === 'video' ||
        sourceType === 'audio';

      if (mediaFileId && isMediaLayerClip) {
        useDockStore.getState().activatePanelType('media');
        requestMediaSourceReveal(mediaFileId, 'timeline');
      }
    },
    [clipMap, openCompositionTab, tracks]
  );

  return {
    clipDrag,
    clipDragRef,
    handleClipMouseDown,
    handleClipDoubleClick,
  };
}
