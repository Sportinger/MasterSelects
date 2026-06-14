// Hook for handling transition drag and drop onto clip junctions

import { useState, useCallback, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { createTransitionJunctionGeometryReference } from '../../../stores/timeline/editOperations/transitionOperations';
import {
  getActiveTransitionDragData,
  parseTransitionDropData,
  setActiveTransitionDragData,
  TRANSITION_MIME_TYPE,
  type TransitionDropData,
} from '../transitionDragData';
import type { TimelineClip, TimelineTrack } from '../../../types';

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

function readTransitionDropData(e: React.DragEvent): TransitionDropData | null {
  return parseTransitionDropData(e.dataTransfer.getData(TRANSITION_MIME_TYPE))
    ?? getActiveTransitionDragData();
}

function isAudioClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio' || clip.file?.type?.startsWith('audio/') === true;
}

function canDropTransitionOnJunction(
  transitionData: TransitionDropData,
  junction: JunctionHighlight,
  track: TimelineTrack | undefined,
): boolean {
  if (!track) return false;

  const clipAIsAudio = isAudioClip(junction.clipA);
  const clipBIsAudio = isAudioClip(junction.clipB);
  if (track.type === 'audio' || clipAIsAudio || clipBIsAudio) {
    return transitionData.type === 'crossfade' &&
      track.type === 'audio' &&
      clipAIsAudio &&
      clipBIsAudio;
  }

  return track.type === 'video';
}

export function useTransitionDrop(): UseTransitionDropResult {
  const [activeJunction, setActiveJunction] = useState<JunctionHighlight | null>(null);
  const lastCheckTime = useRef<number>(0);

  const tracks = useTimelineStore(state => state.tracks);
  const findClipJunction = useTimelineStore(state => state.findClipJunction);
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);

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
    const transitionData = readTransitionDropData(e);
    const operationId = `transition-preview:${Date.now()}`;

    if (junction && transitionData) {
      const junctionHighlight = {
        trackId,
        clipA: junction.clipA,
        clipB: junction.clipB,
        junctionTime: junction.junctionTime,
      };
      if (!canDropTransitionOnJunction(transitionData, junctionHighlight, tracks.find(track => track.id === trackId))) {
        e.dataTransfer.dropEffect = 'none';
        setActiveJunction(null);
        applyTimelineEditOperation({
          id: operationId,
          type: 'transition-preview-drop',
          transactionId: operationId,
          historyBatchId: operationId,
          source: 'external-drop',
          geometrySnapshotId: `transition-geometry:${operationId}`,
          transitionType: transitionData.type,
          requestedDuration: transitionData.duration,
          junction: null,
        }, {
          source: 'external-drop',
          historyLabel: 'Preview transition drop',
        });
        return;
      }

      setActiveJunction(junctionHighlight);
      applyTimelineEditOperation({
        id: operationId,
        type: 'transition-preview-drop',
        transactionId: operationId,
        historyBatchId: operationId,
        source: 'external-drop',
        geometrySnapshotId: `transition-geometry:${operationId}`,
        transitionType: transitionData.type,
        requestedDuration: transitionData.duration,
        junction: createTransitionJunctionGeometryReference({
          operationId,
          trackId,
          clipAId: junction.clipA.id,
          clipBId: junction.clipB.id,
          junctionTime: junction.junctionTime,
          thresholdSeconds: JUNCTION_THRESHOLD,
        }),
      }, {
        source: 'external-drop',
        historyLabel: 'Preview transition drop',
      });
    } else {
      setActiveJunction(null);
      if (transitionData) {
        applyTimelineEditOperation({
          id: operationId,
          type: 'transition-preview-drop',
          transactionId: operationId,
          historyBatchId: operationId,
          source: 'external-drop',
          geometrySnapshotId: `transition-geometry:${operationId}`,
          transitionType: transitionData.type,
          requestedDuration: transitionData.duration,
          junction: null,
        }, {
          source: 'external-drop',
          historyLabel: 'Preview transition drop',
        });
      }
    }
  }, [isTransitionDrag, findClipJunction, applyTimelineEditOperation, tracks]);

  // Handle drop to apply transition
  const handleDrop = useCallback((e: React.DragEvent, trackId: string, mouseTime: number) => {
    if (!isTransitionDrag(e)) return;

    e.preventDefault();

    const transitionData = readTransitionDropData(e);
    if (!transitionData) {
      setActiveJunction(null);
      setActiveTransitionDragData(null);
      const clearId = `transition-clear:${Date.now()}`;
      applyTimelineEditOperation({
        id: clearId,
        type: 'transition-clear-preview',
        transactionId: clearId,
        historyBatchId: clearId,
        source: 'external-drop',
        reason: 'invalid-drop',
      }, {
        source: 'external-drop',
        historyLabel: 'Clear transition preview',
      });
      return;
    }

    // Find the junction at drop point
    const junction = findClipJunction(trackId, mouseTime, JUNCTION_THRESHOLD);
    const junctionHighlight = junction ? {
      trackId,
      clipA: junction.clipA,
      clipB: junction.clipB,
      junctionTime: junction.junctionTime,
    } : null;
    if (!junction || !junctionHighlight || !canDropTransitionOnJunction(
      transitionData,
      junctionHighlight,
      tracks.find(track => track.id === trackId),
    )) {
      setActiveJunction(null);
      setActiveTransitionDragData(null);
      const clearId = `transition-clear:${Date.now()}`;
      applyTimelineEditOperation({
        id: clearId,
        type: 'transition-clear-preview',
        transactionId: clearId,
        historyBatchId: clearId,
        source: 'external-drop',
        reason: 'invalid-drop',
      }, {
        source: 'external-drop',
        historyLabel: 'Clear transition preview',
      });
      return;
    }

    const operationId = `transition-drop:${Date.now()}`;
    applyTimelineEditOperation({
      id: operationId,
      type: 'transition-apply',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'external-drop',
      geometrySnapshotId: `transition-geometry:${operationId}`,
      clipAId: junction.clipA.id,
      clipBId: junction.clipB.id,
      transitionType: transitionData.type,
      requestedDuration: transitionData.duration,
      params: transitionData.params,
      junction: createTransitionJunctionGeometryReference({
        operationId,
        trackId,
        clipAId: junction.clipA.id,
        clipBId: junction.clipB.id,
        junctionTime: junction.junctionTime,
        thresholdSeconds: JUNCTION_THRESHOLD,
      }),
    }, {
      source: 'external-drop',
      historyLabel: 'Drop transition',
    });

    setActiveJunction(null);
    setActiveTransitionDragData(null);
    const clearId = `transition-clear:${operationId}`;
    applyTimelineEditOperation({
      id: clearId,
      type: 'transition-clear-preview',
      transactionId: clearId,
      historyBatchId: clearId,
      source: 'external-drop',
      reason: 'drop-complete',
    }, {
      source: 'external-drop',
      historyLabel: 'Clear transition preview',
    });
  }, [isTransitionDrag, findClipJunction, applyTimelineEditOperation, tracks]);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setActiveJunction(null);
    const operationId = `transition-clear:${Date.now()}`;
    applyTimelineEditOperation({
      id: operationId,
      type: 'transition-clear-preview',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'external-drop',
      reason: 'drag-leave',
    }, {
      source: 'external-drop',
      historyLabel: 'Clear transition preview',
    });
  }, [applyTimelineEditOperation]);

  return {
    activeJunction,
    handleDragOver,
    handleDrop,
    handleDragLeave,
    isTransitionDrag,
  };
}
