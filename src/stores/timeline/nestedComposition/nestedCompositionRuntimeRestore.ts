// Runtime publication and relink hooks shared by direct and descendant restores.
import type { Composition, Keyframe, SerializableClip, TimelineClip, TimelineTrack } from '../types';
import type { VectorAnimationClipSettings, VectorAnimationProvider } from '../../../types/vectorAnimation';
import type { MediaFile } from '../../mediaStore/types';
import { DEFAULT_TRANSFORM } from '../constants';
import { patchNestedClipInCompositionClip } from '../nestedRestore';
import { startRestoredVectorRuntimeRestore, type RestoredRuntimePatch } from '../vectorRuntimeRestore';
import { Logger } from '../../../services/logger';

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
  activeCompositionId?: string | null;
}

export type NestedCompositionMediaGet = () => NestedCompositionMediaState;

export function patchNestedClipInStore(
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

export function createNestedPlaceholderFile(name: string | undefined): File {
  return new File([], name || 'pending');
}

export function createNestedMediaRestoreEvent(params: {
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

export function getNestedNeedsReload(
  restoreHooks: NestedCompositionRestoreHooks | undefined,
  event: NestedMediaRestoreEvent,
): boolean | undefined {
  return restoreHooks?.mediaRelink?.getNeedsReload?.(event);
}

export function applyMissingRuntimeSourceFromHooks(
  clip: TimelineClip,
  restoreHooks: NestedCompositionRestoreHooks | undefined,
  event: NestedMediaRestoreEvent,
): void {
  const source = restoreHooks?.mediaRelink?.createMissingRuntimeSource?.(event);
  if (source !== undefined) {
    clip.source = source;
  }
}

export function notifyNestedRuntimeReady(params: {
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

export function loadVectorAnimationNestedClip(
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
