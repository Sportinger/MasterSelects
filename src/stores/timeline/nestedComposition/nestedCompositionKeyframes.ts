import type { Keyframe } from '../../../types/keyframes';
import type { SerializableClip, TimelineClip } from '../../../types/timeline';
import { MAX_NESTING_DEPTH } from '../constants';
import { generateNestedClipId } from '../helpers/idGenerator';
import { Logger } from '../../../services/logger';
import type {
  NestedCompositionStoreGet,
  NestedCompositionStoreSet,
} from '../nestedCompositionLoader';

const log = Logger.create('NestedCompositionLoader');

export interface CollectNestedClipKeyframesParams {
  parentClipId: string;
  serializedClips: readonly SerializableClip[];
  compositions: readonly { id: string; timelineData?: { clips?: SerializableClip[] } }[];
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

function collectLoadedNestedClipIds(compClip: TimelineClip | undefined): Set<string> {
  const clipIds = new Set<string>();

  const collect = (clips: readonly TimelineClip[] | undefined): void => {
    for (const clip of clips ?? []) {
      clipIds.add(clip.id);
      collect(clip.nestedClips);
    }
  };

  collect(compClip?.nestedClips);
  return clipIds;
}

export function mergeNestedClipKeyframes(params: MergeNestedClipKeyframesParams): boolean {
  const {
    compClipId,
    nestedKeyframes,
    get,
    set,
    isCurrentTimelineSession,
  } = params;

  const state = get();
  const nestedClipIds = collectLoadedNestedClipIds(
    state.clips.find((clip) => clip.id === compClipId),
  );

  if (nestedKeyframes.size === 0 && nestedClipIds.size === 0) return true;

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    log.debug('Skipped stale nested keyframe merge', {
      compClipId,
      nestedKeyframeClipCount: nestedKeyframes.size,
    });
    return false;
  }

  const mergedKeyframes = new Map(state.clipKeyframes ?? new Map<string, Keyframe[]>());
  nestedClipIds.forEach((clipId) => {
    mergedKeyframes.delete(clipId);
  });
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
