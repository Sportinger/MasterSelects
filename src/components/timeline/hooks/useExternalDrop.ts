// External file drag & drop handling for timeline

import { useState, useCallback, useRef } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  isAudioFile,
  getVideoMetadataQuick,
} from '../utils/fileTypeHelpers';
import {
  findClosestNonOverlappingStartTime,
  findFirstTrackWithoutOverlap,
} from '../utils/externalDragPlacement';
import {
  getNextVideoNewTrackGestureState,
  initialVideoNewTrackGestureState,
  type VideoNewTrackGestureState,
} from '../utils/externalDragNewTrackGesture';
import { getExternalDragPayload } from '../utils/externalDragSession';
import type { ExternalDragState } from '../types';
import { useExternalDragBridgeRouting } from './useExternalDragBridgeRouting';
import { useExternalDropSessionGuards } from './useExternalDropSessionGuards';
import { resolveExternalDropImmediatePreview } from './externalDropImmediatePreview';
import { useExternalDropTrackDragEnter } from './useExternalDropTrackDragEnter';
import { useExternalDropTrackDragOver } from './useExternalDropTrackDragOver';
import { useExternalDropNewTrackDragOver } from './useExternalDropNewTrackDragOver';
import { useExternalDropTrackDragLeave } from './useExternalDropTrackDragLeave';
import type { TimelineTrack, TimelineClip, TextClipProperties } from '../../../types';
import type { Composition, MediaFile, SignalAssetItem } from '../../../stores/mediaStore';
import { collectDroppedMediaFiles } from '../../panels/media/dropImport';
import type { ShapePrimitive } from '../../../types/motionDesign';
import { Logger } from '../../../services/logger';
import { placeSignalAssetOnTimeline } from '../../../runtime/renderers/signalTimelineRendererAdapter';
import type { AddClipOptions, TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditResult, TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import {
  canRouteTimelineExternalDropCommandToTrack,
  planTimelineExternalDropCommand,
} from '../../../timeline';
import { executeTimelineExternalDropCommand } from '../../../services/timeline/timelineExternalDropCommandExecutor';
import { placeTimelineExternalDropFiles } from '../../../services/timeline/timelineExternalDropFilePlacement';

const log = Logger.create('useExternalDrop');

function isAudioOnlyMediaFile(mediaFile: MediaFile, file?: File): boolean {
  return mediaFile.type === 'audio' || Boolean(file && isAudioFile(file));
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

function planExternalDropCommand(dataTransfer: DataTransfer) {
  return planTimelineExternalDropCommand({
    types: Array.from(dataTransfer.types),
    fileCount: dataTransfer.files.length,
    getData: (mimeType) => dataTransfer.getData(mimeType),
  });
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

  const clearExternalDragSession = useExternalDropSessionGuards({ active: Boolean(externalDrag), dragCounterRef, clearExternalDragState });

  const rejectDropDuringExport = useCallback((e: React.DragEvent) => {
    if (!isExporting) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'none';
    clearExternalDragSession();
    return true;
  }, [clearExternalDragSession, isExporting]);

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
    return placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records,
      trackId,
      trackIsVideo,
      baseStartTime,
      fallbackDuration,
      filePath,
      resolveStartTime,
    });
  }, [addClip, addSignalAssetClip]);

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
    return resolveExternalDropImmediatePreview({
      dataTransfer: e.dataTransfer,
      currentPreview: externalDrag,
      metadataCache: dragMetadataCacheRef.current,
      requestVideoMetadata: requestVideoDragMetadata,
    });
  }, [externalDrag, requestVideoDragMetadata]);

  const getPreviewMetadataFallback = useCallback(() => ({
    duration: dragMetadataCacheRef.current?.duration,
    hasAudio: dragMetadataCacheRef.current?.hasAudio,
  }), []);

  const hasTimelineElement = useCallback(() => Boolean(timelineRef.current), [timelineRef]);

  const getVideoNewTrackOffered = useCallback(() => videoNewTrackGestureRef.current.isOffered, []);

  const handleTrackDragEnter = useExternalDropTrackDragEnter({
    tracks,
    dragCounterRef,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    applyVideoNewTrackOffer,
    buildTrackPreviewState,
    setExternalDrag,
  });

  const handleTrackDragOver = useExternalDropTrackDragOver({
    tracks,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    updateVideoNewTrackGesture,
    buildTrackPreviewState,
    getPreviewMetadataFallback,
    setExternalDrag,
  });

  const handleTrackDragLeave = useExternalDropTrackDragLeave({
    dragCounterRef,
    setExternalDrag,
  });

  const handleNewTrackDragOver = useExternalDropNewTrackDragOver({
    hasTimelineElement,
    rejectDropDuringExport,
    getDesiredStartTime,
    resolveImmediateDragPreview,
    updateVideoNewTrackGesture,
    getVideoNewTrackOffered,
    getPreviewMetadataFallback,
    setExternalDrag,
  });

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
      const dropCommand = planExternalDropCommand(e.dataTransfer);

      clearExternalDragSession();

      if (!canRouteTimelineExternalDropCommandToTrack(dropCommand, trackType)) {
        log.debug('Drop command cannot be routed to the requested new track type', {
          commandKind: dropCommand.kind,
          trackType,
        });
        return;
      }

      // Validate file type matches track type BEFORE creating track
      const signalAssetId = dropCommand.kind === 'signal-asset' ? dropCommand.itemId : '';
      if (signalAssetId && trackType === 'audio') {
        log.debug('Signal assets can only be dropped on video tracks');
        return;
      }

      const mediaFileId = dropCommand.kind === 'media-file' ? dropCommand.itemId : '';
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

      const commandResult = await executeTimelineExternalDropCommand({
        actions: {
          addClip,
          addCompClip,
          addTextClip,
          addSolidClip,
          addMeshClip,
          addCameraClip,
          addSplatEffectorClip,
          addMathSceneClip,
          addMotionShapeClip,
          addSignalAssetClip,
        },
        command: dropCommand,
        isAudioOnlyMediaFile,
        isVideoTrack: trackType === 'video',
        mediaFilePolicy: 'strict-track-type',
        resolveStartTime: () => startTime,
        trackId: newTrackId,
      });
      if (commandResult.handled) {
        return;
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
    [scrollX, pixelToTime, addTrack, addCompClip, addClip, addTextClip, addSignalAssetClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, addMathSceneClip, addMotionShapeClip, placeDroppedTimelineMediaFiles, externalDrag, timelineRef, clearExternalDragSession, updateVideoNewTrackGesture, rejectDropDuringExport]
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

      clearExternalDragSession();

      // Get track type for validation
      const targetTrack = tracks.find((t) => t.id === trackId);
      const isVideoTrack = targetTrack?.type === 'video';
      const dropCommand = planExternalDropCommand(e.dataTransfer);
      if (targetTrack?.type === 'midi') {
        log.debug('External drops cannot be routed to MIDI tracks', {
          commandKind: dropCommand.kind,
          trackId,
        });
        return;
      }
      if (targetTrack && !canRouteTimelineExternalDropCommandToTrack(dropCommand, targetTrack.type)) {
        log.debug('Drop command cannot be routed to the target track', {
          commandKind: dropCommand.kind,
          trackId,
          trackType: targetTrack.type,
        });
        return;
      }

      const commandResult = await executeTimelineExternalDropCommand({
        actions: {
          addClip,
          addCompClip,
          addTextClip,
          addSolidClip,
          addMeshClip,
          addCameraClip,
          addSplatEffectorClip,
          addMathSceneClip,
          addMotionShapeClip,
          addSignalAssetClip,
        },
        command: dropCommand,
        isAudioOnlyMediaFile,
        isVideoTrack,
        mediaFilePolicy: 'allow-video-on-audio',
        resolveStartTime: prepareDropStartTime,
        trackId,
      });
      if (commandResult.handled) {
        return;
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
    [addCompClip, addClip, addTextClip, addSignalAssetClip, addSolidClip, addMeshClip, addCameraClip, addSplatEffectorClip, addMathSceneClip, addMotionShapeClip, placeDroppedTimelineMediaFiles, externalDrag, tracks, rejectDropDuringExport, getDesiredStartTime, resolveTrackStartTime, prepareDropPlacement, clearExternalDragSession]
  );

  useExternalDragBridgeRouting({
    dragCounterRef,
    clearExternalDragState,
    setExternalDrag,
    updateVideoNewTrackGesture,
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleTrackDragOver,
    handleTrackDrop,
  });

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
