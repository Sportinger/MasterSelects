// External file drag & drop handling for timeline

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  isVideoFile,
  isAudioFile,
  isMediaFile,
  isModelFile,
  isGaussianSplatFile,
  getVideoMetadataQuick,
} from '../utils/fileTypeHelpers';
import { classifyMediaType } from '../../../stores/timeline/helpers/mediaTypeHelpers';
import {
  findClosestNonOverlappingStartTime,
  findFirstTrackWithoutOverlap,
} from '../utils/externalDragPlacement';
import {
  EXTERNAL_DRAG_BRIDGE_EVENT,
  getExternalDragPayload,
  type ExternalDragBridgeEventDetail,
  type ExternalDragPayload,
} from '../utils/externalDragSession';
import type { ExternalDragState } from '../types';
import type { TimelineTrack, TimelineClip } from '../../../types';
import type { Composition, MediaFile } from '../../../stores/mediaStore';
import { NativeHelperClient } from '../../../services/nativeHelper/NativeHelperClient';
import { Logger } from '../../../services/logger';

const log = Logger.create('useExternalDrop');

type FileWithPath = File & { path?: string };
type FileSystemDataTransferItem = DataTransferItem & {
  getAsFileSystemHandle: () => Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null>;
};

function setDroppedFilePath(file: File, filePath?: string): void {
  if (filePath) {
    (file as FileWithPath).path = filePath;
  }
}

const CLIP_TYPED_MEDIA_TYPES = new Set<MediaFile['type']>(['gaussian-splat', 'lottie', 'rive', 'model']);

function getTimelineMediaTypeOverride(mediaFile: MediaFile): string | undefined {
  return CLIP_TYPED_MEDIA_TYPES.has(mediaFile.type) ? mediaFile.type : undefined;
}

function getPlaceholderMimeType(mediaFile: MediaFile): string {
  const name = mediaFile.name.toLowerCase();

  if (mediaFile.type === 'model') {
    if (name.endsWith('.glb')) return 'model/gltf-binary';
    if (name.endsWith('.gltf')) return 'model/gltf+json';
    if (name.endsWith('.obj')) return 'model/obj';
  }

  if (mediaFile.type === 'gaussian-splat') {
    if (name.endsWith('.ply')) return 'application/octet-stream';
    if (name.endsWith('.spz')) return 'application/octet-stream';
  }

  return '';
}

function createPlaceholderFileForMedia(mediaFile: MediaFile): File {
  const file = new File([], mediaFile.name, { type: getPlaceholderMimeType(mediaFile) });
  setDroppedFilePath(file, mediaFile.absolutePath ?? mediaFile.filePath);
  return file;
}

function mediaFileHasLazy3DSource(mediaFile: MediaFile): boolean {
  if (mediaFile.file || mediaFile.url || mediaFile.absolutePath || mediaFile.projectPath) {
    return true;
  }

  if (mediaFile.modelSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.modelUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  )) {
    return true;
  }

  return Boolean(mediaFile.gaussianSplatSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.splatUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  ));
}

function isAudioOnlyMediaFile(mediaFile: MediaFile, file?: File): boolean {
  return mediaFile.type === 'audio' || Boolean(file && isAudioFile(file));
}

async function resolveMediaFileForTimeline(mediaFile: MediaFile): Promise<File | null> {
  if (mediaFile.file) {
    return mediaFile.file;
  }

  if (mediaFile.type === 'model' || mediaFile.type === 'gaussian-splat') {
    return mediaFileHasLazy3DSource(mediaFile) ? createPlaceholderFileForMedia(mediaFile) : null;
  }

  const nativeReferenceUrl = NativeHelperClient.parseFileReferenceUrl(mediaFile.url)
    ? mediaFile.url
    : mediaFile.absolutePath
      ? NativeHelperClient.getFileReferenceUrl(mediaFile.absolutePath)
      : null;

  if (!nativeReferenceUrl) {
    return null;
  }

  try {
    const file = await NativeHelperClient.getReferencedFile(nativeReferenceUrl, mediaFile.name);
    if (!file) {
      return null;
    }

    const referencedPath = NativeHelperClient.parseFileReferenceUrl(nativeReferenceUrl) ?? mediaFile.absolutePath;
    setDroppedFilePath(file, referencedPath ?? undefined);
    const url = URL.createObjectURL(file);

    useMediaStore.setState((state) => ({
      files: state.files.map((currentFile) =>
        currentFile.id === mediaFile.id
          ? {
              ...currentFile,
              file,
              url,
              hasFileHandle: true,
              absolutePath: currentFile.absolutePath ?? referencedPath ?? undefined,
            }
          : currentFile
      ),
    }));

    return file;
  } catch (error) {
    log.warn('Could not resolve restored media file for timeline drop', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      error,
    });
    return null;
  }
}

interface UseExternalDropProps {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  scrollX: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  pixelToTime: (pixel: number) => number;
  addTrack: (type: 'video' | 'audio') => string | undefined;
  addClip: (trackId: string, file: File, startTime: number, duration?: number, mediaFileId?: string, mediaTypeOverride?: string) => void;
  addCompClip: (trackId: string, comp: Composition, startTime: number) => void;
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => Promise<string | null>;
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  addMeshClip: (trackId: string, startTime: number, meshType: import('../../../stores/mediaStore/types').MeshPrimitiveType, duration?: number, skipMediaItem?: boolean) => string | null;
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
}

interface UseExternalDropReturn {
  externalDrag: ExternalDragState | null;
  setExternalDrag: React.Dispatch<React.SetStateAction<ExternalDragState | null>>;
  dragCounterRef: React.MutableRefObject<number>;
  handleTrackDragEnter: (e: React.DragEvent, trackId: string) => void;
  handleTrackDragOver: (e: React.DragEvent, trackId: string) => void;
  handleTrackDragLeave: (e: React.DragEvent) => void;
  handleTrackDrop: (e: React.DragEvent, trackId: string) => Promise<void>;
  handleNewTrackDragOver: (e: React.DragEvent, trackType: 'video' | 'audio') => void;
  handleNewTrackDrop: (e: React.DragEvent, trackType: 'video' | 'audio') => Promise<void>;
  handleContainerDragLeave: (e: React.DragEvent) => void;
}

type CustomExternalDragTarget =
  | { kind: 'track'; trackId: string }
  | { kind: 'new-track'; trackType: 'video' | 'audio' };

function getPayloadMimeTypes(payload: ExternalDragPayload): string[] {
  switch (payload.kind) {
    case 'composition':
      return ['application/x-composition-id'];
    case 'text':
      return ['application/x-text-item-id'];
    case 'solid':
      return ['application/x-solid-item-id'];
    case 'mesh':
      return ['application/x-mesh-item-id'];
    case 'camera':
      return ['application/x-camera-item-id'];
    case 'splat-effector':
      return ['application/x-splat-effector-item-id'];
    case 'media-file':
      return payload.isAudio
        ? ['application/x-media-file-id', 'application/x-media-is-audio']
        : ['application/x-media-file-id'];
  }
}

function getPayloadMimeData(payload: ExternalDragPayload, mimeType: string): string {
  if (mimeType === 'application/x-composition-id' && payload.kind === 'composition') return payload.id;
  if (mimeType === 'application/x-text-item-id' && payload.kind === 'text') return payload.id;
  if (mimeType === 'application/x-solid-item-id' && payload.kind === 'solid') return payload.id;
  if (mimeType === 'application/x-mesh-item-id' && payload.kind === 'mesh') return payload.id;
  if (mimeType === 'application/x-camera-item-id' && payload.kind === 'camera') return payload.id;
  if (mimeType === 'application/x-splat-effector-item-id' && payload.kind === 'splat-effector') return payload.id;
  if (mimeType === 'application/x-media-file-id' && payload.kind === 'media-file') return payload.id;
  if (mimeType === 'application/x-media-is-audio' && payload.kind === 'media-file' && payload.isAudio) return 'true';
  return '';
}

function createPayloadDragEvent(
  detail: ExternalDragBridgeEventDetail,
  payload: ExternalDragPayload,
): React.DragEvent {
  const types = getPayloadMimeTypes(payload);
  const dataTransfer = {
    types,
    dropEffect: 'copy',
    effectAllowed: 'copyMove',
    files: { length: 0, item: () => null },
    items: { length: 0, item: () => null },
    getData: (mimeType: string) => getPayloadMimeData(payload, mimeType),
    setData: () => undefined,
    clearData: () => undefined,
    setDragImage: () => undefined,
  } as unknown as DataTransfer;

  return {
    clientX: detail.clientX,
    clientY: detail.clientY,
    dataTransfer,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as React.DragEvent;
}

function resolveCustomExternalDragTarget(clientX: number, clientY: number): CustomExternalDragTarget | null {
  const elementAtPoint = document.elementFromPoint(clientX, clientY);
  const targetElement = elementAtPoint instanceof HTMLElement ? elementAtPoint : null;
  if (!targetElement) return null;

  const newTrackZone = targetElement.closest<HTMLElement>('.new-track-drop-zone');
  if (newTrackZone?.classList.contains('video')) {
    return { kind: 'new-track', trackType: 'video' };
  }
  if (newTrackZone?.classList.contains('audio')) {
    return { kind: 'new-track', trackType: 'audio' };
  }

  const trackLane = targetElement.closest<HTMLElement>('.track-lane[data-track-id]');
  const trackId = trackLane?.dataset.trackId;
  return trackId ? { kind: 'track', trackId } : null;
}

/**
 * Helper to extract file path from drag event
 */
function extractFilePath(e: React.DragEvent): string | undefined {
  // Try text/uri-list (Nautilus, Dolphin)
  const uriList = e.dataTransfer.getData('text/uri-list');
  if (uriList) {
    const uri = uriList.split('\n')[0]?.trim();
    if (uri?.startsWith('file://')) {
      return decodeURIComponent(uri.replace('file://', ''));
    }
  }

  // Try text/plain (some file managers)
  const plainText = e.dataTransfer.getData('text/plain');
  if (plainText?.startsWith('/') || plainText?.startsWith('file://')) {
    return plainText.startsWith('file://')
      ? decodeURIComponent(plainText.replace('file://', ''))
      : plainText;
  }

  // Try text/x-moz-url (Firefox)
  const mozUrl = e.dataTransfer.getData('text/x-moz-url');
  if (mozUrl?.startsWith('file://')) {
    return decodeURIComponent(mozUrl.split('\n')[0].replace('file://', ''));
  }

  return undefined;
}

export function useExternalDrop({
  timelineRef,
  scrollX,
  tracks,
  clips,
  pixelToTime,
  addTrack,
  addClip,
  addCompClip,
  addTextClip,
  addSolidClip,
  addMeshClip,
  addCameraClip,
  addSplatEffectorClip,
}: UseExternalDropProps): UseExternalDropReturn {
  const [externalDrag, setExternalDrag] = useState<ExternalDragState | null>(null);
  const dragCounterRef = useRef(0);
  const dragMetadataCacheRef = useRef<{ url: string; duration: number; hasAudio: boolean } | null>(null);
  const dragMetadataPendingRef = useRef<string | null>(null);

  const getDesiredStartTime = useCallback((clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;

    const x = clientX - rect.left + scrollX;
    return Math.max(0, pixelToTime(x));
  }, [timelineRef, scrollX, pixelToTime]);

  const resolveTrackStartTime = useCallback((
    trackId: string,
    desiredStartTime: number,
    duration?: number
  ) => {
    const previewDuration = duration ?? dragMetadataCacheRef.current?.duration ?? 5;
    return findClosestNonOverlappingStartTime(trackId, desiredStartTime, previewDuration, clips);
  }, [clips]);

  const buildTrackPreviewState = useCallback((params: {
    trackId: string;
    desiredStartTime: number;
    x: number;
    y: number;
    duration?: number;
    hasAudio?: boolean;
    isVideo: boolean;
    isAudio: boolean;
  }): ExternalDragState => {
    const {
      trackId,
      desiredStartTime,
      x,
      y,
      duration,
      hasAudio,
      isVideo,
      isAudio,
    } = params;

    const targetTrack = tracks.find((t) => t.id === trackId);
    const isVideoTrack = targetTrack?.type === 'video';
    const isAudioTrack = targetTrack?.type === 'audio';
    const previewDuration = duration ?? dragMetadataCacheRef.current?.duration ?? 5;
    const previewHasAudio = hasAudio ?? dragMetadataCacheRef.current?.hasAudio;
    const resolvedStartTime = resolveTrackStartTime(trackId, desiredStartTime, previewDuration);

    let audioTrackId: string | undefined;
    let videoTrackId: string | undefined;

    if (isVideoTrack && isVideo && !isAudio && (previewHasAudio ?? true)) {
      audioTrackId =
        findFirstTrackWithoutOverlap('audio', resolvedStartTime, previewDuration, tracks, clips) ??
        '__new_audio_track__';
    } else if (isAudioTrack && isVideo && !isAudio) {
      videoTrackId =
        findFirstTrackWithoutOverlap('video', resolvedStartTime, previewDuration, tracks, clips) ??
        '__new_video_track__';
    }

    return {
      trackId,
      startTime: resolvedStartTime,
      x,
      y,
      audioTrackId,
      videoTrackId,
      isVideo,
      isAudio,
      hasAudio: previewHasAudio,
      duration: previewDuration,
    };
  }, [tracks, clips, resolveTrackStartTime]);

  const updateResolvedDragMetadata = useCallback((cacheKey: string, duration: number, hasAudio: boolean) => {
    dragMetadataCacheRef.current = { url: cacheKey, duration, hasAudio };
    if (dragMetadataPendingRef.current === cacheKey) {
      dragMetadataPendingRef.current = null;
    }

    setExternalDrag((prev) => {
      if (!prev) return null;
      if (!prev.trackId || prev.trackId === '__new_track__') {
        return { ...prev, duration, hasAudio };
      }

      return buildTrackPreviewState({
        trackId: prev.trackId,
        desiredStartTime: getDesiredStartTime(prev.x),
        x: prev.x,
        y: prev.y,
        duration,
        hasAudio,
        isVideo: prev.isVideo ?? !prev.isAudio,
        isAudio: !!prev.isAudio,
      });
    });
  }, [buildTrackPreviewState, getDesiredStartTime]);

  const requestVideoDragMetadata = useCallback((cacheKey: string, file: File) => {
    if (dragMetadataCacheRef.current?.url === cacheKey) {
      return;
    }
    if (dragMetadataPendingRef.current === cacheKey) {
      return;
    }

    dragMetadataPendingRef.current = cacheKey;
    getVideoMetadataQuick(file).then((metadata) => {
      if (!metadata?.duration) return;
      updateResolvedDragMetadata(cacheKey, metadata.duration, metadata.hasAudio);
    }).finally(() => {
      if (dragMetadataPendingRef.current === cacheKey) {
        dragMetadataPendingRef.current = null;
      }
    });
  }, [updateResolvedDragMetadata]);

  const resolveImmediateDragPreview = useCallback((e: React.DragEvent) => {
    const mediaStore = useMediaStore.getState();
    const dragPayload = getExternalDragPayload();

    if (e.dataTransfer.types.includes('application/x-composition-id')) {
      if (dragPayload?.kind === 'composition') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: dragPayload.hasAudio ?? true,
          isAudio: false,
          isVideo: true,
        };
      }

      const compositionId = e.dataTransfer.getData('application/x-composition-id');
      const comp = mediaStore.compositions.find((c) => c.id === compositionId);
      return {
        duration: comp?.timelineData?.duration ?? comp?.duration ?? 5,
        hasAudio: true,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-text-item-id')) {
      if (dragPayload?.kind === 'text') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const textItemId = e.dataTransfer.getData('application/x-text-item-id');
      const textItem = mediaStore.textItems.find((t) => t.id === textItemId);
      return {
        duration: textItem?.duration ?? 5,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-solid-item-id')) {
      if (dragPayload?.kind === 'solid') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const solidItemId = e.dataTransfer.getData('application/x-solid-item-id');
      const solidItem = mediaStore.solidItems.find((s) => s.id === solidItemId);
      return {
        duration: solidItem?.duration ?? 5,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-mesh-item-id')) {
      if (dragPayload?.kind === 'mesh') {
        return {
          duration: dragPayload.duration ?? 10,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const meshItemId = e.dataTransfer.getData('application/x-mesh-item-id');
      const meshItem = mediaStore.meshItems.find((m) => m.id === meshItemId);
      return {
        duration: meshItem?.duration ?? 10,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-camera-item-id')) {
      if (dragPayload?.kind === 'camera') {
        return {
          duration: dragPayload.duration ?? 10,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const cameraItemId = e.dataTransfer.getData('application/x-camera-item-id');
      const cameraItem = mediaStore.cameraItems.find((c) => c.id === cameraItemId);
      return {
        duration: cameraItem?.duration ?? 10,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-splat-effector-item-id')) {
      if (dragPayload?.kind === 'splat-effector') {
        return {
          duration: dragPayload.duration ?? 10,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const effectorItemId = e.dataTransfer.getData('application/x-splat-effector-item-id');
      const effectorItem = mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId);
      return {
        duration: effectorItem?.duration ?? 10,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-media-file-id')) {
      if (dragPayload?.kind === 'media-file') {
        if (dragPayload.file && dragPayload.isVideo && dragPayload.duration === undefined) {
          requestVideoDragMetadata(`media:${dragPayload.id}`, dragPayload.file);
        }

        return {
          duration: dragPayload.duration,
          hasAudio: dragPayload.hasAudio,
          isAudio: dragPayload.isAudio,
          isVideo: dragPayload.isVideo,
        };
      }

      const mediaFileId = e.dataTransfer.getData('application/x-media-file-id');
      const mediaFile = mediaStore.files.find((f) => f.id === mediaFileId);
      const isAudio =
        e.dataTransfer.types.includes('application/x-media-is-audio') ||
        mediaFile?.type === 'audio';
      const isVideo = !isAudio;
      const duration = mediaFile?.duration;
      const hasAudio =
        mediaFile?.type === 'image'
          ? false
          : isAudio
            ? true
            : mediaFile?.hasAudio;

      if (mediaFile?.file && mediaFile.type === 'video' && duration === undefined) {
        requestVideoDragMetadata(`media:${mediaFile.id}`, mediaFile.file);
      }

      return { duration, hasAudio, isAudio, isVideo };
    }

    if (e.dataTransfer.types.includes('Files')) {
      let duration = externalDrag?.duration ?? dragMetadataCacheRef.current?.duration;
      let hasAudio = externalDrag?.hasAudio ?? dragMetadataCacheRef.current?.hasAudio;
      let isAudio = false;
      let isVideo = true;

      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind !== 'file') continue;

          const file = item.getAsFile();
          if (!file) continue;

          if (isAudioFile(file)) {
            isAudio = true;
            isVideo = false;
            hasAudio = true;
            break;
          }

          if (isVideoFile(file)) {
            const cacheKey = `${file.name}_${file.size}`;
            if (dragMetadataCacheRef.current?.url === cacheKey) {
              duration = dragMetadataCacheRef.current.duration;
              hasAudio = dragMetadataCacheRef.current.hasAudio;
            } else {
              requestVideoDragMetadata(cacheKey, file);
            }
            break;
          }

          if (isGaussianSplatFile(file)) {
            duration = duration ?? 10;
            hasAudio = false;
            isVideo = true;
            isAudio = false;
            break;
          }

          if (isModelFile(file)) {
            duration = duration ?? 10;
            hasAudio = false;
            isVideo = true;
            isAudio = false;
            break;
          }

          if (isMediaFile(file)) {
            hasAudio = false;
            break;
          }
        }
      }

      return { duration, hasAudio, isAudio, isVideo };
    }

    return {
      duration: externalDrag?.duration ?? dragMetadataCacheRef.current?.duration,
      hasAudio: externalDrag?.hasAudio ?? dragMetadataCacheRef.current?.hasAudio,
      isAudio: !!externalDrag?.isAudio,
      isVideo: externalDrag?.isVideo ?? !externalDrag?.isAudio,
    };
  }, [externalDrag, requestVideoDragMetadata]);

  // Handle external file drag enter on track
  const handleTrackDragEnter = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault();
      dragCounterRef.current++;

      const startTime = getDesiredStartTime(e.clientX);
      const mediaStore = useMediaStore.getState();

      // Determine target track type
      const targetTrack = tracks.find((t) => t.id === trackId);
      const isVideoTrack = targetTrack?.type === 'video';
      const isAudioTrack = targetTrack?.type === 'audio';
      const dragPayload = getExternalDragPayload();

      if (e.dataTransfer.types.includes('application/x-composition-id')) {
        const compositionId = dragPayload?.kind === 'composition'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-composition-id');
        const comp = compositionId
          ? mediaStore.compositions.find((c) => c.id === compositionId)
          : null;
        const compDuration = dragPayload?.kind === 'composition'
          ? dragPayload.duration ?? 5
          : comp?.timelineData?.duration ?? comp?.duration ?? 5;

        // Compositions only on video tracks
        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration: compDuration,
            hasAudio: true,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration: compDuration,
          hasAudio: true,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('application/x-media-file-id')) {
        const mediaFileId = dragPayload?.kind === 'media-file'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-media-file-id');
        const mediaFile = mediaFileId
          ? mediaStore.files.find((f) => f.id === mediaFileId)
          : null;
        const file = dragPayload?.kind === 'media-file' ? dragPayload.file : mediaFile?.file;
        const isAudioDrag = dragPayload?.kind === 'media-file'
          ? dragPayload.isAudio
          : e.dataTransfer.types.includes('application/x-media-is-audio') ||
            mediaFile?.type === 'audio';
        const isVideoDrag = dragPayload?.kind === 'media-file'
          ? dragPayload.isVideo
          : mediaFile?.type === 'video';
        const duration = dragPayload?.kind === 'media-file'
          ? dragPayload.duration
          : mediaFile?.duration;
        const hasAudio = dragPayload?.kind === 'media-file'
          ? dragPayload.hasAudio
          : mediaFile?.type === 'image'
            ? false
            : isAudioDrag
              ? true
              : mediaFile?.hasAudio;

        if (mediaFile?.duration && mediaFile?.hasAudio !== undefined) {
          dragMetadataCacheRef.current = {
            url: `media:${mediaFile.id}`,
            duration: mediaFile.duration,
            hasAudio: mediaFile.hasAudio,
          };
        }

        // Audio-only files can only go on audio tracks
        if (isAudioDrag && isVideoTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio,
            isVideo: false,
            isAudio: true,
          });
          return;
        }

        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio,
          isVideo: !isAudioDrag,
          isAudio: isAudioDrag,
        }));

        if (file && isVideoDrag && duration === undefined) {
          const cacheKey = `media:${mediaFileId || `${file.name}_${file.size}`}`;
          requestVideoDragMetadata(cacheKey, file);
        }
        return;
      }

      if (e.dataTransfer.types.includes('application/x-text-item-id')) {
        const textItemId = dragPayload?.kind === 'text'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-text-item-id');
        const textItem = textItemId
          ? mediaStore.textItems.find((t) => t.id === textItemId)
          : null;
        const duration = dragPayload?.kind === 'text'
          ? dragPayload.duration ?? 5
          : textItem?.duration ?? 5;

        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio: false,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('application/x-solid-item-id')) {
        const solidItemId = dragPayload?.kind === 'solid'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-solid-item-id');
        const solidItem = solidItemId
          ? mediaStore.solidItems.find((s) => s.id === solidItemId)
          : null;
        const duration = dragPayload?.kind === 'solid'
          ? dragPayload.duration ?? 5
          : solidItem?.duration ?? 5;

        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio: false,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('application/x-mesh-item-id')) {
        const meshItemId = dragPayload?.kind === 'mesh'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-mesh-item-id');
        const meshItem = meshItemId
          ? mediaStore.meshItems.find((m) => m.id === meshItemId)
          : null;
        const duration = dragPayload?.kind === 'mesh'
          ? dragPayload.duration ?? 10
          : meshItem?.duration ?? 10;

        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio: false,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('application/x-camera-item-id')) {
        const cameraItemId = dragPayload?.kind === 'camera'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-camera-item-id');
        const cameraItem = cameraItemId
          ? mediaStore.cameraItems.find((c) => c.id === cameraItemId)
          : null;
        const duration = dragPayload?.kind === 'camera'
          ? dragPayload.duration ?? 10
          : cameraItem?.duration ?? 10;

        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio: false,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('application/x-splat-effector-item-id')) {
        const effectorItemId = dragPayload?.kind === 'splat-effector'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-splat-effector-item-id');
        const effectorItem = effectorItemId
          ? mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId)
          : null;
        const duration = dragPayload?.kind === 'splat-effector'
          ? dragPayload.duration ?? 10
          : effectorItem?.duration ?? 10;

        if (isAudioTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          });
          return;
        }
        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration,
          hasAudio: false,
          isVideo: true,
          isAudio: false,
        }));
        return;
      }

      if (e.dataTransfer.types.includes('Files')) {
        let dur: number | undefined;
        let hasAudio: boolean | undefined;
        let fileIsAudio = false;
        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
              const file = item.getAsFile();
              if (file && isAudioFile(file)) {
                fileIsAudio = true;
                break;
              }
              if (file && isGaussianSplatFile(file)) {
                dur = 10;
                hasAudio = false;
                break;
              }
              if (file && isVideoFile(file)) {
                const cacheKey = `${file.name}_${file.size}`;
                if (dragMetadataCacheRef.current?.url === cacheKey) {
                  dur = dragMetadataCacheRef.current.duration;
                  hasAudio = dragMetadataCacheRef.current.hasAudio;
                } else {
                  getVideoMetadataQuick(file).then((metadata) => {
                    if (!metadata?.duration) return;
                    updateResolvedDragMetadata(cacheKey, metadata.duration, metadata.hasAudio);
                  });
                }
                break;
              }
            }
          }
        }

        // Audio files on video tracks: keep externalDrag alive but don't assign this track
        if (fileIsAudio && isVideoTrack) {
          setExternalDrag({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration: dur,
            hasAudio: true,
            isAudio: true,
            isVideo: false,
          });
          return;
        }

        setExternalDrag(buildTrackPreviewState({
          trackId,
          desiredStartTime: startTime,
          x: e.clientX,
          y: e.clientY,
          duration: dur,
          hasAudio,
          isAudio: fileIsAudio,
          isVideo: !fileIsAudio,
        }));
      }
    },
    [tracks, getDesiredStartTime, buildTrackPreviewState, requestVideoDragMetadata, updateResolvedDragMetadata]
  );

  // Handle external file drag over track
  const handleTrackDragOver = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      const isCompDrag = e.dataTransfer.types.includes('application/x-composition-id');
      const isMediaPanelDrag = e.dataTransfer.types.includes('application/x-media-file-id');
      const isTextDrag = e.dataTransfer.types.includes('application/x-text-item-id');
      const isSolidDrag = e.dataTransfer.types.includes('application/x-solid-item-id');
      const isCameraDrag = e.dataTransfer.types.includes('application/x-camera-item-id');
      const isFileDrag = e.dataTransfer.types.includes('Files');

      if (isCompDrag || isMediaPanelDrag || isTextDrag || isSolidDrag || isCameraDrag || isFileDrag) {
        const desiredStartTime = getDesiredStartTime(e.clientX);
        const preview = resolveImmediateDragPreview(e);

        const targetTrack = tracks.find((t) => t.id === trackId);
        const isVideoTrack = targetTrack?.type === 'video';
        const isAudioTrack = targetTrack?.type === 'audio';

        // Detect audio-only drag (from media panel marker or from externalDrag state)
        const isAudioDrag = preview.isAudio;

        // Audio-only files can only go on audio tracks
        if (isAudioDrag && isVideoTrack) {
          e.dataTransfer.dropEffect = 'none';
          setExternalDrag((prev) => prev ? {
            ...prev,
            trackId: '',
            startTime: desiredStartTime,
            x: e.clientX,
            y: e.clientY,
            audioTrackId: undefined,
            videoTrackId: undefined,
            newTrackType: null,
          } : null);
          return;
        }

        // Text, solid, camera, and composition items can only go on video tracks
        if ((isTextDrag || isSolidDrag || isCameraDrag || isCompDrag) && isAudioTrack) {
          e.dataTransfer.dropEffect = 'none';
          setExternalDrag((prev) => prev ? {
            ...prev,
            trackId: '',
            startTime: desiredStartTime,
            x: e.clientX,
            y: e.clientY,
            audioTrackId: undefined,
            videoTrackId: undefined,
            newTrackType: null,
          } : null);
          return;
        }

        setExternalDrag((prev) => buildTrackPreviewState({
          trackId,
          desiredStartTime,
          x: e.clientX,
          y: e.clientY,
          duration: preview.duration ?? prev?.duration ?? dragMetadataCacheRef.current?.duration,
          hasAudio: preview.hasAudio ?? prev?.hasAudio ?? dragMetadataCacheRef.current?.hasAudio,
          isVideo: preview.isVideo,
          isAudio: preview.isAudio,
        }));
        /*

        if (isVideoTrack && videoHasAudio) {
          // Hovering video track → find audio track for linked audio preview
          const audioTracks = tracks.filter((t) => t.type === 'audio');
          for (const aTrack of audioTracks) {
            const trackClips = clips.filter((c) => c.trackId === aTrack.id);
            const hasOverlap = trackClips.some((clip) => {
              const clipEnd = clip.startTime + clip.duration;
              return !(endTime <= clip.startTime || startTime >= clipEnd);
            });
            if (!hasOverlap) {
              audioTrackId = aTrack.id;
              break;
            }
          }
          if (!audioTrackId) {
            audioTrackId = '__new_audio_track__';
          }
        } else if (isAudioTrack && !isAudioDrag) {
          // Hovering audio track with video+audio file → find video track for linked video preview
          const videoTracks = tracks.filter((t) => t.type === 'video');
          for (const vTrack of videoTracks) {
            const trackClips = clips.filter((c) => c.trackId === vTrack.id);
            const hasOverlap = trackClips.some((clip) => {
              const clipEnd = clip.startTime + clip.duration;
              return !(endTime <= clip.startTime || startTime >= clipEnd);
            });
            if (!hasOverlap) {
              videoTrackId = vTrack.id;
              break;
            }
          }
          if (!videoTrackId) {
            videoTrackId = '__new_video_track__';
          }
        }

        setExternalDrag((prev) => ({
          trackId,
          startTime,
          x: e.clientX,
          y: e.clientY,
          audioTrackId,
          videoTrackId,
          isVideo: prev?.isVideo ?? !isAudioDrag,
          isAudio: prev?.isAudio ?? isAudioDrag,
          hasAudio: prev?.hasAudio ?? dragMetadataCacheRef.current?.hasAudio,
          duration: prev?.duration ?? dragMetadataCacheRef.current?.duration,
        }));
        */
      }
    },
    [tracks, getDesiredStartTime, buildTrackPreviewState, resolveImmediateDragPreview]
  );

  // Handle external file drag leave
  const handleTrackDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;

    if (dragCounterRef.current === 0) {
      // Don't null out externalDrag — just clear trackId so no preview shows on any track.
      // The state stays alive so drop zones remain mounted and reachable.
      // Full cleanup happens when drag leaves the timeline container (handleContainerDragLeave).
      setExternalDrag((prev) => prev ? {
        ...prev,
        trackId: '',
        audioTrackId: undefined,
        videoTrackId: undefined,
        newTrackType: null,
      } : null);
    }
  }, []);

  // Handle drag over "new track" drop zone
  const handleNewTrackDragOver = useCallback(
    (e: React.DragEvent, trackType: 'video' | 'audio') => {
      e.preventDefault();
      e.stopPropagation();

      const preview = resolveImmediateDragPreview(e);

      // Audio files can only create audio tracks
      if (preview.isAudio && trackType === 'video') {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      if (!preview.isAudio && trackType === 'audio') {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      e.dataTransfer.dropEffect = 'copy';

      if (timelineRef.current) {
        const startTime = getDesiredStartTime(e.clientX);

        setExternalDrag((prev) => ({
          trackId: '__new_track__',
          startTime,
          x: e.clientX,
          y: e.clientY,
          audioTrackId: undefined,
          videoTrackId: undefined,
          duration: preview.duration ?? prev?.duration ?? dragMetadataCacheRef.current?.duration ?? 5,
          hasAudio: preview.hasAudio ?? prev?.hasAudio ?? dragMetadataCacheRef.current?.hasAudio,
          newTrackType: trackType,
          isVideo: preview.isVideo,
          isAudio: preview.isAudio,
        }));
      }
    },
    [timelineRef, getDesiredStartTime, resolveImmediateDragPreview]
  );

  // Handle drop on "new track" zone - creates new track and adds clip
  const handleNewTrackDrop = useCallback(
    async (e: React.DragEvent, trackType: 'video' | 'audio') => {
      e.preventDefault();
      e.stopPropagation();

      const cachedDuration =
        externalDrag?.duration ?? dragMetadataCacheRef.current?.duration;

      dragCounterRef.current = 0;
      setExternalDrag(null);

      // Validate file type matches track type BEFORE creating track
      const mediaFileId = e.dataTransfer.getData('application/x-media-file-id');
      if (mediaFileId) {
        const mediaStore = useMediaStore.getState();
        const mediaFile = mediaStore.files.find((f) => f.id === mediaFileId);
        if (mediaFile) {
          const fileIsAudio = isAudioOnlyMediaFile(mediaFile, mediaFile.file);
          if (fileIsAudio && trackType === 'video') {
            log.debug('Audio files can only be dropped on audio tracks');
            return;
          }
          if (!fileIsAudio && trackType === 'audio') {
            log.debug('Video/image files can only be dropped on video tracks');
            return;
          }
        }
      }

      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const fileIsAudio = isAudioFile(file);
        if (fileIsAudio && trackType === 'video') {
          log.debug('Audio files can only be dropped on audio tracks');
          return;
        }
        if (!fileIsAudio && trackType === 'audio') {
          log.debug('Video/image files can only be dropped on video tracks');
          return;
        }
      }

      // Create a new track
      const newTrackId = addTrack(trackType);
      if (!newTrackId) return;

      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + scrollX;
      const startTime = Math.max(0, pixelToTime(x));
      const filePath = extractFilePath(e);

      // Handle composition drag
      const compositionId = e.dataTransfer.getData('application/x-composition-id');
      if (compositionId) {
        const mediaStore = useMediaStore.getState();
        const comp = mediaStore.compositions.find((c) => c.id === compositionId);
        if (comp) {
          addCompClip(newTrackId, comp, startTime);
          return;
        }
      }

      // Handle text item drag (skipMediaItem=true since it already exists in media panel)
      const textItemId = e.dataTransfer.getData('application/x-text-item-id');
      if (textItemId) {
        const mediaStore = useMediaStore.getState();
        const textItem = mediaStore.textItems.find((t) => t.id === textItemId);
        if (textItem) {
          addTextClip(newTrackId, startTime, textItem.duration, true);
          return;
        }
      }

      // Handle solid item drag (skipMediaItem=true since it already exists in media panel)
      const solidItemId = e.dataTransfer.getData('application/x-solid-item-id');
      if (solidItemId) {
        const mediaStore = useMediaStore.getState();
        const solidItem = mediaStore.solidItems.find((s) => s.id === solidItemId);
        if (solidItem) {
          addSolidClip(newTrackId, startTime, solidItem.color, solidItem.duration, true);
          return;
        }
      }

      // Handle mesh item drag (skipMediaItem=true since it already exists in media panel)
      const meshItemId = e.dataTransfer.getData('application/x-mesh-item-id');
      if (meshItemId) {
        const mediaStore = useMediaStore.getState();
        const meshItem = mediaStore.meshItems.find((m) => m.id === meshItemId);
        if (meshItem) {
          addMeshClip(newTrackId, startTime, meshItem.meshType, meshItem.duration, true);
          return;
        }
      }

      // Handle camera item drag (skipMediaItem=true since it already exists in media panel)
      const cameraItemId = e.dataTransfer.getData('application/x-camera-item-id');
      if (cameraItemId) {
        const mediaStore = useMediaStore.getState();
        const cameraItem = mediaStore.cameraItems.find((c) => c.id === cameraItemId);
        if (cameraItem) {
          addCameraClip(newTrackId, startTime, cameraItem.duration, true);
          return;
        }
      }

      const effectorItemId = e.dataTransfer.getData('application/x-splat-effector-item-id');
      if (effectorItemId) {
        const mediaStore = useMediaStore.getState();
        const effectorItem = mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId);
        if (effectorItem) {
          addSplatEffectorClip(newTrackId, startTime, effectorItem.duration, true);
          return;
        }
      }

      // Handle media panel drag
      if (mediaFileId) {
        const mediaStore = useMediaStore.getState();
        const mediaFile = mediaStore.files.find((f) => f.id === mediaFileId);
        if (mediaFile) {
          const file = await resolveMediaFileForTimeline(mediaFile);
          if (!file) {
            log.warn('Could not add media panel item to new track because the file is not resolved', {
              mediaFileId,
              name: mediaFile.name,
            });
            return;
          }

          addClip(newTrackId, file, startTime, mediaFile.duration, mediaFileId, getTimelineMediaTypeOverride(mediaFile));
          return;
        }
      }

      // Handle external file drop
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const item = items[0];
        if (item.kind === 'file') {
          const mediaStore = useMediaStore.getState();

          // Try to get file handle (File System Access API)
          if ('getAsFileSystemHandle' in item) {
            try {
              const handle = await (item as FileSystemDataTransferItem).getAsFileSystemHandle();
              if (handle && handle.kind === 'file') {
                const file = await handle.getFile();
                setDroppedFilePath(file, filePath);
                if (isMediaFile(file)) {
                  const typeOverride = await classifyMediaType(file);
                  if (typeOverride === 'unknown') {
                    return;
                  }
                  // Add clip immediately for instant visual feedback
                  addClip(newTrackId, file, startTime, cachedDuration, undefined, typeOverride);
                  // Fire-and-forget media import (loadVideoMedia will pick it up)
                  mediaStore.importFilesWithHandles([{ file, handle, absolutePath: filePath }]);
                  log.debug('Imported file with handle:', { name: file.name, absolutePath: filePath });
                  return;
                }
              }
            } catch (err) {
              log.warn('Could not get file handle, falling back:', err);
            }
          }

          // Fallback to regular file (no handle)
          const file = item.getAsFile();
          if (file) setDroppedFilePath(file, filePath);
          if (file && isMediaFile(file)) {
            const typeOverride = await classifyMediaType(file);
            if (typeOverride === 'unknown') {
              return;
            }
            // Add clip immediately for instant visual feedback
            addClip(newTrackId, file, startTime, cachedDuration, undefined, typeOverride);
            // Fire-and-forget media import (loadVideoMedia will pick it up)
            mediaStore.importFile(file);
          }
        }
      }
    },
    [scrollX, pixelToTime, addTrack, addCompClip, addClip, addTextClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, externalDrag, timelineRef]
  );

  // Handle external file drop on track
  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, trackId: string) => {
      e.preventDefault();

      const desiredStartTime = getDesiredStartTime(e.clientX);
      const resolveDropStartTime = (duration?: number) =>
        resolveTrackStartTime(trackId, desiredStartTime, duration ?? externalDrag?.duration);

      const cachedDuration =
        externalDrag?.duration ?? dragMetadataCacheRef.current?.duration;

      dragCounterRef.current = 0;
      setExternalDrag(null);

      // Get track type for validation
      const targetTrack = tracks.find((t) => t.id === trackId);
      const isVideoTrack = targetTrack?.type === 'video';

      const compositionId = e.dataTransfer.getData('application/x-composition-id');
      if (compositionId) {
        const mediaStore = useMediaStore.getState();
        const comp = mediaStore.compositions.find((c) => c.id === compositionId);
        if (comp) {
          const compDuration = comp.timelineData?.duration ?? comp.duration ?? 5;
          addCompClip(trackId, comp, resolveDropStartTime(compDuration));
          return;
        }
      }

      // Handle text item drag from media panel (skipMediaItem=true since it already exists)
      const textItemId = e.dataTransfer.getData('application/x-text-item-id');
      if (textItemId) {
        const mediaStore = useMediaStore.getState();
        const textItem = mediaStore.textItems.find((t) => t.id === textItemId);
        if (textItem && isVideoTrack) {
          addTextClip(trackId, resolveDropStartTime(textItem.duration), textItem.duration, true);
          return;
        }
      }

      // Handle solid item drag from media panel (skipMediaItem=true since it already exists)
      const solidItemId = e.dataTransfer.getData('application/x-solid-item-id');
      if (solidItemId) {
        const mediaStore = useMediaStore.getState();
        const solidItem = mediaStore.solidItems.find((s) => s.id === solidItemId);
        if (solidItem && isVideoTrack) {
          addSolidClip(trackId, resolveDropStartTime(solidItem.duration), solidItem.color, solidItem.duration, true);
          return;
        }
      }

      // Handle mesh item drag from media panel (skipMediaItem=true since it already exists)
      const meshItemId = e.dataTransfer.getData('application/x-mesh-item-id');
      if (meshItemId) {
        const mediaStore = useMediaStore.getState();
        const meshItem = mediaStore.meshItems.find((m) => m.id === meshItemId);
        if (meshItem && isVideoTrack) {
          addMeshClip(trackId, resolveDropStartTime(meshItem.duration), meshItem.meshType, meshItem.duration, true);
          return;
        }
      }

      // Handle camera item drag from media panel (skipMediaItem=true since it already exists)
      const cameraItemId = e.dataTransfer.getData('application/x-camera-item-id');
      if (cameraItemId) {
        const mediaStore = useMediaStore.getState();
        const cameraItem = mediaStore.cameraItems.find((c) => c.id === cameraItemId);
        if (cameraItem && isVideoTrack) {
          addCameraClip(trackId, resolveDropStartTime(cameraItem.duration), cameraItem.duration, true);
          return;
        }
      }

      const effectorItemId = e.dataTransfer.getData('application/x-splat-effector-item-id');
      if (effectorItemId) {
        const mediaStore = useMediaStore.getState();
        const effectorItem = mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId);
        if (effectorItem && isVideoTrack) {
          addSplatEffectorClip(trackId, resolveDropStartTime(effectorItem.duration), effectorItem.duration, true);
          return;
        }
      }

      const mediaFileId = e.dataTransfer.getData('application/x-media-file-id');
      if (mediaFileId) {
        const mediaStore = useMediaStore.getState();
        const mediaFile = mediaStore.files.find((f) => f.id === mediaFileId);
        if (mediaFile) {
          const fileIsAudio = isAudioOnlyMediaFile(mediaFile, mediaFile.file);
          // Audio-only files can only go on audio tracks
          if (fileIsAudio && isVideoTrack) {
            log.debug('Audio files can only be dropped on audio tracks');
            return;
          }
          // Video+audio files are allowed on both track types

          const file = await resolveMediaFileForTimeline(mediaFile);
          if (!file) {
            log.warn('Could not add media panel item to timeline because the file is not resolved', {
              mediaFileId,
              name: mediaFile.name,
            });
            return;
          }

          addClip(trackId, file, resolveDropStartTime(mediaFile.duration), mediaFile.duration, mediaFileId, getTimelineMediaTypeOverride(mediaFile));
          return;
        }
      }

      // Handle external file drop
      const items = e.dataTransfer.items;
      const filePath = extractFilePath(e);

      log.debug('External drop', { items: items?.length, types: Array.from(e.dataTransfer.types) });
      log.debug('Final file path:', filePath || 'NOT AVAILABLE');

      if (items && items.length > 0) {
        const item = items[0];
        log.debug('Item details:', { kind: item.kind, type: item.type });
        if (item.kind === 'file') {
          const mediaStore = useMediaStore.getState();

          // Try to get file handle (File System Access API)
          if ('getAsFileSystemHandle' in item) {
            try {
              const handle = await (item as FileSystemDataTransferItem).getAsFileSystemHandle();
              if (handle && handle.kind === 'file') {
                const file = await handle.getFile();
                // Attach file path if we got it from URI list
                setDroppedFilePath(file, filePath);
                log.debug('File from handle:', { name: file.name, type: file.type, size: file.size, path: filePath });
                if (isMediaFile(file)) {
                  const typeOverride = await classifyMediaType(file);
                  if (typeOverride === 'unknown') {
                    return;
                  }
                  // Audio-only files can only go on audio tracks
                  const fileIsAudio = isAudioFile(file);
                  if (fileIsAudio && isVideoTrack) {
                    log.debug('Audio files can only be dropped on audio tracks');
                    return;
                  }

                  // Add clip immediately for instant visual feedback
                  addClip(trackId, file, resolveDropStartTime(cachedDuration), cachedDuration, undefined, typeOverride);
                  // Fire-and-forget media import (loadVideoMedia will pick it up)
                  mediaStore.importFilesWithHandles([{ file, handle, absolutePath: filePath }]);
                  log.debug('Imported file with handle:', { name: file.name, absolutePath: filePath });
                  return;
                }
              }
            } catch (err) {
              log.warn('Could not get file handle, falling back:', err);
            }
          }

          // Fallback to regular file (no handle)
          const file = item.getAsFile();
          if (file) setDroppedFilePath(file, filePath);
          log.debug('Fallback file:', { name: file?.name, type: file?.type, path: filePath });
          if (file && isMediaFile(file)) {
            const typeOverride = await classifyMediaType(file);
            if (typeOverride === 'unknown') {
              return;
            }
            // Audio-only files can only go on audio tracks
            const fileIsAudio = isAudioFile(file);
            if (fileIsAudio && isVideoTrack) {
              log.debug('Audio files can only be dropped on audio tracks');
              return;
            }

            // Add clip immediately for instant visual feedback
            addClip(trackId, file, resolveDropStartTime(cachedDuration), cachedDuration, undefined, typeOverride);
            // Fire-and-forget media import (loadVideoMedia will pick it up)
            mediaStore.importFile(file);
          }
        }
      }
    },
    [addCompClip, addClip, addTextClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, externalDrag, tracks, getDesiredStartTime, resolveTrackStartTime]
  );

  useEffect(() => {
    const handleBridgeDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExternalDragBridgeEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'cancel') {
        dragCounterRef.current = 0;
        setExternalDrag(null);
        return;
      }

      const payload = getExternalDragPayload();
      if (!payload) {
        dragCounterRef.current = 0;
        setExternalDrag(null);
        return;
      }

      const target = resolveCustomExternalDragTarget(detail.clientX, detail.clientY);
      if (!target) {
        if (detail.phase === 'drop') {
          dragCounterRef.current = 0;
          setExternalDrag(null);
        } else {
          setExternalDrag((prev) => prev ? {
            ...prev,
            x: detail.clientX,
            y: detail.clientY,
            trackId: '',
            audioTrackId: undefined,
            videoTrackId: undefined,
            newTrackType: null,
          } : null);
        }
        return;
      }

      const dragEvent = createPayloadDragEvent(detail, payload);
      dragCounterRef.current = Math.max(1, dragCounterRef.current);

      if (target.kind === 'track') {
        if (detail.phase === 'drop') {
          void handleTrackDrop(dragEvent, target.trackId);
        } else {
          handleTrackDragOver(dragEvent, target.trackId);
        }
        return;
      }

      if (detail.phase === 'drop') {
        void handleNewTrackDrop(dragEvent, target.trackType);
      } else {
        handleNewTrackDragOver(dragEvent, target.trackType);
      }
    };

    window.addEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleBridgeDrag);
    return () => window.removeEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleBridgeDrag);
  }, [
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleTrackDragOver,
    handleTrackDrop,
  ]);

  // Container-level drag leave: fully clear externalDrag when cursor leaves the timeline area
  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    const container = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    // Only clear when cursor truly leaves the container (not entering a child)
    if (!related || !container.contains(related)) {
      dragCounterRef.current = 0;
      setExternalDrag(null);
    }
  }, []);

  return {
    externalDrag,
    setExternalDrag,
    dragCounterRef,
    handleTrackDragEnter,
    handleTrackDragOver,
    handleTrackDragLeave,
    handleTrackDrop,
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleContainerDragLeave,
  };
}
