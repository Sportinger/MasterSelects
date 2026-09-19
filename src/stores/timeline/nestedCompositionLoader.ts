import type {
  Keyframe,
  SerializableClip,
  TimelineClip,
} from './types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import type { Composition } from './types';
import { MAX_NESTING_DEPTH } from './constants';
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
  createRestoredSolidClip,
  createRestoredTransitionOverlayClip,
  isRestoredSpatialSourceType,
} from './nestedRestore';
import {
  startRestoredVectorRuntimeRestore,
  type RestoredRuntimePatch,
} from './vectorRuntimeRestore';
import { collectNestedClipKeyframes, publishNestedClipKeyframes } from './nestedComposition/nestedCompositionKeyframes';
import { appendNestedTextClip } from './nestedComposition/nestedCompositionTextClip';
import { pushRestoredNestedFlockClip } from './nestedComposition/nestedFlockRestore';
import {
  applyMissingRuntimeSourceFromHooks,
  createNestedMediaRestoreEvent,
  createNestedPlaceholderFile,
  getNestedNeedsReload,
  loadVectorAnimationNestedClip,
  notifyNestedRuntimeReady,
  patchNestedClipInStore,
  type NestedCompositionMediaGet,
  type NestedCompositionRestoreHooks,
  type NestedCompositionStoreGet,
  type NestedCompositionStoreSet,
} from './nestedComposition/nestedCompositionRuntimeRestore';
export type {
  NestedCompositionMediaGet,
  NestedCompositionMediaState,
  NestedCompositionRestoreHooks,
  NestedCompositionStoreGet,
  NestedCompositionStoreSet,
  NestedCompositionStoreState,
  NestedMediaRestoreEvent,
  NestedRuntimeReadyEvent,
} from './nestedComposition/nestedCompositionRuntimeRestore';
import { Logger } from '../../services/logger';
import { sanitizeTimelineParentRestoreTree } from '../../services/motionDesign/structure/timelineParentRestoreAdapter';

const log = Logger.create('NestedCompositionLoader');

function remapNestedParentClipIds(
  scopeClipId: string,
  serializedClips: readonly SerializableClip[],
  restoredClips: readonly TimelineClip[],
): TimelineClip[] {
  const parentIdByRestoredClipId = new Map(serializedClips.map((clip) => [
    generateNestedClipId(scopeClipId, clip.id),
    clip.parentClipId
      ? generateNestedClipId(scopeClipId, clip.parentClipId)
      : undefined,
  ]));
  return restoredClips.map((clip) => {
    const parentClipId = parentIdByRestoredClipId.get(clip.id);
    if (parentClipId !== clip.parentClipId) {
      // These are newly restored runtime objects. Preserve their identity so
      // pending image/vector restore callbacks keep patching the returned clip.
      clip.parentClipId = parentClipId;
    }
    return clip;
  });
}

function applySanitizedParentAssignmentsInPlace(
  targetClips: readonly TimelineClip[],
  sanitizedClips: readonly TimelineClip[],
): void {
  const sanitizedById = new Map(sanitizedClips.map((clip) => [clip.id, clip]));
  for (const target of targetClips) {
    const sanitized = sanitizedById.get(target.id);
    if (!sanitized) continue;
    target.parentClipId = sanitized.parentClipId;
    if (target.nestedClips && sanitized.nestedClips) {
      applySanitizedParentAssignmentsInPlace(target.nestedClips, sanitized.nestedClips);
    }
  }
}

function sanitizeRemappedNestedParentGraph(
  compositionId: string,
  clips: readonly TimelineClip[],
): TimelineClip[] {
  const restored = sanitizeTimelineParentRestoreTree(compositionId, clips);
  if (restored.diagnostics.length > 0) {
    log.warn('Sanitized invalid Motion parent relationships during nested restore', {
      compositionId,
      failures: restored.diagnostics.map((item) => ({
        nestedCompositionId: item.compositionId,
        clipPath: item.clipPath,
        code: item.failure.code,
        clipIds: item.failure.clipIds,
      })),
    });
  }
  if (restored.changed) {
    // Runtime-backed nested clips can still have async restore work in flight.
    // Apply only the sanitized relationship fields onto those same objects.
    applySanitizedParentAssignmentsInPlace(clips, restored.clips);
  }
  return clips as TimelineClip[];
}

export { collectNestedClipKeyframes, mergeNestedClipKeyframes } from './nestedComposition/nestedCompositionKeyframes';
export { buildAndApplyNestedClipSegments, buildClipSegments, calculateNestedClipBoundaries, scheduleNestedClipSegmentBuild } from './nestedComposition/nestedCompositionSegments';
export type { CollectNestedClipKeyframesParams, MergeNestedClipKeyframesParams } from './nestedComposition/nestedCompositionKeyframes';
export type { ApplyNestedClipSegmentBuildParams, ClipSegmentData, ScheduleNestedClipSegmentBuildParams } from './nestedComposition/nestedCompositionSegments';
export { generateCompThumbnails } from './nestedComposition/nestedCompositionThumbnails';
export type { GenerateCompThumbnailsParams } from './nestedComposition/nestedCompositionThumbnails';

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
  /** Initial-load batching hook. Callers must publish these keyframes before exposing the clips. */
  deferNestedKeyframeMerge?: (keyframes: ReadonlyMap<string, Keyframe[]>) => void;
  /** Composition IDs above `composition` in the current nesting chain. */
  compositionPath?: readonly string[];
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
  compositionPath: readonly string[] = [],
): Promise<TimelineClip[]> {
  if (depth >= MAX_NESTING_DEPTH || !composition.timelineData) return [];

  if (compositionPath.includes(composition.id)) {
    log.warn('Cyclic nested composition reference skipped', {
      compositionId: composition.id,
      compositionName: composition.name,
      compositionPath: [...compositionPath, composition.id],
      depth,
    });
    return [];
  }

  const nextCompositionPath = [...compositionPath, composition.id];

  const mediaStore = getMediaState();
  const result: TimelineClip[] = [];

  for (const sc of composition.timelineData.clips) {
    if (paramsIsCurrentTimelineSession && !paramsIsCurrentTimelineSession()) break;
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
        nextCompositionPath,
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

    if (pushRestoredNestedFlockClip(result, sc, parentClipId)) continue;

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
    const solidClip = createRestoredSolidClip(sc, clipId, {
      width: composition.width,
      height: composition.height,
    });
    if (solidClip) {
      result.push(solidClip);
      continue;
    }

    const motionClip = createRestoredMotionClip(sc, clipId);
    if (motionClip) {
      result.push(motionClip);
      continue;
    }

    if (await appendNestedTextClip(result, sc, clipId, { width: composition.width, height: composition.height })) continue;
    if (paramsIsCurrentTimelineSession && !paramsIsCurrentTimelineSession()) break;

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

  return sanitizeRemappedNestedParentGraph(
    composition.id,
    remapNestedParentClipIds(
      parentClipId,
      composition.timelineData.clips,
      result,
    ),
  );
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
    deferNestedKeyframeMerge,
    compositionPath: paramsCompositionPath,
  } = params;

  if (depth >= MAX_NESTING_DEPTH) {
    log.warn('Max nesting depth reached, skipping deeper nesting', { compClipId, depth });
    return [];
  }

  if (!composition.timelineData) return [];

  const getMediaState = paramsGetMediaState ?? await getDefaultNestedCompositionMediaState();
  const mediaStore = getMediaState();
  const compositionPath = paramsCompositionPath ?? (
    mediaStore.activeCompositionId
      ? [mediaStore.activeCompositionId]
      : []
  );
  if (compositionPath.includes(composition.id)) {
    log.warn('Cyclic root composition reference skipped', {
      compClipId,
      compositionId: composition.id,
      compositionName: composition.name,
      compositionPath: [...compositionPath, composition.id],
      depth,
    });
    return [];
  }
  const nextCompositionPath = [...compositionPath, composition.id];
  const nestedClips: TimelineClip[] = [];
  const nestedKeyframes = collectNestedClipKeyframes({
    parentClipId: compClipId,
    serializedClips: composition.timelineData.clips,
    compositions: mediaStore.compositions,
    depth,
    compositionPath: nextCompositionPath,
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
    if (isCurrentTimelineSession && !isCurrentTimelineSession()) break;
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
          if (isCurrentTimelineSession && !isCurrentTimelineSession()) return;
          patchNestedClipInStore(get, set, compClipId, nestedClipIdToPatch, patch);
        },
        applySpatialFieldsWhenSourceMissing,
        restoreHooks,
        nextCompositionPath,
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

    if (pushRestoredNestedFlockClip(nestedClips, serializedClip, compClipId)) continue;

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
    const solidClip = createRestoredSolidClip(serializedClip, nestedClipId, {
      width: composition.width,
      height: composition.height,
    });
    if (solidClip) {
      nestedClips.push(solidClip);
      continue;
    }

    const motionClip = createRestoredMotionClip(serializedClip, nestedClipId);
    if (motionClip) {
      nestedClips.push(motionClip);
      continue;
    }

    if (await appendNestedTextClip(nestedClips, serializedClip, nestedClipId, { width: composition.width, height: composition.height })) continue;
    if (isCurrentTimelineSession && !isCurrentTimelineSession()) break;

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

  const nestedClipsWithRemappedParents = remapNestedParentClipIds(
    compClipId,
    composition.timelineData.clips,
    nestedClips,
  );
  const sanitizedNestedClips = sanitizeRemappedNestedParentGraph(
    composition.id,
    nestedClipsWithRemappedParents,
  );

  if (!publishNestedClipKeyframes({
    compClipId,
    nestedKeyframes,
    get,
    set,
    isCurrentTimelineSession,
    deferNestedKeyframeMerge,
  })) return sanitizedNestedClips;

  return sanitizedNestedClips;
}
