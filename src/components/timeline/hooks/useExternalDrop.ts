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
  getNextVideoNewTrackGestureState,
  initialVideoNewTrackGestureState,
  type VideoNewTrackGestureState,
} from '../utils/externalDragNewTrackGesture';
import {
  EXTERNAL_DRAG_BRIDGE_EVENT,
  getExternalDragPayload,
  getExternalDragPayloadMimeData,
  getExternalDragPayloadMimeTypes,
  type ExternalDragBridgeEventDetail,
  type ExternalDragPayload,
} from '../utils/externalDragSession';
import type { ExternalDragState } from '../types';
import type { TimelineTrack, TimelineClip, TextClipProperties } from '../../../types';
import type { Composition, MediaFile, SignalAssetItem } from '../../../stores/mediaStore';
import type { FileImportResult } from '../../../stores/mediaStore/types';
import { isMediaFileImportResult } from '../../../stores/mediaStore/helpers/importResult';
import { collectDroppedMediaFiles } from '../../panels/media/dropImport';
import type { ShapePrimitive } from '../../../types/motionDesign';
import { NativeHelperClient } from '../../../services/nativeHelper/NativeHelperClient';
import { Logger } from '../../../services/logger';
import {
  createSignalTimelineAdapterPlan,
  placeSignalAssetOnTimeline,
} from '../../../runtime/renderers/signalTimelineRendererAdapter';
import type { AddClipOptions, TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditResult, TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';

const log = Logger.create('useExternalDrop');
const TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS = 750;

type FileWithPath = File & { path?: string };

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

function findMatchingMediaFile(file: File, excludedIds?: Set<string>): MediaFile | null {
  const mediaFiles = useMediaStore.getState().files;
  return mediaFiles.find((mediaFile) =>
    mediaFile.name === file.name &&
    mediaFile.fileSize === file.size &&
    !excludedIds?.has(mediaFile.id)
  ) ?? null;
}

async function waitForTimelineDropImportPlaceholder(
  file: File,
  excludedIds: Set<string>,
  timeoutMs = TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS,
): Promise<MediaFile | null> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    const placeholder = findMatchingMediaFile(file, excludedIds);
    if (placeholder) {
      return placeholder;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  return null;
}

function firstMediaImportResult(result: FileImportResult | FileImportResult[]): MediaFile | null {
  const results = Array.isArray(result) ? result : [result];
  return results.find(isMediaFileImportResult) ?? null;
}

async function resolveTimelineDropMediaFile(params: {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}): Promise<MediaFile | null> {
  const { file, handle, absolutePath } = params;
  const existing = findMatchingMediaFile(file);
  if (existing) {
    return existing;
  }

  const mediaStore = useMediaStore.getState();
  const excludedIds = new Set(mediaStore.files.map((mediaFile) => mediaFile.id));
  const importPromise: Promise<FileImportResult | FileImportResult[]> = handle
    ? mediaStore.importFilesWithHandles([{ file, handle, absolutePath }])
    : mediaStore.importFile(file);
  void importPromise.catch(() => undefined);

  const placeholder = await waitForTimelineDropImportPlaceholder(file, excludedIds);
  if (placeholder) {
    void importPromise.catch((error) => {
      log.warn('Timeline drop media import failed after placeholder creation', {
        name: file.name,
        error,
      });
    });
    return placeholder;
  }

  try {
    return firstMediaImportResult(await importPromise);
  } catch (error) {
    log.warn('Timeline drop media import failed', { name: file.name, error });
    return null;
  }
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
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;
  pixelToTime: (pixel: number) => number;
  prepareTimelinePlacementRange: (
    mode: TimelinePlacementMode,
    options: {
      trackIds?: string[];
      startTime?: number;
      duration?: number;
      includeLinked?: boolean;
      source?: 'external-drop';
      historyLabel?: string;
    },
  ) => TimelineEditResult;
  addTrack: (type: 'video' | 'audio') => string | undefined;
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addCompClip: (trackId: string, comp: Composition, startTime: number) => void | Promise<void>;
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => Promise<string | null>;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  addMeshClip: (trackId: string, startTime: number, meshType: import('../../../stores/mediaStore/types').MeshPrimitiveType, duration?: number, skipMediaItem?: boolean) => string | null;
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMathSceneClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMotionShapeClip: (trackId: string, startTime: number, options?: { primitive?: ShapePrimitive; duration?: number; name?: string }) => string | null;
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

function createPayloadDragEvent(
  detail: ExternalDragBridgeEventDetail,
  payload: ExternalDragPayload,
): React.DragEvent {
  const types = getExternalDragPayloadMimeTypes(payload);
  const dataTransfer = {
    types,
    dropEffect: 'copy',
    effectAllowed: 'copyMove',
    files: { length: 0, item: () => null },
    items: { length: 0, item: () => null },
    getData: (mimeType: string) => getExternalDragPayloadMimeData(payload, mimeType),
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
  isExporting,
  activeTimelineToolId,
  pixelToTime,
  prepareTimelinePlacementRange,
  addTrack,
  addClip,
  addCompClip,
  addTextClip,
  updateTextProperties,
  updateClip,
  addSolidClip,
  addMeshClip,
  addCameraClip,
  addSplatEffectorClip,
  addMathSceneClip,
  addMotionShapeClip,
}: UseExternalDropProps): UseExternalDropReturn {
  const [externalDrag, setExternalDrag] = useState<ExternalDragState | null>(null);
  const dragCounterRef = useRef(0);
  const dragMetadataCacheRef = useRef<{ url: string; duration: number; hasAudio: boolean } | null>(null);
  const dragMetadataPendingRef = useRef<string | null>(null);
  const videoNewTrackGestureRef = useRef<VideoNewTrackGestureState>({ ...initialVideoNewTrackGestureState });

  const resetVideoNewTrackGesture = useCallback(() => {
    videoNewTrackGestureRef.current = { ...initialVideoNewTrackGestureState };
  }, []);

  const clearExternalDragState = useCallback(() => {
    resetVideoNewTrackGesture();
    setExternalDrag(null);
  }, [resetVideoNewTrackGesture]);

  const rejectDropDuringExport = useCallback((e: React.DragEvent) => {
    if (!isExporting) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'none';
    dragCounterRef.current = 0;
    clearExternalDragState();
    return true;
  }, [clearExternalDragState, isExporting]);

  const addDroppedTimelineMediaClip = useCallback(async (params: {
    trackId: string;
    file: File;
    startTime: number;
    duration?: number;
    filePath?: string;
    handle?: FileSystemFileHandle;
    typeOverride?: string;
  }): Promise<{ startTime: number; endTime: number } | null> => {
    const {
      trackId,
      file,
      startTime,
      duration,
      filePath,
      handle,
      typeOverride,
    } = params;

    const mediaFile = await resolveTimelineDropMediaFile({
      file,
      handle,
      absolutePath: filePath,
    });

    if (!mediaFile) {
      log.warn('Could not import timeline drop media before creating clip', {
        name: file.name,
        filePath,
      });
      return null;
    }

    const timelineFile = mediaFile.file ?? file;
    setDroppedFilePath(timelineFile, mediaFile.absolutePath ?? filePath);
    const resolvedDuration = mediaFile.duration ?? duration;
    addClip(
      trackId,
      timelineFile,
      startTime,
      resolvedDuration,
      mediaFile.id,
      getTimelineMediaTypeOverride(mediaFile) ?? typeOverride,
    );
    return { startTime, endTime: startTime + (resolvedDuration ?? 5) };
  }, [addClip]);

  // Place one or more externally dropped files onto a track sequentially, going
  // through the same media-store import path the media panel uses (#194).
  // `resolveStartTime` lets the caller snap/avoid overlaps; without it the raw
  // cursor is used (e.g. when dropping onto a freshly created empty track).
  const placeDroppedTimelineMediaFiles = useCallback(async (params: {
    dataTransfer: DataTransfer;
    trackId: string;
    trackIsVideo: boolean;
    baseStartTime: number;
    fallbackDuration?: number;
    filePath?: string;
    resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  }): Promise<boolean> => {
    const { dataTransfer, trackId, trackIsVideo, baseStartTime, fallbackDuration, filePath, resolveStartTime } = params;

    const records = await collectDroppedMediaFiles(dataTransfer);
    if (records.length === 0) return false;

    let cursorTime = baseStartTime;
    let placedAny = false;

    for (const record of records) {
      const { file, handle, absolutePath } = record;
      if (!isMediaFile(file)) continue;

      setDroppedFilePath(file, absolutePath ?? filePath);

      const typeOverride = await classifyMediaType(file);
      if (typeOverride === 'unknown') continue;

      // Audio-only files belong on audio tracks, everything else on video tracks.
      const fileIsAudio = isAudioFile(file);
      if (fileIsAudio && trackIsVideo) {
        log.debug('Skipping audio file dropped on a video track', { name: file.name });
        continue;
      }
      if (!fileIsAudio && !trackIsVideo) {
        log.debug('Skipping non-audio file dropped on an audio track', { name: file.name });
        continue;
      }

      const startTime = resolveStartTime
        ? resolveStartTime(cursorTime, fallbackDuration)
        : cursorTime;

      const placement = await addDroppedTimelineMediaClip({
        trackId,
        file,
        startTime,
        duration: fallbackDuration,
        filePath: absolutePath ?? filePath,
        handle,
        typeOverride,
      });

      if (placement) {
        placedAny = true;
        cursorTime = placement.endTime;
      }
    }

    return placedAny;
  }, [addDroppedTimelineMediaClip]);

  const updateVideoNewTrackGesture = useCallback((clientY: number, isAudio: boolean) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) {
      videoNewTrackGestureRef.current = { lastClientY: clientY, isOffered: false };
      return false;
    }

    const next = getNextVideoNewTrackGestureState(videoNewTrackGestureRef.current, {
      clientY,
      timelineTop: rect.top,
      isAudio,
    });
    videoNewTrackGestureRef.current = next;
    return next.isOffered;
  }, [timelineRef]);

  const applyVideoNewTrackOffer = useCallback((state: ExternalDragState): ExternalDragState => ({
    ...state,
    showVideoNewTrackZone: updateVideoNewTrackGesture(state.y, !!state.isAudio),
  }), [updateVideoNewTrackGesture]);

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
    if (activeTimelineToolId === 'position-overwrite') {
      return Math.max(0, desiredStartTime);
    }

    const previewDuration = duration ?? dragMetadataCacheRef.current?.duration ?? 5;
    return findClosestNonOverlappingStartTime(trackId, desiredStartTime, previewDuration, clips);
  }, [activeTimelineToolId, clips]);

  const getDropPlacementTrackIds = useCallback((primaryTrackId: string): string[] => {
    const ids = new Set<string>([primaryTrackId]);
    const preview = externalDrag;
    if (preview?.audioTrackId && !preview.audioTrackId.startsWith('__')) ids.add(preview.audioTrackId);
    if (preview?.videoTrackId && !preview.videoTrackId.startsWith('__')) ids.add(preview.videoTrackId);
    return [...ids];
  }, [externalDrag]);

  const prepareDropPlacement = useCallback((
    primaryTrackId: string,
    startTime: number,
    duration?: number,
  ) => {
    if (activeTimelineToolId !== 'position-overwrite') return;

    prepareTimelinePlacementRange('position-overwrite', {
      trackIds: getDropPlacementTrackIds(primaryTrackId),
      startTime,
      duration: duration ?? externalDrag?.duration ?? dragMetadataCacheRef.current?.duration ?? 5,
      includeLinked: true,
      source: 'external-drop',
      historyLabel: 'Position overwrite drop',
    });
  }, [
    activeTimelineToolId,
    externalDrag?.duration,
    getDropPlacementTrackIds,
    prepareTimelinePlacementRange,
  ]);

  const addSignalAssetClip = useCallback(async (
    trackId: string,
    signalAsset: SignalAssetItem,
    startTime: number,
  ) => {
    const result = await placeSignalAssetOnTimeline(signalAsset, trackId, startTime, {
      addClip,
      addTextClip,
      updateTextProperties,
      updateClip,
    });
    return result.clipId;
  }, [addClip, addTextClip, updateClip, updateTextProperties]);

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
    const dragPayload = getExternalDragPayload();
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
      label: dragPayload?.label,
      mediaType: dragPayload?.mediaType,
      thumbnailUrl: dragPayload?.thumbnailUrl,
      showVideoNewTrackZone: updateVideoNewTrackGesture(y, isAudio),
    };
  }, [tracks, clips, resolveTrackStartTime, updateVideoNewTrackGesture]);

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

    if (e.dataTransfer.types.includes('application/x-math-scene-item-id')) {
      if (dragPayload?.kind === 'math-scene') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const mathSceneItemId = e.dataTransfer.getData('application/x-math-scene-item-id');
      const mathSceneItem = mediaStore.mathSceneItems.find((item) => item.id === mathSceneItemId);
      return {
        duration: mathSceneItem?.duration ?? 5,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-motion-shape-item-id')) {
      if (dragPayload?.kind === 'motion-shape') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const motionShapeItemId = e.dataTransfer.getData('application/x-motion-shape-item-id');
      const motionShapeItem = mediaStore.motionShapeItems.find((item) => item.id === motionShapeItemId);
      return {
        duration: motionShapeItem?.duration ?? 5,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (e.dataTransfer.types.includes('application/x-signal-asset-id')) {
      if (dragPayload?.kind === 'signal') {
        return {
          duration: dragPayload.duration ?? 5,
          hasAudio: false,
          isAudio: false,
          isVideo: true,
        };
      }

      const signalAssetId = e.dataTransfer.getData('application/x-signal-asset-id');
      const signalAsset = mediaStore.signalAssets.find((item) => item.id === signalAssetId);
      return {
        duration: signalAsset ? createSignalTimelineAdapterPlan(signalAsset).duration : 5,
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
      if (rejectDropDuringExport(e)) return;
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration: compDuration,
            hasAudio: true,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio,
            isVideo: false,
            isAudio: true,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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

      if (e.dataTransfer.types.includes('application/x-math-scene-item-id')) {
        const mathSceneItemId = dragPayload?.kind === 'math-scene'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-math-scene-item-id');
        const mathSceneItem = mathSceneItemId
          ? mediaStore.mathSceneItems.find((item) => item.id === mathSceneItemId)
          : null;
        const duration = dragPayload?.kind === 'math-scene'
          ? dragPayload.duration ?? 5
          : mathSceneItem?.duration ?? 5;

        if (isAudioTrack) {
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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

      if (e.dataTransfer.types.includes('application/x-motion-shape-item-id')) {
        const motionShapeItemId = dragPayload?.kind === 'motion-shape'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-motion-shape-item-id');
        const motionShapeItem = motionShapeItemId
          ? mediaStore.motionShapeItems.find((item) => item.id === motionShapeItemId)
          : null;
        const duration = dragPayload?.kind === 'motion-shape'
          ? dragPayload.duration ?? 5
          : motionShapeItem?.duration ?? 5;

        if (isAudioTrack) {
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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

      if (e.dataTransfer.types.includes('application/x-signal-asset-id')) {
        const signalAssetId = dragPayload?.kind === 'signal'
          ? dragPayload.id
          : e.dataTransfer.getData('application/x-signal-asset-id');
        const signalAsset = signalAssetId
          ? mediaStore.signalAssets.find((item) => item.id === signalAssetId)
          : null;
        const duration = dragPayload?.kind === 'signal'
          ? dragPayload.duration ?? 5
          : signalAsset
            ? createSignalTimelineAdapterPlan(signalAsset).duration
            : 5;

        if (isAudioTrack) {
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration,
            hasAudio: false,
            isVideo: true,
            isAudio: false,
          }));
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
          setExternalDrag(applyVideoNewTrackOffer({
            trackId: '',
            startTime,
            x: e.clientX,
            y: e.clientY,
            duration: dur,
            hasAudio: true,
            isAudio: true,
            isVideo: false,
          }));
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
    [tracks, rejectDropDuringExport, getDesiredStartTime, buildTrackPreviewState, requestVideoDragMetadata, updateResolvedDragMetadata, applyVideoNewTrackOffer]
  );

  // Handle external file drag over track
  const handleTrackDragOver = useCallback(
    (e: React.DragEvent, trackId: string) => {
      if (rejectDropDuringExport(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      const isCompDrag = e.dataTransfer.types.includes('application/x-composition-id');
      const isMediaPanelDrag = e.dataTransfer.types.includes('application/x-media-file-id');
      const isTextDrag = e.dataTransfer.types.includes('application/x-text-item-id');
      const isSolidDrag = e.dataTransfer.types.includes('application/x-solid-item-id');
      const isMeshDrag = e.dataTransfer.types.includes('application/x-mesh-item-id');
      const isCameraDrag = e.dataTransfer.types.includes('application/x-camera-item-id');
      const isSplatEffectorDrag = e.dataTransfer.types.includes('application/x-splat-effector-item-id');
      const isMathSceneDrag = e.dataTransfer.types.includes('application/x-math-scene-item-id');
      const isMotionShapeDrag = e.dataTransfer.types.includes('application/x-motion-shape-item-id');
      const isSignalDrag = e.dataTransfer.types.includes('application/x-signal-asset-id');
      const isFileDrag = e.dataTransfer.types.includes('Files');

      if (
        isCompDrag ||
        isMediaPanelDrag ||
        isTextDrag ||
        isSolidDrag ||
        isMeshDrag ||
        isCameraDrag ||
        isSplatEffectorDrag ||
        isMathSceneDrag ||
        isMotionShapeDrag ||
        isSignalDrag ||
        isFileDrag
      ) {
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
            showVideoNewTrackZone: updateVideoNewTrackGesture(e.clientY, isAudioDrag),
          } : null);
          return;
        }

        // Generated visual items and compositions can only go on video tracks
        if (
          (isTextDrag || isSolidDrag || isMeshDrag || isCameraDrag || isSplatEffectorDrag || isMathSceneDrag || isMotionShapeDrag || isSignalDrag || isCompDrag) &&
          isAudioTrack
        ) {
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
            showVideoNewTrackZone: updateVideoNewTrackGesture(e.clientY, false),
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
    [tracks, rejectDropDuringExport, getDesiredStartTime, buildTrackPreviewState, resolveImmediateDragPreview, updateVideoNewTrackGesture]
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
      if (rejectDropDuringExport(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const preview = resolveImmediateDragPreview(e);

      // Audio files can only create audio tracks
      if (preview.isAudio && trackType === 'video') {
        updateVideoNewTrackGesture(e.clientY, true);
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      if (!preview.isAudio && trackType === 'audio') {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      const showVideoNewTrackZone = trackType === 'video'
        ? updateVideoNewTrackGesture(e.clientY, preview.isAudio)
        : videoNewTrackGestureRef.current.isOffered;
      if (trackType === 'video' && !showVideoNewTrackZone) {
        e.dataTransfer.dropEffect = 'none';
        setExternalDrag((prev) => prev ? {
          ...prev,
          x: e.clientX,
          y: e.clientY,
          newTrackType: null,
          showVideoNewTrackZone: false,
        } : null);
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
          showVideoNewTrackZone,
        }));
      }
    },
    [timelineRef, rejectDropDuringExport, getDesiredStartTime, resolveImmediateDragPreview, updateVideoNewTrackGesture]
  );

  // Handle drop on "new track" zone - creates new track and adds clip
  const handleNewTrackDrop = useCallback(
    async (e: React.DragEvent, trackType: 'video' | 'audio') => {
      if (rejectDropDuringExport(e)) return;
      e.preventDefault();
      e.stopPropagation();

      if (trackType === 'video' && !updateVideoNewTrackGesture(e.clientY, false)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      const cachedDuration =
        externalDrag?.duration ?? dragMetadataCacheRef.current?.duration;

      dragCounterRef.current = 0;
      clearExternalDragState();

      // Validate file type matches track type BEFORE creating track
      const signalAssetId = e.dataTransfer.getData('application/x-signal-asset-id');
      if (signalAssetId && trackType === 'audio') {
        log.debug('Signal assets can only be dropped on video tracks');
        return;
      }

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

      const mathSceneItemId = e.dataTransfer.getData('application/x-math-scene-item-id');
      if (mathSceneItemId) {
        const mediaStore = useMediaStore.getState();
        const mathSceneItem = mediaStore.mathSceneItems.find((item) => item.id === mathSceneItemId);
        if (mathSceneItem) {
          addMathSceneClip(newTrackId, startTime, mathSceneItem.duration, true);
          return;
        }
      }

      const motionShapeItemId = e.dataTransfer.getData('application/x-motion-shape-item-id');
      if (motionShapeItemId) {
        const mediaStore = useMediaStore.getState();
        const motionShapeItem = mediaStore.motionShapeItems.find((item) => item.id === motionShapeItemId);
        if (motionShapeItem) {
          addMotionShapeClip(newTrackId, startTime, {
            primitive: motionShapeItem.primitive,
            duration: motionShapeItem.duration,
            name: motionShapeItem.name,
          });
          return;
        }
      }

      if (signalAssetId) {
        const mediaStore = useMediaStore.getState();
        const signalAsset = mediaStore.signalAssets.find((item) => item.id === signalAssetId);
        if (signalAsset) {
          await addSignalAssetClip(newTrackId, signalAsset, startTime);
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

      // Handle external file drop (supports multiple files via the shared media import path)
      await placeDroppedTimelineMediaFiles({
        dataTransfer: e.dataTransfer,
        trackId: newTrackId,
        trackIsVideo: trackType === 'video',
        baseStartTime: startTime,
        fallbackDuration: cachedDuration,
        filePath,
      });
    },
    [scrollX, pixelToTime, addTrack, addCompClip, addClip, addTextClip, addSignalAssetClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, addMathSceneClip, addMotionShapeClip, placeDroppedTimelineMediaFiles, externalDrag, timelineRef, clearExternalDragState, updateVideoNewTrackGesture, rejectDropDuringExport]
  );

  // Handle external file drop on track
  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, trackId: string) => {
      if (rejectDropDuringExport(e)) return;
      e.preventDefault();

      const desiredStartTime = getDesiredStartTime(e.clientX);
      const resolveDropStartTime = (duration?: number) =>
        resolveTrackStartTime(trackId, desiredStartTime, duration ?? externalDrag?.duration);
      const prepareDropStartTime = (duration?: number) => {
        const startTime = resolveDropStartTime(duration);
        prepareDropPlacement(trackId, startTime, duration);
        return startTime;
      };

      const cachedDuration =
        externalDrag?.duration ?? dragMetadataCacheRef.current?.duration;

      dragCounterRef.current = 0;
      clearExternalDragState();

      // Get track type for validation
      const targetTrack = tracks.find((t) => t.id === trackId);
      const isVideoTrack = targetTrack?.type === 'video';

      const compositionId = e.dataTransfer.getData('application/x-composition-id');
      if (compositionId) {
        const mediaStore = useMediaStore.getState();
        const comp = mediaStore.compositions.find((c) => c.id === compositionId);
        if (comp) {
          const compDuration = comp.timelineData?.duration ?? comp.duration ?? 5;
          addCompClip(trackId, comp, prepareDropStartTime(compDuration));
          return;
        }
      }

      // Handle text item drag from media panel (skipMediaItem=true since it already exists)
      const textItemId = e.dataTransfer.getData('application/x-text-item-id');
      if (textItemId) {
        const mediaStore = useMediaStore.getState();
        const textItem = mediaStore.textItems.find((t) => t.id === textItemId);
        if (textItem && isVideoTrack) {
          addTextClip(trackId, prepareDropStartTime(textItem.duration), textItem.duration, true);
          return;
        }
      }

      // Handle solid item drag from media panel (skipMediaItem=true since it already exists)
      const solidItemId = e.dataTransfer.getData('application/x-solid-item-id');
      if (solidItemId) {
        const mediaStore = useMediaStore.getState();
        const solidItem = mediaStore.solidItems.find((s) => s.id === solidItemId);
        if (solidItem && isVideoTrack) {
          addSolidClip(trackId, prepareDropStartTime(solidItem.duration), solidItem.color, solidItem.duration, true);
          return;
        }
      }

      // Handle mesh item drag from media panel (skipMediaItem=true since it already exists)
      const meshItemId = e.dataTransfer.getData('application/x-mesh-item-id');
      if (meshItemId) {
        const mediaStore = useMediaStore.getState();
        const meshItem = mediaStore.meshItems.find((m) => m.id === meshItemId);
        if (meshItem && isVideoTrack) {
          addMeshClip(trackId, prepareDropStartTime(meshItem.duration), meshItem.meshType, meshItem.duration, true);
          return;
        }
      }

      // Handle camera item drag from media panel (skipMediaItem=true since it already exists)
      const cameraItemId = e.dataTransfer.getData('application/x-camera-item-id');
      if (cameraItemId) {
        const mediaStore = useMediaStore.getState();
        const cameraItem = mediaStore.cameraItems.find((c) => c.id === cameraItemId);
        if (cameraItem && isVideoTrack) {
          addCameraClip(trackId, prepareDropStartTime(cameraItem.duration), cameraItem.duration, true);
          return;
        }
      }

      const effectorItemId = e.dataTransfer.getData('application/x-splat-effector-item-id');
      if (effectorItemId) {
        const mediaStore = useMediaStore.getState();
        const effectorItem = mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId);
        if (effectorItem && isVideoTrack) {
          addSplatEffectorClip(trackId, prepareDropStartTime(effectorItem.duration), effectorItem.duration, true);
          return;
        }
      }

      const mathSceneItemId = e.dataTransfer.getData('application/x-math-scene-item-id');
      if (mathSceneItemId) {
        const mediaStore = useMediaStore.getState();
        const mathSceneItem = mediaStore.mathSceneItems.find((item) => item.id === mathSceneItemId);
        if (mathSceneItem && isVideoTrack) {
          addMathSceneClip(trackId, prepareDropStartTime(mathSceneItem.duration), mathSceneItem.duration, true);
          return;
        }
      }

      const motionShapeItemId = e.dataTransfer.getData('application/x-motion-shape-item-id');
      if (motionShapeItemId) {
        const mediaStore = useMediaStore.getState();
        const motionShapeItem = mediaStore.motionShapeItems.find((item) => item.id === motionShapeItemId);
        if (motionShapeItem && isVideoTrack) {
          addMotionShapeClip(trackId, prepareDropStartTime(motionShapeItem.duration), {
            primitive: motionShapeItem.primitive,
            duration: motionShapeItem.duration,
            name: motionShapeItem.name,
          });
          return;
        }
      }

      const signalAssetId = e.dataTransfer.getData('application/x-signal-asset-id');
      if (signalAssetId) {
        const mediaStore = useMediaStore.getState();
        const signalAsset = mediaStore.signalAssets.find((item) => item.id === signalAssetId);
        if (signalAsset && isVideoTrack) {
          const plan = createSignalTimelineAdapterPlan(signalAsset);
          await addSignalAssetClip(trackId, signalAsset, prepareDropStartTime(plan.duration));
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

          addClip(trackId, file, prepareDropStartTime(mediaFile.duration), mediaFile.duration, mediaFileId, getTimelineMediaTypeOverride(mediaFile));
          return;
        }
      }

      // Handle external file drop (supports multiple files via the shared media import path)
      const filePath = extractFilePath(e);
      log.debug('External drop', { items: e.dataTransfer.items?.length, types: Array.from(e.dataTransfer.types) });
      log.debug('Final file path:', filePath || 'NOT AVAILABLE');

      await placeDroppedTimelineMediaFiles({
        dataTransfer: e.dataTransfer,
        trackId,
        trackIsVideo: isVideoTrack,
        baseStartTime: desiredStartTime,
        fallbackDuration: cachedDuration,
        filePath,
        // Snap/avoid overlaps the same way single drops do, and prep position-overwrite ranges.
        resolveStartTime: (desired, duration) => {
          const startTime = resolveTrackStartTime(trackId, desired, duration ?? cachedDuration);
          prepareDropPlacement(trackId, startTime, duration ?? cachedDuration);
          return startTime;
        },
      });
    },
    [addCompClip, addClip, addTextClip, addSignalAssetClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, addMathSceneClip, addMotionShapeClip, placeDroppedTimelineMediaFiles, externalDrag, tracks, rejectDropDuringExport, getDesiredStartTime, resolveTrackStartTime, prepareDropPlacement, clearExternalDragState]
  );

  useEffect(() => {
    const handleBridgeDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExternalDragBridgeEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'cancel') {
        dragCounterRef.current = 0;
        clearExternalDragState();
        return;
      }

      const payload = getExternalDragPayload();
      if (!payload) {
        dragCounterRef.current = 0;
        clearExternalDragState();
        return;
      }

      const target = detail.targetTrackId
        ? { kind: 'track' as const, trackId: detail.targetTrackId }
        : detail.targetNewTrackType
          ? { kind: 'new-track' as const, trackType: detail.targetNewTrackType }
          : resolveCustomExternalDragTarget(detail.clientX, detail.clientY);
      if (!target) {
        if (detail.phase === 'drop') {
          dragCounterRef.current = 0;
          clearExternalDragState();
        } else {
          setExternalDrag((prev) => prev ? {
            ...prev,
            x: detail.clientX,
            y: detail.clientY,
            trackId: '',
            audioTrackId: undefined,
            videoTrackId: undefined,
            newTrackType: null,
            showVideoNewTrackZone: updateVideoNewTrackGesture(detail.clientY, payload.isAudio),
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
    clearExternalDragState,
    updateVideoNewTrackGesture,
  ]);

  // Container-level drag leave: fully clear externalDrag when cursor leaves the timeline area
  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    const container = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    // Only clear when cursor truly leaves the container (not entering a child)
    if (!related || !container.contains(related)) {
      dragCounterRef.current = 0;
      clearExternalDragState();
    }
  }, [clearExternalDragState]);

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
