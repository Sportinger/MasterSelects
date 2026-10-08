import type { Composition } from '../../types';

/**
 * Collect every composition privately owned by `rootId`: transition
 * compositions referenced by its clips or parented to it, their legacy
 * backups, and legacy caption compositions, recursively. Removing the root
 * removes this set with it; duplicating the root clones it for the copy.
 *
 * Referenced ids are included even when the composition no longer exists, so
 * callers that need concrete compositions must filter for existence.
 */
export function collectPrivateChildCompositionIds(
  compositions: readonly Composition[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    const parentComposition = compositions.find((composition) => composition.id === parentId);
    const backupCompositionId = parentComposition?.transitionComp?.legacyBackupCompositionId;
    if (backupCompositionId && !ids.has(backupCompositionId)) {
      ids.add(backupCompositionId);
      pending.push(backupCompositionId);
    }
    for (const clip of parentComposition?.timelineData?.clips ?? []) {
      for (const transition of [clip.transitionIn, clip.transitionOut]) {
        if (transition?.compositionId && !ids.has(transition.compositionId)) {
          ids.add(transition.compositionId);
          pending.push(transition.compositionId);
        }
      }
    }
    for (const composition of compositions) {
      const isPrivateTransitionChild =
        composition.transitionComp?.kind === 'transition-comp'
        && composition.transitionComp.parentCompositionId === parentId;
      const isPrivateCaptionChild =
        composition.captionComp?.kind === 'caption-comp'
        && composition.captionComp.parentCompositionId === parentId;
      if ((!isPrivateTransitionChild && !isPrivateCaptionChild) || ids.has(composition.id)) continue;
      ids.add(composition.id);
      pending.push(composition.id);
    }
  }
  return ids;
}
