import type { TimelineClip } from './types';
import { releaseLegacyTimelineClipSourceRuntimes } from '../../services/timeline/timelineClipSourceRuntimeCleanup';

const generations = new WeakMap<object, Map<string, symbol>>();

/** All async installers of one composition instance share the same generation. */
export function beginNestedCompositionLoad(storeGet: object, clipId: string): () => boolean {
  const byClip = generations.get(storeGet) ?? new Map<string, symbol>();
  generations.set(storeGet, byClip);
  const generation = Symbol(clipId);
  byClip.set(clipId, generation);
  return () => byClip.get(clipId) === generation;
}

export function releaseStaleNestedCompositionClips(clips: readonly TimelineClip[]): void {
  releaseLegacyTimelineClipSourceRuntimes(clips, {
    disposeAudioRouting: true,
    recurseNestedClips: true,
    // Vector restore already owns generation-aware cleanup for these same IDs.
    releaseVectorRuntime: false,
  });
}
