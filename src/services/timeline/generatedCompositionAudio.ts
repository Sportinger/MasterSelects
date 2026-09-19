import type { TimelineClip } from '../../types/timeline';

const silentChildren = new WeakMap<readonly TimelineClip[], boolean>();

/** Prove silence from restored generated sources; unresolved/media sources stay eligible. */
export function isSilentGeneratedComposition(clip: TimelineClip): boolean {
  if (!clip.isComposition || clip.isLoading || !clip.nestedClips?.length) return false;
  const children = clip.nestedClips;
  const cached = silentChildren.get(children);
  if (cached !== undefined) return cached;
  const silent = children.every(child => {
    if (child.isComposition) return isSilentGeneratedComposition(child);
    return ['text', 'motion-shape', 'motion-null', 'motion-adjustment', 'flock'].includes(child.source?.type ?? '');
  });
  // Only cache proofs: pending restoration can turn an unknown child into graphics.
  if (silent) silentChildren.set(children, true);
  return silent;
}
