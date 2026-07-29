import { useCallback, type Dispatch, type DragEvent, type MutableRefObject, type SetStateAction } from 'react';
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

interface UseExternalDropTrackDragEnterParams {
  tracks: TimelineTrack[];
  dragCounterRef: MutableRefObject<number>;
  rejectDropDuringExport: (event: DragEvent) => boolean;
  getDesiredStartTime: (clientX: number) => number;
  resolveImmediateDragPreview: (event: DragEvent) => ExternalDropImmediatePreview;
  buildTrackPreviewState: (params: TrackPreviewStateParams) => ExternalDragState | null;
  setExternalDrag: Dispatch<SetStateAction<ExternalDragState | null>>;
}

export function useExternalDropTrackDragEnter({
  tracks,
  dragCounterRef,
  rejectDropDuringExport,
  getDesiredStartTime,
  resolveImmediateDragPreview,
  buildTrackPreviewState,
  setExternalDrag,
}: UseExternalDropTrackDragEnterParams) {
  return useCallback((event: DragEvent, trackId: string) => {
    if (rejectDropDuringExport(event)) return;
    event.preventDefault();
    dragCounterRef.current++;

    const dataTransferTypes = event.dataTransfer.types;
    if (!hasTrackPreviewDropType(dataTransferTypes)) {
      setExternalDrag(null);
      return;
    }

    const targetTrack = tracks.find((track) => track.id === trackId);
    if (!targetTrack || targetTrack.locked || targetTrack.type === 'midi') {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }
    const isAudioTrack = targetTrack?.type === 'audio';
    const startTime = getDesiredStartTime(event.clientX);
    const preview = resolveImmediateDragPreview(event);

    if (
      (isAudioTrack && hasGeneratedVisualDropType(dataTransferTypes)) ||
      !canDropExternalMediaPreviewOnTrack(targetTrack.type, preview)
    ) {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }

    setExternalDrag(buildTrackPreviewState({
      trackId,
      desiredStartTime: startTime,
      x: event.clientX,
      y: event.clientY,
      duration: preview.duration,
      hasAudio: preview.hasAudio,
      isVideo: preview.isVideo,
      isAudio: preview.isAudio,
    }));
  }, [
    tracks,
    dragCounterRef,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    buildTrackPreviewState,
    setExternalDrag,
  ]);
}
