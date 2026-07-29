import { useCallback, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import type { TimelineTrack } from '../../../types';
import type { ExternalDragState } from '../types';
import type { ExternalDropImmediatePreview } from './externalDropImmediatePreview';
import {
  canDropExternalMediaPreviewOnTrack,
  hasGeneratedVisualDropType,
  hasTrackPreviewDropType,
} from './externalDropPreviewDragTypes';

interface TrackPreviewStateParams {
  trackId: string;
  desiredStartTime: number;
  x: number;
  y: number;
  duration?: number;
  hasAudio?: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

interface PreviewMetadataFallback {
  duration?: number;
  hasAudio?: boolean;
}

interface UseExternalDropTrackDragOverParams {
  tracks: TimelineTrack[];
  rejectDropDuringExport: (event: DragEvent) => boolean;
  getDesiredStartTime: (clientX: number) => number;
  resolveImmediateDragPreview: (event: DragEvent) => ExternalDropImmediatePreview;
  updateVideoNewTrackGesture: (clientY: number, isAudio: boolean) => boolean;
  buildTrackPreviewState: (params: TrackPreviewStateParams) => ExternalDragState | null;
  getPreviewMetadataFallback: () => PreviewMetadataFallback;
  setExternalDrag: Dispatch<SetStateAction<ExternalDragState | null>>;
}

export function useExternalDropTrackDragOver({
  tracks,
  rejectDropDuringExport,
  getDesiredStartTime,
  resolveImmediateDragPreview,
  updateVideoNewTrackGesture,
  buildTrackPreviewState,
  getPreviewMetadataFallback,
  setExternalDrag,
}: UseExternalDropTrackDragOverParams) {
  return useCallback((event: DragEvent, trackId: string) => {
    if (rejectDropDuringExport(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    const dataTransferTypes = event.dataTransfer.types;
    if (!hasTrackPreviewDropType(dataTransferTypes)) {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }

    const desiredStartTime = getDesiredStartTime(event.clientX);
    const preview = resolveImmediateDragPreview(event);
    const targetTrack = tracks.find((track) => track.id === trackId);
    if (!targetTrack || targetTrack.locked || targetTrack.type === 'midi') {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }
    const isAudioTrack = targetTrack?.type === 'audio';

    if (!canDropExternalMediaPreviewOnTrack(targetTrack.type, preview)) {
      event.dataTransfer.dropEffect = 'none';
      updateVideoNewTrackGesture(event.clientY, preview.isAudio);
      setExternalDrag(null);
      return;
    }

    if (isAudioTrack && hasGeneratedVisualDropType(dataTransferTypes)) {
      event.dataTransfer.dropEffect = 'none';
      updateVideoNewTrackGesture(event.clientY, false);
      setExternalDrag(null);
      return;
    }

    setExternalDrag((prev) => {
      const fallback = getPreviewMetadataFallback();
      const next = buildTrackPreviewState({
        trackId,
        desiredStartTime,
        x: event.clientX,
        y: event.clientY,
        duration: preview.duration ?? prev?.duration ?? fallback.duration,
        hasAudio: preview.hasAudio ?? prev?.hasAudio ?? fallback.hasAudio,
        isVideo: preview.isVideo,
        isAudio: preview.isAudio,
      });
      if (!next) {
        event.dataTransfer.dropEffect = 'none';
      }
      return next;
    });
  }, [
    tracks,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    updateVideoNewTrackGesture,
    buildTrackPreviewState,
    getPreviewMetadataFallback,
    setExternalDrag,
  ]);
}
