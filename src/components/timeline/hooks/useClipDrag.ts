// useClipDrag - Premiere-style clip dragging with snapping
import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip } from '../../../types';
import type { ClipDragState } from '../types';
import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import {
  createResolvedClipMoveOperationPlan,
  resolveClipMoveRequest,
} from '../../../stores/timeline/editOperations';
import {
  clampSlideTimelineDelta,
  clampSlipSourceDelta,
  collectDragExcludeClipIds,
  createClipDragTypedMoveCommitOperation,
  resolveClipDragGroupPlacement,
} from '../utils/clipDragOperations';
import { createClipDragMouseMoveScheduler } from '../utils/clipDragMouseMoveScheduler';
import { setClipDragPreviewFromDrag } from '../utils/clipDragPreview';
import { hasClipDragIntent } from '../utils/clipDragSelectionIntent';
import {
  findNearestCompatibleClipDragTrackId,
  getClipDragNewTrackId,
  getClipDragNewTrackType,
  getClipDragTrackRequirement,
  isClipDragTrackCompatible,
  resolveCompatibleClipDragTrackId,
} from '../utils/clipDragTrackTargeting';
import { findSweptClipSnap } from '../utils/clipDragSnapping';
import { isTimelineSnappingActive } from '../utils/timelineSnappingModifiers';
import { useClipDoubleClick } from './useClipDoubleClick';
import { useClipDragStatePublisher } from './useClipDragStatePublisher';
import type { UseClipDragProps, UseClipDragReturn } from './useClipDragTypes';

export { createClipDragTypedMoveCommitOperation } from '../utils/clipDragOperations';

const log = Logger.create('useClipDrag');
const CLIP_DRAG_COMMIT_EPSILON_SECONDS = 0.000001;

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
  const {
    clipDragRef,
    clearPendingClipDragStateTimer,
    setClipDragStateForInteraction,
  } = useClipDragStatePublisher(clipDrag, setClipDrag);

  // Keep refs to current values for use in event handlers (avoid stale closures)
  const selectedClipIdsRef = useRef<Set<string>>(selectedClipIds);
  const clipMapRef = useRef<Map<string, TimelineClip>>(clipMap);
  const tracksRef = useRef(tracks);

  useEffect(() => {
    selectedClipIdsRef.current = selectedClipIds;
  }, [selectedClipIds]);

  useEffect(() => {
    clipMapRef.current = clipMap;
  }, [clipMap]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => () => {
    clearPendingClipDragStateTimer();
    setClipDragPreviewFromDrag(null, clipMapRef.current, tracksRef.current);
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

      // Use ref for current selection to avoid stale closure
      const currentSelectedIds = selectedClipIdsRef.current;
      const shiftSelectionClickCandidate = e.shiftKey;
      const pointerDownX = e.clientX;
      const pointerDownY = e.clientY;

      // If clip is not selected, select it (+ linked clip)
      // If already selected, keep selection but update primary for Properties panel
      if (!shiftSelectionClickCandidate) {
        if (!currentSelectedIds.has(clipId)) {
          selectClip(clipId);
        } else {
          selectClip(clipId, false, true); // setPrimaryOnly: keep existing selection, just update primary
        }
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
        linkedClipId: clip.linkedClipId,
        linkedGroupId: clip.linkedGroupId,
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
      // A pointer-down selects the clip, but it must not immediately become a
      // drag. Waiting for deliberate pointer movement prevents tiny hand
      // movements during an ordinary click from nudging the clip.
      let dragStarted = false;

      const processMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStarted) {
          if (!hasClipDragIntent(
            pointerDownX,
            pointerDownY,
            moveEvent.clientX,
            moveEvent.clientY,
          )) return;
          dragStarted = true;
          if (!selectedClipIdsRef.current.has(clipId)) {
            selectClip(clipId);
            selectedClipIdsRef.current = new Set(useTimelineStore.getState().selectedClipIds);
          } else {
            selectClip(clipId, false, true);
          }
          setClipDragStateForInteraction(initialDrag);
          setClipDragPreviewFromDrag(initialDrag, clipMapRef.current, tracksRef.current);
        }
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
          setClipDragPreviewFromDrag(newDrag, clipMapRef.current, tracksRef.current);
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

        const shouldSnap = isTimelineSnappingActive(snappingEnabled, moveEvent);

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

        const allSelectedIds = drag.multiSelectClipIds
          ? [drag.clipId, ...drag.multiSelectClipIds]
          : [drag.clipId];
        const allExcludedIds = collectDragExcludeClipIds(allSelectedIds, clipMap);

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

        const groupPlacement = resolveClipDragGroupPlacement(
          clipMap,
          tracksRef.current,
          { ...drag, altKeyPressed: moveEvent.altKey },
          newTrackId,
          resistedTime - (draggedClip?.startTime ?? drag.originalStartTime),
          forcingOverlap,
          allExcludedIds,
          getPositionWithResistance,
        );
        const { overlapClipIds, timeDelta } = groupPlacement;
        resistedTime = groupPlacement.primaryStartTime;
        forcingOverlap = groupPlacement.forcingOverlap;

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
        setClipDragPreviewFromDrag(newDrag, clipMapRef.current, tracksRef.current);
      };

      const mouseMoveScheduler = createClipDragMouseMoveScheduler(processMouseMove);

      const cleanupDragListeners = () => {
        mouseMoveScheduler.clear();
        document.removeEventListener('mousemove', mouseMoveScheduler.handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        mouseMoveScheduler.flushPendingMouseMove();
        processMouseMove(upEvent);
        if (shiftSelectionClickCandidate && !dragStarted) {
          selectClip(clipId, true);
          setClipDragStateForInteraction(null);
          setClipDragPreviewFromDrag(null, clipMapRef.current, tracksRef.current);
          cleanupDragListeners();
          return;
        }
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
            setClipDragPreviewFromDrag(null, clipMapRef.current, tracksRef.current);
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
          const currentTracksForCommit = tracksRef.current;

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
        setClipDragPreviewFromDrag(null, clipMapRef.current, tracksRef.current);
        cleanupDragListeners();
      };

      document.addEventListener('mousemove', mouseMoveScheduler.handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [activeTimelineToolId, applyTimelineEditOperation, trackLanesRef, timelineRef, clipMap, tracks, scrollX, snappingEnabled, isExporting, pixelToTime, getRenderedTrackHeight, selectClip, getSnappedPosition, getPositionWithResistance, setClipDragStateForInteraction, clipDragRef]
  );

  const handleClipDoubleClick = useClipDoubleClick({
    clipMap,
    tracks,
    openCompositionTab,
  });

  return {
    clipDrag,
    clipDragRef,
    handleClipMouseDown,
    handleClipDoubleClick,
  };
}
