import type {
  CompositionTimelineData,
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
import { updateClipById } from './helpers/clipStateHelpers';
import { createDataOnlyRestoredMediaSource } from './restoredMediaSource';
import {
  applyManagedRestoredSpatialSource,
  createDataOnlyRestoredImageSource,
  createRestoredMathSceneClip,
  createRestoredMotionClip,
  createRestoredNestedCompositionClip,
  createRestoredNestedMediaClip,
  createRestoredPrimitiveMeshClip,
  isRestoredSpatialSourceType,
  patchNestedClipInCompositionClip,
} from './nestedRestore';
import {
  startRestoredVectorRuntimeRestore,
  type RestoredRuntimePatch,
} from './vectorRuntimeRestore';
import { Logger } from '../../services/logger';
import { thumbnailRenderer } from '../../services/thumbnailRenderer';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';

const log = Logger.create('NestedCompositionLoader');

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

/**
 * Calculate normalized boundary positions (0-1) for all clips in a nested composition.
 * These are used to render visual markers showing where clips start/end.
 */
export function calculateNestedClipBoundaries(
  timelineData: CompositionTimelineData | undefined,
  compDuration: number,
): number[] {
  if (!timelineData?.clips || !timelineData?.tracks || compDuration <= 0) {
    return [];
  }

  const videoTrackIds = new Set(
    timelineData.tracks
      .filter((t: { type: string; visible?: boolean }) => t.type === 'video' && t.visible !== false)
      .map((t: { id: string }) => t.id),
  );

  const boundaries = new Set<number>();

  for (const clip of timelineData.clips) {
    if (!videoTrackIds.has(clip.trackId)) continue;

    const startNorm = clip.startTime / compDuration;
    const endNorm = (clip.startTime + clip.duration) / compDuration;

    if (startNorm >= 0 && startNorm <= 1) {
      boundaries.add(startNorm);
    }
    if (endNorm >= 0 && endNorm <= 1) {
      boundaries.add(endNorm);
    }
  }

  return Array.from(boundaries)
    .filter(b => b > 0.001 && b < 0.999)
    .sort((a, b) => a - b);
}

/**
 * Build clip segments with thumbnails for nested composition display.
 * Each segment represents one clip with its own thumbnails.
 */
export interface ClipSegmentData {
  clipId: string;
  clipName: string;
  startNorm: number;
  endNorm: number;
  thumbnails: string[];
}

export interface CollectNestedClipKeyframesParams {
  parentClipId: string;
  serializedClips: readonly SerializableClip[];
  compositions: readonly Composition[];
  depth?: number;
}

export function collectNestedClipKeyframes(params: CollectNestedClipKeyframesParams): Map<string, Keyframe[]> {
  const {
    parentClipId,
    serializedClips,
    compositions,
    depth = 0,
  } = params;
  const keyframesByClipId = new Map<string, Keyframe[]>();

  if (depth >= MAX_NESTING_DEPTH) {
    return keyframesByClipId;
  }

  const merge = (nestedKeyframes: Map<string, Keyframe[]>): void => {
    nestedKeyframes.forEach((keyframes, clipId) => {
      keyframesByClipId.set(clipId, keyframes);
    });
  };

  for (const serializedClip of serializedClips) {
    const nestedClipId = generateNestedClipId(parentClipId, serializedClip.id);
    if (serializedClip.keyframes?.length) {
      keyframesByClipId.set(
        nestedClipId,
        serializedClip.keyframes.map((keyframe: Keyframe) => ({
          ...keyframe,
          clipId: nestedClipId,
        })),
      );
    }

    if (serializedClip.isComposition && serializedClip.compositionId) {
      const nestedComposition = compositions.find(composition => composition.id === serializedClip.compositionId);
      if (nestedComposition?.timelineData?.clips?.length) {
        merge(collectNestedClipKeyframes({
          parentClipId: nestedClipId,
          serializedClips: nestedComposition.timelineData.clips,
          compositions,
          depth: depth + 1,
        }));
      }
    }
  }

  return keyframesByClipId;
}

export interface MergeNestedClipKeyframesParams {
  compClipId: string;
  nestedKeyframes: Map<string, Keyframe[]>;
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
  isCurrentTimelineSession?: () => boolean;
}

export function mergeNestedClipKeyframes(params: MergeNestedClipKeyframesParams): boolean {
  const {
    compClipId,
    nestedKeyframes,
    get,
    set,
    isCurrentTimelineSession,
  } = params;

  if (nestedKeyframes.size === 0) {
    return true;
  }

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    log.debug('Skipped stale nested keyframe merge', {
      compClipId,
      nestedKeyframeClipCount: nestedKeyframes.size,
    });
    return false;
  }

  const currentKeyframes = get().clipKeyframes ?? new Map<string, Keyframe[]>();
  const mergedKeyframes = new Map(currentKeyframes);
  nestedKeyframes.forEach((keyframes, clipId) => {
    mergedKeyframes.set(clipId, keyframes);
  });
  set({ clipKeyframes: mergedKeyframes });
  log.info('Merged nested clip keyframes into store', {
    compClipId,
    nestedKeyframeClipCount: nestedKeyframes.size,
    totalKeyframeClipCount: mergedKeyframes.size,
  });
  return true;
}

export async function buildClipSegments(
  timelineData: CompositionTimelineData | undefined,
  compDuration: number,
  nestedClips: TimelineClip[],
): Promise<ClipSegmentData[]> {
  if (!timelineData?.clips || !timelineData?.tracks || compDuration <= 0) {
    return [];
  }

  const { generateVideoThumbnails } = await import('./helpers/thumbnailHelpers');

  const videoTrackIds = new Set(
    timelineData.tracks
      .filter((t: { type: string; visible?: boolean }) => t.type === 'video' && t.visible !== false)
      .map((t: { id: string }) => t.id),
  );

  const segments: ClipSegmentData[] = [];

  for (const serializedClip of timelineData.clips) {
    if (!videoTrackIds.has(serializedClip.trackId)) continue;
    if (serializedClip.sourceType === 'audio') continue;

    const startNorm = serializedClip.startTime / compDuration;
    const endNorm = (serializedClip.startTime + serializedClip.duration) / compDuration;
    const nestedClip = nestedClips.find(nc =>
      nc.id.includes(serializedClip.id) || nc.name === serializedClip.name
    );

    let thumbnails: string[] = [];

    if (nestedClip?.source?.videoElement) {
      const video = nestedClip.source.videoElement;
      if (video.readyState >= 2) {
        try {
          const clipDuration = serializedClip.outPoint - serializedClip.inPoint;
          const inPoint = serializedClip.inPoint || 0;
          const segmentWidth = endNorm - startNorm;
          const thumbCount = Math.max(1, Math.ceil(segmentWidth * 10));
          thumbnails = await generateVideoThumbnails(video, clipDuration, { offset: inPoint, maxCount: thumbCount });
        } catch (e) {
          log.warn('Failed to generate segment thumbnails', { clipId: serializedClip.id, error: e });
        }
      }
    } else if (nestedClip?.source?.imageElement) {
      const img = nestedClip.source.imageElement;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          thumbnails = [canvas.toDataURL('image/jpeg', 0.7)];
        }
      } catch {
        log.warn('Failed to generate image segment thumbnail', { clipId: serializedClip.id });
      }
    } else if (nestedClip?.source?.textCanvas) {
      if (isVectorAnimationSourceType(nestedClip.source.type)) {
        vectorAnimationRuntimeManager.renderClipAtTime(nestedClip, nestedClip.startTime);
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(nestedClip.source.textCanvas, 0, 0, canvas.width, canvas.height);
          thumbnails = [canvas.toDataURL('image/jpeg', 0.7)];
        }
      } catch (e) {
        log.warn('Failed to generate canvas segment thumbnail', { clipId: serializedClip.id, error: e });
      }
    }

    segments.push({
      clipId: serializedClip.id,
      clipName: serializedClip.name,
      startNorm,
      endNorm,
      thumbnails,
    });
  }

  segments.sort((a, b) => a.startNorm - b.startNorm);

  log.info('Built clip segments', {
    segmentCount: segments.length,
    segments: segments.map(s => ({
      name: s.clipName,
      range: `${(s.startNorm * 100).toFixed(1)}%-${(s.endNorm * 100).toFixed(1)}%`,
      thumbCount: s.thumbnails.length,
    })),
  });

  return segments;
}

export interface ScheduleNestedClipSegmentBuildParams {
  clipId: string;
  timelineData: CompositionTimelineData | undefined;
  compDuration: number;
  nestedClips: TimelineClip[];
  thumbnailsEnabled: boolean;
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
  isCurrentTimelineSession?: () => boolean;
  delayMs?: number;
  logLabel?: string;
}

export type ApplyNestedClipSegmentBuildParams = Omit<
  ScheduleNestedClipSegmentBuildParams,
  'thumbnailsEnabled' | 'delayMs'
>;

export async function buildAndApplyNestedClipSegments(params: ApplyNestedClipSegmentBuildParams): Promise<void> {
  const {
    clipId,
    timelineData,
    compDuration,
    nestedClips,
    get,
    set,
    isCurrentTimelineSession,
    logLabel = 'Set clip segments for nested comp',
  } = params;

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    return;
  }

  const freshCompClip = get().clips.find(clip => clip.id === clipId);
  if (!freshCompClip) {
    return;
  }

  const freshNestedClips = freshCompClip.nestedClips || nestedClips;
  const clipSegments = await buildClipSegments(
    timelineData,
    compDuration,
    freshNestedClips,
  );

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    return;
  }

  if (clipSegments.length > 0) {
    set({
      clips: get().clips.map(clip =>
        clip.id === clipId ? { ...clip, clipSegments } : clip
      ),
    });
    log.info(logLabel, { clipId, segmentCount: clipSegments.length });
  }
}

export function scheduleNestedClipSegmentBuild(params: ScheduleNestedClipSegmentBuildParams): void {
  const {
    thumbnailsEnabled,
    delayMs = 500,
  } = params;

  if (!thumbnailsEnabled) {
    return;
  }

  setTimeout(() => {
    void buildAndApplyNestedClipSegments(params);
  }, delayMs);
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

export interface GenerateCompThumbnailsParams {
  clipId: string;
  nestedClips: TimelineClip[];
  compDuration: number;
  thumbnailsEnabled: boolean;
  boundaries?: number[];
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
}

/**
 * Generate thumbnails for nested composition using WebGPU rendering.
 * Shows all layers with effects, not just the first video.
 * Uses segment boundaries to ensure each clip section gets a representative thumbnail.
 * Falls back to polling first video if WebGPU fails.
 */
export async function generateCompThumbnails(params: GenerateCompThumbnailsParams): Promise<void> {
  const { clipId, compDuration, thumbnailsEnabled, boundaries, get, set } = params;

  if (!thumbnailsEnabled) return;

  const compClip = get().clips.find((c: TimelineClip) => c.id === clipId);
  if (!compClip?.compositionId) {
    log.warn('No composition ID for comp clip', { clipId });
    return;
  }

  try {
    log.info('Generating WebGPU thumbnails for nested comp', {
      clipId,
      compositionId: compClip.compositionId,
      compDuration,
      boundaryCount: boundaries?.length ?? 0,
      boundaries: boundaries?.map(b => (b * 100).toFixed(1) + '%'),
    });

    const thumbnails = await thumbnailRenderer.generateCompositionThumbnails(
      compClip.compositionId,
      compDuration,
      { count: 10, width: 160, height: 90, boundaries },
    );

    log.info('WebGPU thumbnail result', { clipId, count: thumbnails.length, hasData: thumbnails.length > 0 });

    if (thumbnails.length > 0) {
      set({ clips: updateClipById(get().clips, clipId, { thumbnails }) });
      log.info('Set thumbnails for nested comp', { clipId, count: thumbnails.length });
      return;
    }

    log.warn('WebGPU returned empty thumbnails', { clipId, compositionId: compClip.compositionId });
  } catch (e) {
    log.error('WebGPU thumbnail generation failed, falling back to video-based', e);
  }

  log.warn('Using FALLBACK thumbnail generation (first video only)');
  await generateCompThumbnailsFallback(params);
}

async function generateCompThumbnailsFallback(params: GenerateCompThumbnailsParams): Promise<void> {
  const { clipId, nestedClips, compDuration, get, set } = params;

  const firstVideoClip = nestedClips.find(c =>
    c.file?.type?.startsWith('video/') ||
    c.source?.type === 'video' ||
    /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(c.file?.name || c.name || '')
  );
  const firstVideoClipId = firstVideoClip?.id;
  if (!firstVideoClipId) return;

  const { generateVideoThumbnails } = await import('./helpers/thumbnailHelpers');

  let attempts = 0;
  const maxAttempts = 50;

  const checkAndGenerate = async () => {
    if (!get().thumbnailsEnabled) return;

    const compClip = get().clips.find((c: TimelineClip) => c.id === clipId);
    const currentNestedClip = compClip?.nestedClips?.find((nc: TimelineClip) => nc.id === firstVideoClipId);
    const video = currentNestedClip?.source?.videoElement;

    if (video && video.readyState >= 2) {
      try {
        const thumbnails = await generateVideoThumbnails(video, compDuration);
        set({ clips: updateClipById(get().clips, clipId, { thumbnails }) });
        log.debug('Generated fallback thumbnails for nested comp', { clipId, count: thumbnails.length });
      } catch (e) {
        log.warn('Failed to generate fallback thumbnails for nested comp', e);
      }
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(checkAndGenerate, 100);
    } else {
      log.warn('Timeout waiting for nested video to load for thumbnails', { clipId });
    }
  };

  setTimeout(checkAndGenerate, 100);
}
