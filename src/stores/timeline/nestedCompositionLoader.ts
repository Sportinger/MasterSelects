import type {
  Keyframe,
  SerializableClip,
  TimelineClip,
  TimelineTrack,
} from './types';
import type {
  VectorAnimationClipSettings,
  VectorAnimationProvider,
} from '../../types/vectorAnimation';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import type { Composition } from './types';
import type { MediaFile } from '../mediaStore/types';
import { DEFAULT_TRANSFORM, MAX_NESTING_DEPTH } from './constants';
import { generateNestedClipId } from './helpers/idGenerator';
import { createDataOnlyRestoredMediaSource } from './restoredMediaSource';
import {
  applyManagedRestoredSpatialSource,
  createDataOnlyRestoredImageSource,
  createRestoredMathSceneClip,
  createRestoredMotionClip,
  createRestoredNestedCompositionClip,
  createRestoredNestedMediaClip,
  createRestoredPrimitiveMeshClip,
  createRestoredTransitionOverlayClip,
  isRestoredSpatialSourceType,
  patchNestedClipInCompositionClip,
} from './nestedRestore';
import {
  startRestoredVectorRuntimeRestore,
  type RestoredRuntimePatch,
} from './vectorRuntimeRestore';
import { collectNestedClipKeyframes, mergeNestedClipKeyframes } from './nestedComposition/nestedCompositionKeyframes';
import { Logger } from '../../services/logger';

const log = Logger.create('NestedCompositionLoader');

export { collectNestedClipKeyframes, mergeNestedClipKeyframes } from './nestedComposition/nestedCompositionKeyframes';
export { buildAndApplyNestedClipSegments, buildClipSegments, calculateNestedClipBoundaries, scheduleNestedClipSegmentBuild } from './nestedComposition/nestedCompositionSegments';
export type { CollectNestedClipKeyframesParams, MergeNestedClipKeyframesParams } from './nestedComposition/nestedCompositionKeyframes';
export type { ApplyNestedClipSegmentBuildParams, ClipSegmentData, ScheduleNestedClipSegmentBuildParams } from './nestedComposition/nestedCompositionSegments';
export { generateCompThumbnails } from './nestedComposition/nestedCompositionThumbnails';
export type { GenerateCompThumbnailsParams } from './nestedComposition/nestedCompositionThumbnails';

export interface NestedCompositionStoreState {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  thumbnailsEnabled: boolean;
  clipKeyframes: Map<string, Keyframe[]>;
  invalidateCache?: () => void;
}

export type NestedCompositionStoreGet = () => NestedCompositionStoreState;
export type NestedCompositionStoreSet = (state: Partial<NestedCompositionStoreState>) => void;

export interface NestedRuntimeReadyEvent {
  rootCompClipId: string;
  parentClipId: string;
  nestedClipId: string;
  clip: TimelineClip;
  sourceType: 'image' | VectorAnimationProvider;
  depth: number;
  defaultInvalidatesCache: boolean;
}

export interface NestedMediaRestoreEvent {
  rootCompClipId: string;
  parentClipId: string;
  nestedClipId: string;
  serializedClip: SerializableClip;
  mediaFile: MediaFile;
  sourceType: SerializableClip['sourceType'];
  hasBrowserFile: boolean;
  depth: number;
}

export interface NestedCompositionRestoreHooks {
  runtimeReady?: {
    invalidateCache?: boolean;
    onReady?: (event: NestedRuntimeReadyEvent) => void;
  };
  mediaRelink?: {
    getNeedsReload?: (event: NestedMediaRestoreEvent) => boolean;
    createMissingRuntimeSource?: (event: NestedMediaRestoreEvent) => TimelineClip['source'] | undefined;
  };
}

export interface NestedCompositionMediaState {
  files: MediaFile[];
  compositions: Composition[];
}

export type NestedCompositionMediaGet = () => NestedCompositionMediaState;

async function getDefaultNestedCompositionMediaState(): Promise<NestedCompositionMediaGet> {
  const { useMediaStore } = await import('../mediaStore');
  return useMediaStore.getState;
}

export interface LoadNestedClipsParams {
  compClipId: string;
  composition: Composition;
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
  getMediaState?: NestedCompositionMediaGet;
  depth?: number;
  isCurrentTimelineSession?: () => boolean;
  applySpatialFieldsWhenSourceMissing?: boolean;
  restoreHooks?: NestedCompositionRestoreHooks;
}

function patchNestedClipInStore(
  get: NestedCompositionStoreGet,
  set: NestedCompositionStoreSet,
  compClipId: string,
  nestedClipId: string,
  patch: RestoredRuntimePatch,
): void {
  const result = patchNestedClipInCompositionClip(get().clips, compClipId, nestedClipId, patch);
  if (result.patched) {
    set({ clips: result.clips });
  }
}

function createNestedPlaceholderFile(name: string | undefined): File {
  return new File([], name || 'pending');
}

function createNestedMediaRestoreEvent(params: {
  rootCompClipId: string;
  parentClipId: string;
  nestedClipId: string;
  serializedClip: SerializableClip;
  mediaFile: MediaFile;
  depth: number;
}): NestedMediaRestoreEvent {
  return {
    rootCompClipId: params.rootCompClipId,
    parentClipId: params.parentClipId,
    nestedClipId: params.nestedClipId,
    serializedClip: params.serializedClip,
    mediaFile: params.mediaFile,
    sourceType: params.serializedClip.sourceType,
    hasBrowserFile: !!params.mediaFile.file,
    depth: params.depth,
  };
}

function getNestedNeedsReload(
  restoreHooks: NestedCompositionRestoreHooks | undefined,
  event: NestedMediaRestoreEvent,
): boolean | undefined {
  return restoreHooks?.mediaRelink?.getNeedsReload?.(event);
}

function applyMissingRuntimeSourceFromHooks(
  clip: TimelineClip,
  restoreHooks: NestedCompositionRestoreHooks | undefined,
  event: NestedMediaRestoreEvent,
): void {
  const source = restoreHooks?.mediaRelink?.createMissingRuntimeSource?.(event);
  if (source !== undefined) {
    clip.source = source;
  }
}

function notifyNestedRuntimeReady(params: {
  get: NestedCompositionStoreGet;
  restoreHooks?: NestedCompositionRestoreHooks;
  event: Omit<NestedRuntimeReadyEvent, 'defaultInvalidatesCache'>;
  defaultInvalidatesCache: boolean;
}): void {
  const { get, restoreHooks, event, defaultInvalidatesCache } = params;
  const shouldInvalidateCache = restoreHooks?.runtimeReady?.invalidateCache ?? defaultInvalidatesCache;
  if (shouldInvalidateCache) {
    get().invalidateCache?.();
  }

  restoreHooks?.runtimeReady?.onReady?.({
    ...event,
    defaultInvalidatesCache,
  });
}

async function loadSubNestedClips(
  composition: Composition,
  parentClipId: string,
  rootCompClipId: string,
  depth: number,
  getMediaState: NestedCompositionMediaGet,
  get: NestedCompositionStoreGet,
  paramsIsCurrentTimelineSession?: () => boolean,
  applyNestedRuntimePatch?: (nestedClipId: string, patch: RestoredRuntimePatch) => void,
  applySpatialFieldsWhenSourceMissing = true,
  restoreHooks?: NestedCompositionRestoreHooks,
): Promise<TimelineClip[]> {
  if (depth >= MAX_NESTING_DEPTH || !composition.timelineData) return [];

  const mediaStore = getMediaState();
  const result: TimelineClip[] = [];

  for (const sc of composition.timelineData.clips) {
    if (sc.isComposition && sc.compositionId) {
      const subComp = mediaStore.compositions.find(c => c.id === sc.compositionId);
      if (!subComp) continue;

      const clipId = generateNestedClipId(parentClipId, sc.id);
      const subDuration = subComp.timelineData?.duration ?? subComp.duration;
      const subNested = await loadSubNestedClips(
        subComp,
        clipId,
        rootCompClipId,
        depth + 1,
        getMediaState,
        get,
        paramsIsCurrentTimelineSession,
        applyNestedRuntimePatch,
        applySpatialFieldsWhenSourceMissing,
        restoreHooks,
      );

      result.push(createRestoredNestedCompositionClip(sc, {
        clipId,
        compositionId: sc.compositionId,
        compositionName: subComp.name,
        naturalDuration: subDuration,
        nestedClips: subNested,
        nestedTracks: subComp.timelineData?.tracks || [],
        isLoading: false,
      }));
      continue;
    }

    if (sc.sourceType === 'math-scene' && sc.mathScene) {
      const clipId = generateNestedClipId(parentClipId, sc.id);
      const clip = createRestoredMathSceneClip(sc, clipId);
      if (clip) {
        result.push(clip);
      }
      continue;
    }

    if (sc.sourceType === 'transition-overlay' && sc.transitionOverlay) {
      const clip = createRestoredTransitionOverlayClip(sc, generateNestedClipId(parentClipId, sc.id));
      if (clip) result.push(clip);
      continue;
    }

    const clipId = generateNestedClipId(parentClipId, sc.id);
    const motionClip = createRestoredMotionClip(sc, clipId);
    if (motionClip) {
      result.push(motionClip);
      continue;
    }

    const mediaFile = mediaStore.files.find(f => f.id === sc.mediaFileId);
    if (!mediaFile) {
      const primitiveMeshClip = createRestoredPrimitiveMeshClip(sc, clipId);
      if (primitiveMeshClip) {
        result.push(primitiveMeshClip);
      }
      continue;
    }

    const clipDepth = depth + 1;
    const mediaRestoreEvent = createNestedMediaRestoreEvent({
      rootCompClipId,
      parentClipId,
      nestedClipId: clipId,
      serializedClip: sc,
      mediaFile,
      depth: clipDepth,
    });
    const clip = createRestoredNestedMediaClip(sc, {
      clipId,
      file: mediaFile.file ?? createNestedPlaceholderFile(mediaFile.name || sc.name),
      source: null,
      isLoading: true,
      needsReload: getNestedNeedsReload(restoreHooks, mediaRestoreEvent),
    });
    const type = sc.sourceType;
    if (type === 'video' || type === 'audio') {
      clip.source = createDataOnlyRestoredMediaSource(sc, sc.duration, mediaFile, type);
      clip.isLoading = false;
      result.push(clip);
      continue;
    }

    result.push(clip);

    if (type === 'image') {
      const imageSource = createDataOnlyRestoredImageSource(clip.id, sc, sc.duration, mediaFile);
      if (!imageSource) {
        applyMissingRuntimeSourceFromHooks(clip, restoreHooks, mediaRestoreEvent);
        clip.isLoading = false;
        continue;
      }

      clip.file = mediaFile.file ?? clip.file;
      clip.source = imageSource;
      clip.isLoading = false;
      clip.needsReload = false;
      applyNestedRuntimePatch?.(clip.id, {
        source: imageSource,
        isLoading: false,
        needsReload: false,
      });
      notifyNestedRuntimeReady({
        get,
        restoreHooks,
        defaultInvalidatesCache: false,
        event: {
          rootCompClipId,
          parentClipId,
          nestedClipId: clip.id,
          clip,
          sourceType: 'image',
          depth: clipDepth,
        },
      });
    } else if (isVectorAnimationSourceType(type)) {
      if (!mediaFile.file) {
        applyMissingRuntimeSourceFromHooks(clip, restoreHooks, mediaRestoreEvent);
        clip.isLoading = false;
        continue;
      }
      startRestoredVectorRuntimeRestore({
        clip,
        serializedClip: sc,
        sourceType: type,
        file: mediaFile.file,
        isCurrentSession: paramsIsCurrentTimelineSession,
        applyPatch: (patch) => applyNestedRuntimePatch?.(clip.id, patch),
        onReady: () => {
          log.debug('Sub-nested vector animation loaded', { clipId, name: clip.name, type, depth });
          notifyNestedRuntimeReady({
            get,
            restoreHooks,
            defaultInvalidatesCache: false,
            event: {
            rootCompClipId,
            parentClipId,
            nestedClipId: clip.id,
              clip,
            sourceType: type,
              depth: clipDepth,
            },
          });
        },
        onError: (error) => {
          log.warn('Failed to load sub-nested vector animation', { clipId, type, error });
        },
      });
    } else if (isRestoredSpatialSourceType(type)) {
      const spatialResult = applyManagedRestoredSpatialSource(clip, sc, sc.duration, mediaFile, {
        applyFieldsWhenSourceMissing: applySpatialFieldsWhenSourceMissing,
      });
      if (!spatialResult.restored) {
        applyMissingRuntimeSourceFromHooks(clip, restoreHooks, mediaRestoreEvent);
        clip.isLoading = false;
      }
    }
  }

  return result;
}

export async function loadNestedClips(params: LoadNestedClipsParams): Promise<TimelineClip[]> {
  const {
    compClipId,
    composition,
    get,
    set,
    getMediaState: paramsGetMediaState,
    depth = 0,
    isCurrentTimelineSession,
    applySpatialFieldsWhenSourceMissing = true,
    restoreHooks,
  } = params;

  if (depth >= MAX_NESTING_DEPTH) {
    log.warn('Max nesting depth reached, skipping deeper nesting', { compClipId, depth });
    return [];
  }

  if (!composition.timelineData) return [];

  const getMediaState = paramsGetMediaState ?? await getDefaultNestedCompositionMediaState();
  const mediaStore = getMediaState();
  const nestedClips: TimelineClip[] = [];
  const nestedKeyframes = collectNestedClipKeyframes({
    parentClipId: compClipId,
    serializedClips: composition.timelineData.clips,
    compositions: mediaStore.compositions,
    depth,
  });

  log.info('loadNestedClips', {
    compClipId,
    compositionId: composition.id,
    compositionName: composition.name,
    serializedClipCount: composition.timelineData.clips.length,
    serializedClips: composition.timelineData.clips.map((c: SerializableClip) => ({
      id: c.id,
      name: c.name,
      trackId: c.trackId,
      mediaFileId: c.mediaFileId,
      sourceType: c.sourceType,
      hasKeyframes: !!(c.keyframes && c.keyframes.length > 0),
    })),
    availableMediaFiles: mediaStore.files.map(f => ({ id: f.id, name: f.name })),
  });

  for (const serializedClip of composition.timelineData.clips) {
    if (serializedClip.isComposition && serializedClip.compositionId) {
      const nestedComp = mediaStore.compositions.find(c => c.id === serializedClip.compositionId);
      if (!nestedComp) {
        log.warn('Could not find nested composition', {
          clip: serializedClip.name,
          compositionId: serializedClip.compositionId,
        });
        continue;
      }

      const nestedClipId = generateNestedClipId(compClipId, serializedClip.id);
      const compDuration = nestedComp.timelineData?.duration ?? nestedComp.duration;

      const nestedClip = createRestoredNestedCompositionClip(serializedClip, {
        clipId: nestedClipId,
        compositionId: serializedClip.compositionId,
        compositionName: nestedComp.name,
        naturalDuration: compDuration,
        nestedClips: [],
        nestedTracks: nestedComp.timelineData?.tracks || [],
        isLoading: true,
      });

      const subNestedClips = await loadSubNestedClips(
        nestedComp,
        nestedClipId,
        compClipId,
        depth + 1,
        getMediaState,
        get,
        isCurrentTimelineSession,
        (nestedClipIdToPatch, patch) => {
          patchNestedClipInStore(get, set, compClipId, nestedClipIdToPatch, patch);
        },
        applySpatialFieldsWhenSourceMissing,
        restoreHooks,
      );

      nestedClip.nestedClips = subNestedClips;
      nestedClip.isLoading = false;
      nestedClips.push(nestedClip);

      log.info('Loaded sub-nested composition', {
        nestedClipId,
        compositionName: nestedComp.name,
        subNestedClipCount: subNestedClips.length,
        depth: depth + 1,
      });
      continue;
    }

    if (serializedClip.sourceType === 'math-scene' && serializedClip.mathScene) {
      const nestedClipId = generateNestedClipId(compClipId, serializedClip.id);
      const nestedClip = createRestoredMathSceneClip(serializedClip, nestedClipId);
      if (!nestedClip) {
        continue;
      }
      nestedClips.push(nestedClip);

      continue;
    }

    if (serializedClip.sourceType === 'transition-overlay' && serializedClip.transitionOverlay) {
      const nestedClip = createRestoredTransitionOverlayClip(serializedClip, generateNestedClipId(compClipId, serializedClip.id));
      if (nestedClip) nestedClips.push(nestedClip);
      continue;
    }

    const nestedClipId = generateNestedClipId(compClipId, serializedClip.id);
    const motionClip = createRestoredMotionClip(serializedClip, nestedClipId);
    if (motionClip) {
      nestedClips.push(motionClip);
      continue;
    }

    const mediaFile = mediaStore.files.find(f => f.id === serializedClip.mediaFileId);
    if (!mediaFile) {
      const primitiveMeshClip = createRestoredPrimitiveMeshClip(serializedClip, nestedClipId);
      if (primitiveMeshClip) {
        nestedClips.push(primitiveMeshClip);
      } else {
        log.warn('Could not find media file for nested clip', {
          clip: serializedClip.name,
          mediaFileId: serializedClip.mediaFileId,
          sourceType: serializedClip.sourceType,
        });
      }
      continue;
    }

    const nestedClipDepth = depth + 1;
    const mediaRestoreEvent = createNestedMediaRestoreEvent({
      rootCompClipId: compClipId,
      parentClipId: compClipId,
      nestedClipId,
      serializedClip,
      mediaFile,
      depth: nestedClipDepth,
    });
    const nestedClip = createRestoredNestedMediaClip(serializedClip, {
      clipId: nestedClipId,
      file: mediaFile.file ?? createNestedPlaceholderFile(mediaFile.name || serializedClip.name),
      source: null,
      isLoading: true,
      needsReload: getNestedNeedsReload(restoreHooks, mediaRestoreEvent),
    });

    const type = serializedClip.sourceType;
    if (type === 'video' || type === 'audio') {
      nestedClip.source = createDataOnlyRestoredMediaSource(
        serializedClip,
        serializedClip.duration,
        mediaFile,
        type,
      );
      nestedClip.isLoading = false;
    }

    nestedClips.push(nestedClip);

    if (type === 'video' || type === 'audio') {
      continue;
    }

    if (type === 'image') {
      const imageSource = createDataOnlyRestoredImageSource(
        nestedClip.id,
        serializedClip,
        serializedClip.duration,
        mediaFile,
      );
      if (!imageSource) {
        applyMissingRuntimeSourceFromHooks(nestedClip, restoreHooks, mediaRestoreEvent);
        nestedClip.isLoading = false;
        continue;
      }

      nestedClip.file = mediaFile.file ?? nestedClip.file;
      nestedClip.source = imageSource;
      nestedClip.isLoading = false;
      nestedClip.needsReload = false;
      notifyNestedRuntimeReady({
        get,
        restoreHooks,
        defaultInvalidatesCache: true,
        event: {
          rootCompClipId: compClipId,
          parentClipId: compClipId,
          nestedClipId: nestedClip.id,
          clip: nestedClip,
          sourceType: 'image',
          depth: nestedClipDepth,
        },
      });
    } else if (isVectorAnimationSourceType(type)) {
      if (!mediaFile.file) {
        applyMissingRuntimeSourceFromHooks(nestedClip, restoreHooks, mediaRestoreEvent);
        nestedClip.isLoading = false;
        continue;
      }
      loadVectorAnimationNestedClip(
        compClipId,
        nestedClip.id,
        mediaFile.file,
        type,
        {
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        },
        nestedClip,
        get,
        set,
        isCurrentTimelineSession,
        restoreHooks,
        nestedClipDepth,
      );
    } else if (isRestoredSpatialSourceType(type)) {
      const spatialResult = applyManagedRestoredSpatialSource(nestedClip, serializedClip, serializedClip.duration, mediaFile, {
        applyFieldsWhenSourceMissing: applySpatialFieldsWhenSourceMissing,
      });
      if (!spatialResult.restored) {
        applyMissingRuntimeSourceFromHooks(nestedClip, restoreHooks, mediaRestoreEvent);
        nestedClip.isLoading = false;
      }
    }
  }

  if (!mergeNestedClipKeyframes({
    compClipId,
    nestedKeyframes,
    get,
    set,
    isCurrentTimelineSession,
  })) {
    return nestedClips;
  }

  if (nestedKeyframes.size > 0) {
    log.debug('Loaded nested clip keyframes', {
      compClipId,
      nestedKeyframeClipCount: nestedKeyframes.size,
    });
  }

  return nestedClips;
}

function loadVectorAnimationNestedClip(
  compClipId: string,
  nestedClipId: string,
  file: File,
  sourceType: VectorAnimationProvider,
  sourceInfo: {
    mediaFileId?: string;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  },
  targetClip: TimelineClip | undefined,
  get: NestedCompositionStoreGet,
  set: NestedCompositionStoreSet,
  isCurrentTimelineSession?: () => boolean,
  restoreHooks?: NestedCompositionRestoreHooks,
  depth = 1,
): void {
  const baseClip = targetClip ?? get().clips
    .find((clip) => clip.id === compClipId)
    ?.nestedClips?.find((clip) => clip.id === nestedClipId);

  const runtimeClip: TimelineClip = baseClip ?? {
    id: nestedClipId,
    trackId: '',
    name: file.name,
    file,
    startTime: 0,
    duration: sourceInfo.naturalDuration ?? 0,
    inPoint: 0,
    outPoint: sourceInfo.naturalDuration ?? 0,
    source: null,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
  };
  runtimeClip.file = file;
  runtimeClip.source = null;

  startRestoredVectorRuntimeRestore({
    clip: runtimeClip,
    serializedClip: {
      mediaFileId: sourceInfo.mediaFileId,
      naturalDuration: sourceInfo.naturalDuration,
      duration: runtimeClip.duration,
      vectorAnimationSettings: sourceInfo.vectorAnimationSettings,
    } as SerializableClip,
    sourceType,
    file,
    isCurrentSession: isCurrentTimelineSession,
    applyPatch: (patch) => {
      patchNestedClipInStore(get, set, compClipId, nestedClipId, patch);
    },
    onReady: () => {
      log.debug('Nested vector animation loaded', { compClipId, nestedClipId, sourceType });
      notifyNestedRuntimeReady({
        get,
        restoreHooks,
        defaultInvalidatesCache: true,
        event: {
          rootCompClipId: compClipId,
          parentClipId: compClipId,
          nestedClipId,
          clip: runtimeClip,
          sourceType,
          depth,
        },
      });
    },
    onError: (error) => {
      log.warn('Nested vector animation load failed', { compClipId, nestedClipId, sourceType, error });
    },
  });
}
