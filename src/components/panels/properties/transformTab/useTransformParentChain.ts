import { useShallow } from 'zustand/react/shallow';

import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../types/timeline';
import type { Keyframe } from '../../../../types/keyframes';

const NO_PARENT_CHAIN: readonly unknown[] = [];

/**
 * Everything a parented clip's composed transform reads besides the clip itself:
 * every ancestor clip object and its keyframe list (`getInterpolatedTransform`
 * composes the parent chain from the store). The array is compared shallowly, so
 * it changes exactly when one of these entries is replaced.
 */
export function selectTransformParentChain(
  state: { clips: readonly TimelineClip[]; clipKeyframes?: ReadonlyMap<string, readonly Keyframe[]> },
  clipId: string | null | undefined,
): readonly unknown[] {
  if (!clipId) return NO_PARENT_CHAIN;
  let clip = state.clips.find(candidate => candidate.id === clipId);
  if (!clip?.parentClipId) return NO_PARENT_CHAIN;
  const chain: unknown[] = [];
  const visited = new Set<string>([clipId]);
  while (clip?.parentClipId && !visited.has(clip.parentClipId)) {
    const parentId: string = clip.parentClipId;
    const parent = state.clips.find(candidate => candidate.id === parentId);
    if (!parent) break;
    visited.add(parentId);
    chain.push(parent, state.clipKeyframes?.get(parentId));
    clip = parent;
  }
  return chain.length ? chain : NO_PARENT_CHAIN;
}

/**
 * Re-renders the caller when a value the selected clip's composed transform
 * depends on changes outside the clip: an ancestor clip, its keyframes, or the
 * active composition size used to turn children rigidly with their parent.
 * Callers that subscribe only to the selected clip would otherwise keep showing
 * a stale composed transform after the parent moves.
 */
export function useTransformParentChainSubscription(clipId: string | null | undefined): void {
  const chain = useTimelineStore(useShallow(state => selectTransformParentChain(state, clipId)));
  const hasParent = chain.length > 0;
  useMediaStore(state => {
    if (!hasParent) return '';
    const composition = state.compositions.find(candidate => candidate.id === state.activeCompositionId);
    return composition ? `${composition.width ?? ''}x${composition.height ?? ''}` : '';
  });
}
