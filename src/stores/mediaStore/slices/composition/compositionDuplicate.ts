import type { Composition } from '../../types';
import { collectPrivateChildCompositionIds } from './privateCompositionTree';

/**
 * Composition duplication.
 *
 * A duplicate is the composition plus every composition it privately owns
 * (transition compositions, their legacy backups, legacy caption
 * compositions). Each one is deep-cloned, so the copy never shares a mutable
 * object with the original.
 *
 * Clip, track, keyframe, effect, mask, and transition ids are kept. They are
 * scoped per composition: the project repository keys clips and tracks as
 * `clip:<compositionId>:<clipId>`, switching compositions replaces the whole
 * live timeline, and nested rendering derives runtime ids from the parent clip
 * (the same composition may already be nested several times). Keeping them
 * means every intra-composition reference stays valid without a remap that
 * could miss one: motion parents (`parentClipId`), linked clips and groups,
 * keyframe `clipId`s, transition partners, tracking and terrain targets,
 * caption bindings, and composition-graph node bindings.
 *
 * Only composition ids change. References to the cloned private compositions
 * are retargeted to the clones; references to shared, user-visible
 * compositions (nested composition clips) stay unchanged.
 */

/** Why `id` cannot be duplicated, or null when it can. */
export function describeCompositionDuplicateBlocker(
  composition: Composition | undefined,
  id: string,
): string | null {
  if (!composition) return `Composition not found: ${id}`;
  if (composition.transitionComp?.kind === 'transition-comp') {
    return `Composition ${id} is the private composition of a transition in composition `
      + `${composition.transitionComp.parentCompositionId}; duplicate that composition instead.`;
  }
  if (composition.captionComp?.kind === 'caption-comp') {
    return `Composition ${id} is the private caption composition of composition `
      + `${composition.captionComp.parentCompositionId}; duplicate that composition instead.`;
  }
  return null;
}

export interface CompositionDuplicatePlanInput {
  /** Current compositions, with the active composition's live timeline already mirrored in. */
  compositions: readonly Composition[];
  sourceId: string;
  name: string;
  createId: () => string;
  createdAt: number;
}

export interface CompositionDuplicatePlan {
  duplicate: Composition;
  /** Clones of the compositions the source privately owns, retargeted to the duplicate. */
  privateCopies: Composition[];
  /** Original composition id to clone id, including the source itself. */
  compositionIdMap: ReadonlyMap<string, string>;
  /** Transition composition references that pointed at missing compositions and were dropped. */
  droppedTransitionCompositionIds: string[];
}

function retargetPrivateCompositionRefs(
  composition: Composition,
  idMap: ReadonlyMap<string, string>,
  dropped: Set<string>,
): void {
  for (const clip of composition.timelineData?.clips ?? []) {
    if (clip.compositionId && idMap.has(clip.compositionId)) {
      clip.compositionId = idMap.get(clip.compositionId);
    }
    for (const transition of [clip.transitionIn, clip.transitionOut]) {
      if (!transition?.compositionId) continue;
      const mapped = idMap.get(transition.compositionId);
      // A transition composition is always private to its owner. A dangling
      // reference renders transiently, exactly like a never-opened transition.
      if (!mapped) dropped.add(transition.compositionId);
      transition.compositionId = mapped;
    }
  }
  const transitionLink = composition.transitionComp;
  if (transitionLink) {
    transitionLink.parentCompositionId =
      idMap.get(transitionLink.parentCompositionId) ?? transitionLink.parentCompositionId;
    if (transitionLink.legacyBackupCompositionId) {
      transitionLink.legacyBackupCompositionId = idMap.get(transitionLink.legacyBackupCompositionId);
    }
  }
  const captionLink = composition.captionComp;
  if (captionLink) {
    captionLink.parentCompositionId =
      idMap.get(captionLink.parentCompositionId) ?? captionLink.parentCompositionId;
  }
}

export function planCompositionDuplicate(input: CompositionDuplicatePlanInput): CompositionDuplicatePlan {
  const byId = new Map(input.compositions.map((composition) => [composition.id, composition]));
  const source = byId.get(input.sourceId);
  const blocker = describeCompositionDuplicateBlocker(source, input.sourceId);
  if (blocker || !source) throw new Error(blocker ?? `Composition not found: ${input.sourceId}`);

  const privateSources = [...collectPrivateChildCompositionIds(input.compositions, input.sourceId)]
    .map((id) => byId.get(id))
    .filter((composition): composition is Composition => composition !== undefined);
  const idMap = new Map<string, string>([[source.id, input.createId()]]);
  for (const composition of privateSources) idMap.set(composition.id, input.createId());

  const dropped = new Set<string>();
  const [duplicate, ...privateCopies] = [source, ...privateSources].map((original) => {
    const clone = structuredClone(original);
    clone.id = idMap.get(original.id)!;
    clone.createdAt = input.createdAt;
    retargetPrivateCompositionRefs(clone, idMap, dropped);
    return clone;
  });
  duplicate.name = input.name;

  return {
    duplicate,
    privateCopies,
    compositionIdMap: idMap,
    droppedTransitionCompositionIds: [...dropped],
  };
}
