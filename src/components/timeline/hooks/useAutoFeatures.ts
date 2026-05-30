// Auto-start features: RAM preview after idle and proxy generation on demand

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { RAM_PREVIEW_IDLE_DELAY } from '../constants';
import type { TimelineClip } from '../../../types';

interface UseAutoFeaturesProps {
  ramPreviewEnabled: boolean;
  proxyEnabled: boolean;
  isPlaying: boolean;
  isDraggingPlayhead: boolean;
  isRamPreviewing: boolean;
  currentlyGeneratingProxyId: string | null;
  inPoint: number | null;
  outPoint: number | null;
  ramPreviewRange: { start: number; end: number } | null;
  clips: TimelineClip[];
  startRamPreview: () => void;
  cancelRamPreview: () => void;
}

/**
 * Auto-start RAM Preview after idle (like After Effects)
 * Keep proxy generation moving while proxy mode is enabled.
 */
export function useAutoFeatures({
  ramPreviewEnabled,
  proxyEnabled,
  isPlaying,
  isDraggingPlayhead,
  isRamPreviewing,
  currentlyGeneratingProxyId,
  inPoint,
  outPoint,
  ramPreviewRange,
  clips,
  startRamPreview,
  cancelRamPreview,
}: UseAutoFeaturesProps) {
  const ramIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel RAM preview when user starts playing or scrubbing (keep cached frames)
  useEffect(() => {
    if ((isPlaying || isDraggingPlayhead) && isRamPreviewing) {
      cancelRamPreview();
    }
  }, [isPlaying, isDraggingPlayhead, isRamPreviewing, cancelRamPreview]);

  // Auto-start RAM Preview after idle
  useEffect(() => {
    if (ramIdleTimerRef.current) {
      clearTimeout(ramIdleTimerRef.current);
      ramIdleTimerRef.current = null;
    }

    if (
      !ramPreviewEnabled ||
      isPlaying ||
      isRamPreviewing ||
      isDraggingPlayhead ||
      clips.length === 0
    ) {
      return;
    }

    const renderStart = inPoint ?? 0;
    const renderEnd =
      outPoint ?? Math.max(...clips.map((c) => c.startTime + c.duration));

    if (renderEnd - renderStart < 0.1) {
      return;
    }

    if (
      ramPreviewRange &&
      ramPreviewRange.start <= renderStart &&
      ramPreviewRange.end >= renderEnd
    ) {
      return;
    }

    ramIdleTimerRef.current = setTimeout(() => {
      const state = useTimelineStore.getState();
      if (state.ramPreviewEnabled && !state.isPlaying && !state.isRamPreviewing) {
        startRamPreview();
      }
    }, RAM_PREVIEW_IDLE_DELAY);

    return () => {
      if (ramIdleTimerRef.current) {
        clearTimeout(ramIdleTimerRef.current);
        ramIdleTimerRef.current = null;
      }
    };
  }, [
    ramPreviewEnabled,
    isPlaying,
    isRamPreviewing,
    isDraggingPlayhead,
    inPoint,
    outPoint,
    ramPreviewRange,
    clips,
    startRamPreview,
  ]);

  // Auto-generate proxies immediately when proxy mode is active.
  useEffect(() => {
    if (!proxyEnabled || currentlyGeneratingProxyId) {
      return;
    }

    useMediaStore.getState().startProxyGenerationQueue();
  }, [
    proxyEnabled,
    currentlyGeneratingProxyId,
    clips,
  ]);
}
