// useMarqueeSelection - Rectangle selection for clips and keyframes
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack, AnimatableProperty } from '../../../types';
import type { MarqueeState, ClipDragState, ClipTrimState, MarkerDragState } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolId } from '../../../stores/timeline/types';
import { isTimelineActiveTarget } from '../utils/timelineActiveTargets';

const KEYFRAME_DIAMOND_HIT_SIZE_PX = 12;
const KEYFRAME_DIAMOND_CENTER_OFFSET_X_PX = -3;

interface UseMarqueeSelectionProps {
  // Refs
  trackLanesRef: React.RefObject<HTMLDivElement | null>;

  // State
  scrollX: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  selectedKeyframeIds: Set<string>;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  activeTimelineToolId: TimelineToolId;

  // Drag states (to prevent marquee during other operations)
  clipDrag: ClipDragState | null;
  clipTrim: ClipTrimState | null;
  markerDrag: MarkerDragState | null;
  isDraggingPlayhead: boolean;

  // Actions
  selectClip: (clipId: string | null, addToSelection?: boolean) => void;
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void;
  deselectAllKeyframes: () => void;
  setTimelineRangeSelection: ReturnType<typeof useTimelineStore.getState>['setTimelineRangeSelection'];
  clearTimelineRangeSelection: ReturnType<typeof useTimelineStore.getState>['clearTimelineRangeSelection'];

  // Helpers
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
  isTrackExpanded: (trackId: string) => boolean;
  getTrackBaseHeight: (track: TimelineTrack) => number;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
}

interface UseMarqueeSelectionReturn {
  marquee: MarqueeState | null;
  handleMarqueeMouseDown: (e: React.MouseEvent) => void;
}

export function useMarqueeSelection({
  trackLanesRef,
  scrollX,
  clips,
  tracks: _tracks,
  selectedClipIds,
  selectedKeyframeIds,
  clipKeyframes: _clipKeyframes,
  activeTimelineToolId,
  clipDrag,
  clipTrim,
  markerDrag,
  isDraggingPlayhead,
  selectClip,
  selectKeyframe,
  deselectAllKeyframes,
  setTimelineRangeSelection,
  clearTimelineRangeSelection,
  timeToPixel,
  pixelToTime,
  isTrackExpanded: _isTrackExpanded,
  getTrackBaseHeight: _getTrackBaseHeight,
  getExpandedTrackHeight: _getExpandedTrackHeight,
}: UseMarqueeSelectionProps): UseMarqueeSelectionReturn {
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const marqueeRef = useRef(marquee);

  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);

  const getTimelineContentOriginX = useCallback((): number => {
    const container = trackLanesRef.current;
    if (!container) return 0;

    const containerRect = container.getBoundingClientRect();
    const rowEl = container.querySelector<HTMLElement>('.track-clip-row') ??
      container.querySelector<HTMLElement>('.track-lanes-scroll');
    if (!rowEl) return 0;

    const rowRect = rowEl.getBoundingClientRect();
    return rowRect.left - containerRect.left + scrollX;
  }, [scrollX, trackLanesRef]);

  const stackXToTimelineTime = useCallback(
    (x: number): number => Math.max(0, pixelToTime(x - getTimelineContentOriginX())),
    [getTimelineContentOriginX, pixelToTime],
  );

  // Helper: Calculate which clips intersect with a rectangle.
  //
  // Computed from clip DATA, not from clip DOM elements: in canvas mode (issue
  // #228) clips are drawn on a canvas and have no per-clip DOM node. We take each
  // clip's X from the same timeToPixel helper as the renderer and its Y from the
  // track's still-DOM clip-row element. This also fixes the old DOM path, where
  // viewport-culled off-screen clips couldn't be marquee-selected.
  const getClipsInRect = useCallback(
    (left: number, right: number, top: number, bottom: number): Set<string> => {
      const result = new Set<string>();
      const container = trackLanesRef.current;
      if (!container) return result;

      const containerRect = container.getBoundingClientRect();
      const visitedTrackIds = new Set<string>();

      container.querySelectorAll<HTMLElement>('.track-lane[data-track-id]').forEach((laneEl) => {
        const trackId = laneEl.dataset.trackId;
        if (!trackId || visitedTrackIds.has(trackId)) return;
        visitedTrackIds.add(trackId);

        const track = _tracks.find((candidate) => candidate.id === trackId);
        if (!track || track.locked || track.visible === false) return;

        const rowEl = laneEl.querySelector<HTMLElement>('.track-clip-row') ?? laneEl;
        const rowRect = rowEl.getBoundingClientRect();
        const rowTop = rowRect.top - containerRect.top;
        const rowBottom = rowRect.bottom - containerRect.top;
        const rowContentLeft = rowRect.left - containerRect.left + scrollX;
        if (Math.min(rowBottom, bottom) - Math.max(rowTop, top) <= 1) return; // track outside vertical band

        for (const clip of clips) {
          if (clip.trackId !== trackId) continue;
          const clipLeft = rowContentLeft + timeToPixel(clip.startTime);
          const clipRight = rowContentLeft + timeToPixel(clip.startTime + clip.duration);
          if (Math.min(clipRight, right) - Math.max(clipLeft, left) > 1) {
            result.add(clip.id);
          }
        }
      });

      return result;
    },
    [timeToPixel, trackLanesRef, clips, _tracks, scrollX]
  );

  // Helper: Calculate which keyframes intersect with a rectangle
  const getKeyframesInRect = useCallback(
    (left: number, right: number, top: number, bottom: number): Set<string> => {
      const result = new Set<string>();
      const container = trackLanesRef.current;
      if (!container) return result;

      const containerRect = container.getBoundingClientRect();
      const halfSize = KEYFRAME_DIAMOND_HIT_SIZE_PX / 2;

      container.querySelectorAll<HTMLElement>('.keyframe-track-row[data-track-id][data-keyframe-property]').forEach((rowElement) => {
        const trackId = rowElement.dataset.trackId;
        const property = rowElement.dataset.keyframeProperty;
        if (!trackId || !property) return;

        const keyframeTrackElement = rowElement.querySelector<HTMLElement>('.keyframe-track') ?? rowElement;
        const keyframeTrackRect = keyframeTrackElement.getBoundingClientRect();
        const rowTop = keyframeTrackRect.top - containerRect.top;
        const rowBottom = keyframeTrackRect.bottom - containerRect.top;
        if (rowBottom <= top || rowTop >= bottom) return;

        const rowContentLeft = keyframeTrackRect.left - containerRect.left + scrollX;
        const centerY = rowTop + keyframeTrackRect.height / 2;

        for (const clip of clips) {
          if (clip.trackId !== trackId) continue;
          const keyframes = _clipKeyframes.get(clip.id) ?? [];
          if (keyframes.length === 0) continue;

          const effectiveClipStartTime =
            clipDrag && clipDrag.clipId === clip.id && clipDrag.snappedTime !== null
              ? clipDrag.snappedTime
              : clip.startTime;

          for (const keyframe of keyframes) {
            if (keyframe.property !== property) continue;

            const centerX = rowContentLeft +
              timeToPixel(effectiveClipStartTime + keyframe.time) +
              KEYFRAME_DIAMOND_CENTER_OFFSET_X_PX;
            const keyframeLeft = centerX - halfSize;
            const keyframeRight = centerX + halfSize;
            const keyframeTop = centerY - halfSize;
            const keyframeBottom = centerY + halfSize;

            if (keyframeRight > left && keyframeLeft < right && keyframeBottom > top && keyframeTop < bottom) {
              result.add(keyframe.id);
            }
          }
        }
      });

      return result;
    },
    [_clipKeyframes, clipDrag, clips, scrollX, timeToPixel, trackLanesRef]
  );

  const getTrackIdsInRect = useCallback(
    (top: number, bottom: number): string[] => {
      const container = trackLanesRef.current;
      if (!container) return [];

      const containerRect = container.getBoundingClientRect();
      const trackIds: string[] = [];
      container.querySelectorAll<HTMLElement>('.track-lane[data-track-id]').forEach((trackElement) => {
        const trackId = trackElement.dataset.trackId;
        if (!trackId) return;

        const track = _tracks.find((candidate) => candidate.id === trackId);
        if (!track || track.locked || track.visible === false) return;

        const trackRect = trackElement.getBoundingClientRect();
        const trackTop = trackRect.top - containerRect.top;
        const trackBottom = trackRect.bottom - containerRect.top;
        if (trackBottom > top && trackTop < bottom) {
          trackIds.push(trackId);
        }
      });
      return trackIds;
    },
    [_tracks, trackLanesRef],
  );

  // Marquee selection: mouse down on empty area starts selection
  const handleMarqueeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start marquee on left mouse button and empty area
      if (e.button !== 0) return;

      const isRangeSelectionTool = activeTimelineToolId === 'range-select';
      if (activeTimelineToolId !== 'select' && !isRangeSelectionTool) return;

      // Don't start if clicking on a clip or interactive element
      const target = e.target as HTMLElement;
      if (
        (!isRangeSelectionTool && isTimelineActiveTarget(target)) ||
        target.closest('[data-shell-trim-edge], [data-shell-fade-edge], [data-clip-interaction-slot]') ||
        target.closest('.playhead') ||
        target.closest('.in-out-marker') ||
        target.closest('.trim-handle') ||
        target.closest('.fade-handle') ||
        target.closest('.track-header') ||
        target.closest('.timeline-split-divider') ||
        target.closest('.keyframe-diamond')
      ) {
        return;
      }

      // Don't start if any other drag operation is in progress
      if (clipDrag || clipTrim || markerDrag || isDraggingPlayhead) {
        return;
      }

      const rect = trackLanesRef.current?.getBoundingClientRect();
      if (!rect) return;

      const startX = e.clientX - rect.left + scrollX;
      const startY = e.clientY - rect.top;

      // Check if we're starting in the keyframe area
      const isInKeyframeArea = target.closest('.keyframe-track-row') !== null;

      if (isRangeSelectionTool) {
        const startTime = stackXToTimelineTime(startX);
        setMarquee({
          mode: 'range',
          startX,
          startY,
          currentX: startX,
          currentY: startY,
          startScrollX: scrollX,
          initialSelection: new Set(),
          initialKeyframeSelection: new Set(),
        });
        setTimelineRangeSelection({
          startTime,
          endTime: startTime,
          trackIds: getTrackIdsInRect(startY, startY + 1),
        });
        e.preventDefault();
        return;
      }

      // Clear selection unless shift is held
      // But if in keyframe area, keep clip selection to prevent keyframe rows from collapsing
      if (!e.shiftKey) {
        clearTimelineRangeSelection();
        if (!isInKeyframeArea) {
          selectClip(null, false);
        }
        deselectAllKeyframes();
      }

      // Store the initial selection (for shift+drag to add to it)
      // If in keyframe area, always preserve current clip selection
      const initialSelection = (e.shiftKey || isInKeyframeArea) ? new Set(selectedClipIds) : new Set<string>();
      const initialKeyframeSelection = e.shiftKey ? new Set(selectedKeyframeIds) : new Set<string>();

      setMarquee({
        mode: 'marquee',
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        startScrollX: scrollX,
        initialSelection,
        initialKeyframeSelection,
      });

      e.preventDefault();
    },
    [
      trackLanesRef,
      clipDrag,
      clipTrim,
      markerDrag,
      isDraggingPlayhead,
      scrollX,
      activeTimelineToolId,
      stackXToTimelineTime,
      setTimelineRangeSelection,
      clearTimelineRangeSelection,
      getTrackIdsInRect,
      selectClip,
      selectedClipIds,
      deselectAllKeyframes,
      selectedKeyframeIds,
    ]
  );

  // Marquee selection: mouse move and mouse up handlers
  useEffect(() => {
    if (!marquee) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = trackLanesRef.current?.getBoundingClientRect();
      if (!rect) return;

      const currentX = e.clientX - rect.left + scrollX;
      const currentY = e.clientY - rect.top;

      // Update marquee position
      setMarquee((prev) =>
        prev ? { ...prev, currentX, currentY } : null
      );

      // Calculate rectangle bounds
      const m = marqueeRef.current;
      if (!m) return;

      const left = Math.min(m.startX, currentX);
      const right = Math.max(m.startX, currentX);
      const top = Math.min(m.startY, currentY);
      const bottom = Math.max(m.startY, currentY);

      if (m.mode === 'range') {
        setTimelineRangeSelection({
          startTime: stackXToTimelineTime(left),
          endTime: stackXToTimelineTime(right),
          trackIds: getTrackIdsInRect(top, bottom),
        });
        return;
      }

      // Get clips that intersect with the rectangle
      const intersectingClips = getClipsInRect(left, right, top, bottom);

      // Combine with initial selection (for shift+drag)
      const newClipSelection = new Set([...m.initialSelection, ...intersectingClips]);

      // Update clip selection
      const currentClipSelection = useTimelineStore.getState().selectedClipIds;
      const clipSelectionChanged =
        newClipSelection.size !== currentClipSelection.size ||
        [...newClipSelection].some(id => !currentClipSelection.has(id));

      if (clipSelectionChanged) {
        selectClip(null, false);
        for (const clipId of newClipSelection) {
          selectClip(clipId, true);
        }
      }

      // Get keyframes that intersect with the rectangle
      const intersectingKeyframes = getKeyframesInRect(left, right, top, bottom);

      // Combine with initial keyframe selection (for shift+drag)
      const newKeyframeSelection = new Set([...m.initialKeyframeSelection, ...intersectingKeyframes]);

      // Update keyframe selection
      const currentKeyframeSelection = useTimelineStore.getState().selectedKeyframeIds;
      const keyframeSelectionChanged =
        newKeyframeSelection.size !== currentKeyframeSelection.size ||
        [...newKeyframeSelection].some(id => !currentKeyframeSelection.has(id));

      if (keyframeSelectionChanged) {
        deselectAllKeyframes();
        for (const kfId of newKeyframeSelection) {
          selectKeyframe(kfId, true);
        }
      }
    };

    const handleMouseUp = () => {
      // Selection is already applied live, just clear marquee
      setMarquee(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [marquee, trackLanesRef, scrollX, stackXToTimelineTime, setTimelineRangeSelection, getTrackIdsInRect, selectClip, getClipsInRect, getKeyframesInRect, selectKeyframe, deselectAllKeyframes]);

  return {
    marquee,
    handleMarqueeMouseDown,
  };
}
