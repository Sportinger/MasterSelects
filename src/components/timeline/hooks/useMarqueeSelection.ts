// useMarqueeSelection - Rectangle selection for clips and keyframes
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack, AnimatableProperty } from '../../../types';
import type { MarqueeState, ClipDragState, ClipTrimState, MarkerDragState } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolId } from '../../../stores/timeline/types';

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

  // Helper: Calculate which clips intersect with a rectangle.
  //
  // Computed from clip DATA, not from clip DOM elements: in canvas mode (issue
  // #228) clips are drawn on a canvas and have no per-clip DOM node, so a DOM
  // query would find nothing. We take each clip's X from its time geometry
  // (x = startTime * pxPerSecond, the same basis as the canvas/DOM clips) and
  // its Y from the track's still-DOM clip-row element. This also fixes the old
  // DOM path, where viewport-culled off-screen clips couldn't be marquee-selected.
  const getClipsInRect = useCallback(
    (left: number, right: number, top: number, bottom: number): Set<string> => {
      const result = new Set<string>();
      const container = trackLanesRef.current;
      if (!container) return result;

      const containerRect = container.getBoundingClientRect();
      const timeUnitPx = pixelToTime(1);
      const pxPerSecond = timeUnitPx !== 0 ? 1 / timeUnitPx : 0; // inverse of pixelToTime (linear)

      container.querySelectorAll<HTMLElement>('.track-lane[data-track-id]').forEach((laneEl) => {
        const trackId = laneEl.dataset.trackId;
        if (!trackId) return;

        const rowEl = laneEl.querySelector<HTMLElement>('.track-clip-row') ?? laneEl;
        const rowRect = rowEl.getBoundingClientRect();
        const rowTop = rowRect.top - containerRect.top;
        const rowBottom = rowRect.bottom - containerRect.top;
        if (!(rowBottom > top && rowTop < bottom)) return; // track outside vertical band

        for (const clip of clips) {
          if (clip.trackId !== trackId) continue;
          const clipLeft = clip.startTime * pxPerSecond;
          const clipRight = (clip.startTime + clip.duration) * pxPerSecond;
          if (clipRight > left && clipLeft < right) {
            result.add(clip.id);
          }
        }
      });

      return result;
    },
    [pixelToTime, trackLanesRef, clips]
  );

  // Helper: Calculate which keyframes intersect with a rectangle
  const getKeyframesInRect = useCallback(
    (left: number, right: number, top: number, bottom: number): Set<string> => {
      const result = new Set<string>();
      const container = trackLanesRef.current;
      if (!container) return result;

      const containerRect = container.getBoundingClientRect();
      container.querySelectorAll<HTMLElement>('.keyframe-diamond[data-keyframe-id]').forEach((keyframeElement) => {
        const keyframeId = keyframeElement.dataset.keyframeId;
        if (!keyframeId) return;

        const keyframeRect = keyframeElement.getBoundingClientRect();
        const keyframeLeft = keyframeRect.left - containerRect.left + scrollX;
        const keyframeRight = keyframeRect.right - containerRect.left + scrollX;
        const keyframeTop = keyframeRect.top - containerRect.top;
        const keyframeBottom = keyframeRect.bottom - containerRect.top;

        if (keyframeRight > left && keyframeLeft < right && keyframeBottom > top && keyframeTop < bottom) {
          result.add(keyframeId);
        }
      });

      return result;
    },
    [scrollX, trackLanesRef]
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
        (!isRangeSelectionTool && target.closest('.timeline-clip')) ||
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
        const startTime = Math.max(0, pixelToTime(startX));
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
      pixelToTime,
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
          startTime: Math.max(0, pixelToTime(left)),
          endTime: Math.max(0, pixelToTime(right)),
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
  }, [marquee, trackLanesRef, scrollX, pixelToTime, setTimelineRangeSelection, getTrackIdsInRect, selectClip, getClipsInRect, getKeyframesInRect, selectKeyframe, deselectAllKeyframes]);

  return {
    marquee,
    handleMarqueeMouseDown,
  };
}
