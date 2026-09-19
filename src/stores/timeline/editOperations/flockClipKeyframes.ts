import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { createFlockProperty, isFlockProperty, parseFlockProperty } from '../../../types/flock';

let keyframeCopyCounter = 0;

function generateFlockKeyframeCopyId(): string {
  keyframeCopyCounter += 1;
  return `kf_${Date.now()}_${keyframeCopyCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Flock graph parameter keyframes use the simulation-source time basis. Split
 * parts therefore inherit the complete parameter history unchanged (including
 * keys outside their visible window) so every part reproduces the original
 * motion at the cut. Non-flock keyframes are left to the existing split policy.
 */
export function copyFlockKeyframesToClipParts(
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>,
  originalClipId: string,
  partClipIds: readonly string[],
): Map<string, Keyframe[]> | null {
  const flockKeyframes = clipKeyframes.get(originalClipId)?.filter((keyframe) => isFlockProperty(keyframe.property));
  if (!flockKeyframes || flockKeyframes.length === 0 || partClipIds.length === 0) return null;
  const next = new Map<string, Keyframe[]>([...clipKeyframes].map(([clipId, keyframes]) => [clipId, [...keyframes]]));
  for (const partClipId of partClipIds) {
    const copies = flockKeyframes.map((keyframe) => ({
      ...structuredClone(keyframe),
      id: generateFlockKeyframeCopyId(),
      clipId: partClipId,
    }));
    next.set(partClipId, [...(next.get(partClipId) ?? []), ...copies].toSorted((a, b) => a.time - b.time));
  }
  return next;
}

/** Rewrites a flock keyframe property for an independent copy whose node ids were remapped. */
export function remapFlockKeyframeProperty(
  property: AnimatableProperty,
  nodeIdMap: Readonly<Record<string, string>>,
): AnimatableProperty {
  const parsed = parseFlockProperty(property);
  if (!parsed) return property;
  const nextNodeId = nodeIdMap[parsed.nodeId];
  return nextNodeId ? createFlockProperty(nextNodeId, parsed.param, parsed.component) : property;
}
