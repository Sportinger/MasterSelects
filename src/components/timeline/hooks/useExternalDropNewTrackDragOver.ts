import { useCallback, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import type { ExternalDragState } from '../types';
import type { ExternalDropImmediatePreview } from './externalDropImmediatePreview';

interface PreviewMetadataFallback {
  duration?: number;
  hasAudio?: boolean;
}

interface UseExternalDropNewTrackDragOverParams {
  hasTimelineElement: () => boolean;
  rejectDropDuringExport: (event: DragEvent) => boolean;
  getDesiredStartTime: (clientX: number) => number;
  resolveImmediateDragPreview: (event: DragEvent) => ExternalDropImmediatePreview;
  updateVideoNewTrackGesture: (clientY: number, isAudio: boolean) => boolean;
  getVideoNewTrackOffered: () => boolean;
  getPreviewMetadataFallback: () => PreviewMetadataFallback;
  setExternalDrag: Dispatch<SetStateAction<ExternalDragState | null>>;
}

export function useExternalDropNewTrackDragOver({
  hasTimelineElement,
  rejectDropDuringExport,
  getDesiredStartTime,
  resolveImmediateDragPreview,
  updateVideoNewTrackGesture,
  getVideoNewTrackOffered,
  getPreviewMetadataFallback,
  setExternalDrag,
}: UseExternalDropNewTrackDragOverParams) {
  return useCallback((event: DragEvent, trackType: 'video' | 'audio') => {
    if (rejectDropDuringExport(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const preview = resolveImmediateDragPreview(event);

    if (preview.isAudio && trackType === 'video') {
      updateVideoNewTrackGesture(event.clientY, true);
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }
    if (!preview.isAudio && trackType === 'audio') {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }

    const showVideoNewTrackZone = trackType === 'video'
      ? updateVideoNewTrackGesture(event.clientY, preview.isAudio)
      : getVideoNewTrackOffered();
    if (trackType === 'video' && !showVideoNewTrackZone) {
      event.dataTransfer.dropEffect = 'none';
      setExternalDrag(null);
      return;
    }

    event.dataTransfer.dropEffect = 'copy';
    if (!hasTimelineElement()) {
      setExternalDrag(null);
      return;
    }

    const startTime = getDesiredStartTime(event.clientX);
    const fallback = getPreviewMetadataFallback();

    setExternalDrag((prev) => ({
      trackId: '__new_track__',
      startTime,
      x: event.clientX,
      y: event.clientY,
      audioTrackId: undefined,
      videoTrackId: undefined,
      duration: preview.duration ?? prev?.duration ?? fallback.duration ?? 5,
      hasAudio: preview.hasAudio ?? prev?.hasAudio ?? fallback.hasAudio,
      newTrackType: trackType,
      isVideo: preview.isVideo,
      isAudio: preview.isAudio,
      showVideoNewTrackZone,
    }));
  }, [
    hasTimelineElement,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    updateVideoNewTrackGesture,
    getVideoNewTrackOffered,
    getPreviewMetadataFallback,
    setExternalDrag,
  ]);
}
