import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent, type RefObject } from 'react';

import { placeLiveInputOnTimeline } from '../../services/mediaRuntime/liveInputTimelineAdapter';
import {
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
} from '../../services/timeline/timelineExternalDropMediaResolver';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { AddClipOptions } from '../../stores/timeline/types';
import {
  EXTERNAL_DRAG_BRIDGE_EVENT,
  getExternalDragPayload,
  type ExternalDragBridgeEventDetail,
  type ExternalDragPayload,
} from '../timeline/utils/externalDragSession';

const MEDIA_FILE_MIME_TYPE = 'application/x-media-file-id';

export interface Preview3DMediaPlacementActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined>;
  addVideoTrack: () => string;
  getClip: (clipId: string) => { is3D?: boolean } | undefined;
  placeLiveInput: (mediaFile: MediaFile, trackId: string, startTime: number) => string | null;
  removeTrack: (trackId: string) => void;
  resolveMediaFile: (mediaFile: MediaFile) => Promise<File | null>;
  selectClip: (clipId: string) => void;
  toggle3D: (clipId: string) => void;
}

function isAudioOnlyMediaFile(mediaFile: MediaFile): boolean {
  return mediaFile.type === 'audio'
    || mediaFile.file?.type.startsWith('audio/') === true;
}

export function canDropMediaFileIn3DPreview(mediaFile: MediaFile | undefined): mediaFile is MediaFile {
  return Boolean(mediaFile && !isAudioOnlyMediaFile(mediaFile));
}

export async function placeMediaFileIn3DPreview(
  mediaFile: MediaFile,
  startTime: number,
  actions: Preview3DMediaPlacementActions,
): Promise<string | null> {
  if (!canDropMediaFileIn3DPreview(mediaFile)) return null;

  const resolvedFile = mediaFile.liveInput
    ? null
    : await actions.resolveMediaFile(mediaFile);
  if (!mediaFile.liveInput && !resolvedFile) return null;

  const trackId = actions.addVideoTrack();
  const clipId = mediaFile.liveInput
    ? actions.placeLiveInput(mediaFile, trackId, startTime)
    : await actions.addClip(
        trackId,
        resolvedFile!,
        startTime,
        mediaFile.duration,
        mediaFile.id,
        getTimelineDropMediaTypeOverride(mediaFile),
        {
          is3D: true,
          ...(mediaFile.type === 'video' || mediaFile.type === 'image'
            ? { visualScaleMode: 'fit' as const }
            : {}),
        },
      ) ?? null;

  if (!clipId) {
    actions.removeTrack(trackId);
    return null;
  }
  if (!actions.getClip(clipId)?.is3D) actions.toggle3D(clipId);
  actions.selectClip(clipId);
  return clipId;
}

function mediaFileIdFromPayload(payload: ExternalDragPayload | null): string | null {
  return payload?.kind === 'media-file' && !payload.isAudio ? payload.id : null;
}

function pointTargetsElement(element: HTMLElement | null, clientX: number, clientY: number): boolean {
  if (!element) return false;
  const target = document.elementFromPoint(clientX, clientY);
  return target instanceof Node && (target === element || element.contains(target));
}

interface UsePreview3DMediaDropInput {
  canvasWrapperRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

export function usePreview3DMediaDrop({
  canvasWrapperRef,
  enabled,
}: UsePreview3DMediaDropInput) {
  const [dropActive, setDropActive] = useState(false);

  const placeMediaFile = useCallback(async (mediaFileId: string) => {
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
    if (!enabled || !canDropMediaFileIn3DPreview(mediaFile)) return;

    const timeline = useTimelineStore.getState();
    await placeMediaFileIn3DPreview(mediaFile, timeline.playheadPosition, {
      addClip: timeline.addClip,
      addVideoTrack: () => useTimelineStore.getState().addTrack('video'),
      getClip: (clipId) => useTimelineStore.getState().clips.find((clip) => clip.id === clipId),
      placeLiveInput: (item, trackId, startTime) => placeLiveInputOnTimeline({
        item,
        trackId,
        startTime,
        duration: item.duration,
      }),
      removeTrack: (trackId) => {
        const current = useTimelineStore.getState();
        if (!current.clips.some((clip) => clip.trackId === trackId)) current.removeTrack(trackId);
      },
      resolveMediaFile: resolveMediaFileForTimelineDrop,
      selectClip: (clipId) => useTimelineStore.getState().selectClip(clipId),
      toggle3D: (clipId) => useTimelineStore.getState().toggle3D(clipId),
    });
  }, [enabled]);

  const getNativeMediaFileId = useCallback((dataTransfer: DataTransfer): string | null => {
    const payloadId = mediaFileIdFromPayload(getExternalDragPayload());
    const transferredId = dataTransfer.getData(MEDIA_FILE_MIME_TYPE);
    const mediaFileId = transferredId || payloadId;
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
    return enabled && canDropMediaFileIn3DPreview(mediaFile) ? mediaFileId : null;
  }, [enabled]);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(MEDIA_FILE_MIME_TYPE)) return;
    const payloadId = mediaFileIdFromPayload(getExternalDragPayload());
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === payloadId);
    if (!enabled || (payloadId && !canDropMediaFileIn3DPreview(mediaFile))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, [enabled]);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDropActive(false);
  }, []);

  const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const mediaFileId = getNativeMediaFileId(event.dataTransfer);
    setDropActive(false);
    if (!mediaFileId) return;
    event.preventDefault();
    event.stopPropagation();
    void placeMediaFile(mediaFileId);
  }, [getNativeMediaFileId, placeMediaFile]);

  useEffect(() => {
    if (!enabled) {
      setDropActive(false);
      return undefined;
    }

    const handleTouchDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExternalDragBridgeEventDetail>).detail;
      if (!detail) return;
      const targetsPreview = pointTargetsElement(
        canvasWrapperRef.current,
        detail.clientX,
        detail.clientY,
      );
      const mediaFileId = mediaFileIdFromPayload(getExternalDragPayload());
      const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
      const accepted = targetsPreview && canDropMediaFileIn3DPreview(mediaFile);
      setDropActive(detail.phase === 'move' && accepted);
      if (detail.phase === 'drop' && accepted && mediaFileId) {
        void placeMediaFile(mediaFileId);
      }
    };

    window.addEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleTouchDrag);
    return () => window.removeEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleTouchDrag);
  }, [canvasWrapperRef, enabled, placeMediaFile]);

  return {
    dropActive,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
