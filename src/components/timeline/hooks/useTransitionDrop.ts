// Hook for handling transition drag and drop onto clip junctions

import { useState, useCallback, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { TRANSITION_MIME_TYPE } from '../../panels/TransitionsPanel';
import type { TimelineClip } from '../../../types';

export interface TransitionDropData {
  type: string;
  duration: number;
}

export interface JunctionHighlight {
  trackId: string;
  clipA: TimelineClip;
  clipB: TimelineClip;
  junctionTime: number;
}

export interface UseTransitionDropResult {
  // Current junction being hovered (for highlighting)
  activeJunction: JunctionHighlight | null;

  // Handler for dragover on timeline tracks
  handleDragOver: (e: React.DragEvent, trackId: string, mouseTime: number) => void;

  // Handler for drop on timeline tracks
  handleDrop: (e: React.DragEvent, trackId: string, mouseTime: number) => void;

  // Handler for dragleave
  handleDragLeave: () => void;

  // Check if a drag event contains transition data
  isTransitionDrag: (e: React.DragEvent) => boolean;
}

// Threshold in seconds for detecting junction proximity
const JUNCTION_THRESHOLD = 0.5;

export function useTransitionDrop(): UseTransitionDropResult {
  const [activeJunction, setActiveJunction] = useState<JunctionHighlight | null>(null);
  const lastCheckTime = useRef<number>(0);

  const findClipJunction = useTimelineStore(state => state.findClipJunction);
  const applyTransition = useTimelineStore(state => state.applyTransition);

  // Check if the drag event contains transition data
  const isTransitionDrag = useCallback((e: React.DragEvent): boolean => {
    return e.dataTransfer.types.includes(TRANSITION_MIME_TYPE);
  }, []);

  // Handle dragover to highlight junctions
  const handleDragOver = useCallback((e: React.DragEvent, trackId: string, mouseTime: number) => {
    if (!isTransitionDrag(e)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Throttle junction checks
    const now = Date.now();
    if (now - lastCheckTime.current < 50) return;
    lastCheckTime.current = now;

    // Find nearby junction
    const junction = findClipJunction(trackId, mouseTime, JUNCTION_THRESHOLD);

    if (junction) {
      setActiveJunction({
        trackId,
        clipA: junction.clipA,
        clipB: junction.clipB,
        junctionTime: junction.junctionTime,
      });
    } else {
      setActiveJunction(null);
    }
  }, [isTransitionDrag, findClipJunction]);

  // Handle drop to apply transition
  const handleDrop = useCallback((e: React.DragEvent, trackId: string, mouseTime: number) => {
    if (!isTransitionDrag(e)) return;

    e.preventDefault();

    // Get transition data
    const dataStr = e.dataTransfer.getData(TRANSITION_MIME_TYPE);
    if (!dataStr) return;

    let transitionData: TransitionDropData;
    try {
      transitionData = JSON.parse(dataStr);
    } catch {
      return;
    }

    // Find the junction at drop point
    const junction = findClipJunction(trackId, mouseTime, JUNCTION_THRESHOLD);
    if (!junction) {
      setActiveJunction(null);
      return;
    }

    // Apply the transition
    applyTransition(
      junction.clipA.id,
      junction.clipB.id,
      transitionData.type,
      transitionData.duration
    );

    setActiveJunction(null);
  }, [isTransitionDrag, findClipJunction, applyTransition]);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setActiveJunction(null);
  }, []);

  return {
    activeJunction,
    handleDragOver,
    handleDrop,
    handleDragLeave,
    isTransitionDrag,
  };
}
