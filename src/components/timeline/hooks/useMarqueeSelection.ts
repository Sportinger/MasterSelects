// useMarqueeSelection - Rectangle selection for clips and keyframes
// Extracted from Timeline.tsx for better maintainability

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack, AnimatableProperty } from '../../../types';
import type { MarqueeState, ClipDragState, ClipTrimState, MarkerDragState } from '../types';
import { useTimelineStore } from '../../../stores/timeline';

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

  // Drag states (to prevent marquee during other operations)
  clipDrag: ClipDragState | null;
  clipTrim: ClipTrimState | null;
  markerDrag: MarkerDragState | null;
  isDraggingPlayhead: boolean;

  // Actions
  selectClip: (clipId: string | null, addToSelection?: boolean) => void;
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void;
  deselectAllKeyframes: () => void;

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
  clips: _clips,
  tracks: _tracks,
  selectedClipIds,
  selectedKeyframeIds,
  clipKeyframes: _clipKeyframes,
  clipDrag,
  clipTrim,
  markerDrag,
  isDraggingPlayhead,
  selectClip,
  selectKeyframe,
  deselectAllKeyframes,
  pixelToTime: _pixelToTime,
  isTrackExpanded: _isTrackExpanded,
  getTrackBaseHeight: _getTrackBaseHeight,
  getExpandedTrackHeight: _getExpandedTrackHeight,
}: UseMarqueeSelectionProps): UseMarqueeSelectionReturn {
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const marqueeRef = useRef(marquee);

  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);

  // Helper: Calculate which clips intersect with a rectangle
  const getClipsInRect = useCallback(
    (left: number, right: number, top: number, bottom: number): Set<string> => {
      const result = new Set<string>();
      const container = trackLanesRef.current;
      if (!container) return result;

      const containerRect = container.getBoundingClientRect();
      container.querySelectorAll<HTMLElement>('.timeline-clip[data-clip-id]').forEach((clipElement) => {
        const clipId = clipElement.dataset.clipId;
        if (!clipId) return;

        const clipRect = clipElement.getBoundingClientRect();
        const clipLeft = clipRect.left - containerRect.left + scrollX;
        const clipRight = clipRect.right - containerRect.left + scrollX;
        const clipTop = clipRect.top - containerRect.top;
        const clipBottom = clipRect.bottom - containerRect.top;

        if (clipRight > left && clipLeft < right && clipBottom > top && clipTop < bottom) {
          result.add(clipId);
        }
      });

      return result;
    },
    [scrollX, trackLanesRef]
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

  // Marquee selection: mouse down on empty area starts selection
  const handleMarqueeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start marquee on left mouse button and empty area
      if (e.button !== 0) return;
      // Don't start if clicking on a clip or interactive element
      const target = e.target as HTMLElement;
      if (
        target.closest('.timeline-clip') ||
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

      // Clear selection unless shift is held
      // But if in keyframe area, keep clip selection to prevent keyframe rows from collapsing
      if (!e.shiftKey) {
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
    [trackLanesRef, clipDrag, clipTrim, markerDrag, isDraggingPlayhead, scrollX, selectClip, selectedClipIds, deselectAllKeyframes, selectedKeyframeIds]
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
  }, [marquee, trackLanesRef, scrollX, selectClip, getClipsInRect, getKeyframesInRect, selectKeyframe, deselectAllKeyframes]);

  return {
    marquee,
    handleMarqueeMouseDown,
  };
}
