type CompositionReferenceClip = {
  isComposition?: boolean;
  compositionId?: string;
};

type CompositionReferenceNode = {
  id: string;
  timelineData?: {
    clips?: readonly CompositionReferenceClip[];
  };
};

function getReferencedCompositionIds(
  composition: CompositionReferenceNode | undefined,
): string[] {
  if (!composition?.timelineData?.clips) return [];
  return composition.timelineData.clips
    .filter((clip) => clip.isComposition === true && !!clip.compositionId)
    .map((clip) => clip.compositionId!);
}

/**
 * Returns the cycle that would be created by inserting childCompositionId
 * into parentCompositionId, or null when the insertion is acyclic.
 */
export function findCompositionInsertionCycle(params: {
  parentCompositionId: string;
  childCompositionId: string;
  compositions: readonly CompositionReferenceNode[];
}): string[] | null {
  const {
    parentCompositionId,
    childCompositionId,
    compositions,
  } = params;

  if (parentCompositionId === childCompositionId) {
    return [parentCompositionId, childCompositionId];
  }

  const compositionById = new Map(
    compositions.map((composition) => [composition.id, composition]),
  );
  const visited = new Set<string>();

  const findReferencePath = (compositionId: string, path: string[]): string[] | null => {
    if (compositionId === parentCompositionId) return path;
    if (visited.has(compositionId)) return null;
    visited.add(compositionId);

    for (const referencedId of getReferencedCompositionIds(compositionById.get(compositionId))) {
      const found = findReferencePath(referencedId, [...path, referencedId]);
      if (found) return found;
    }
    return null;
  };

  const referencePath = findReferencePath(childCompositionId, [childCompositionId]);
  return referencePath ? [parentCompositionId, ...referencePath] : null;
}
