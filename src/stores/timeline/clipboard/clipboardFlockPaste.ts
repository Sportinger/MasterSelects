import type { FlockDefinition } from '../../../types/flock';
import type { ClipboardClipData, Keyframe } from '../types';
import { remapFlockDefinitionIds } from '../../../services/flock/mutations/flockGraphMutations';
import { remapFlockKeyframeProperty } from '../editOperations/flockClipKeyframes';

export interface PastedFlockCopy {
  definition: FlockDefinition;
  nodeIdMap: Record<string, string>;
}

/** A pasted flock clip owns an independent definition with fresh node ids. */
export function createPastedFlockCopy(clipData: Pick<ClipboardClipData, 'flock'>): PastedFlockCopy | null {
  return clipData.flock ? remapFlockDefinitionIds(clipData.flock) : null;
}

/** Copied clip keyframes with fresh ids; flock properties follow the remapped node ids. */
export function remapPastedClipKeyframes(
  keyframes: readonly Keyframe[] | undefined,
  clipId: string,
  createId: () => string,
  flockCopy: PastedFlockCopy | null,
): Keyframe[] | null {
  if (!keyframes || keyframes.length === 0) return null;
  return keyframes.map((keyframe) => ({
    ...keyframe,
    id: createId(),
    clipId,
    property: flockCopy ? remapFlockKeyframeProperty(keyframe.property, flockCopy.nodeIdMap) : keyframe.property,
  }));
}
