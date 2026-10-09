import type { Keyframe } from '../../../types';

export function findKeyframeOwner(
  clipKeyframes: Map<string, Keyframe[]>,
  keyframeId: string,
): { clipId: string; keyframe: Keyframe } | null {
  for (const [clipId, keyframes] of clipKeyframes) {
    const keyframe = keyframes.find(candidate => candidate.id === keyframeId);
    if (keyframe) return { clipId, keyframe };
  }
  return null;
}

/** Store keyframe arrays are immutable: unchanged clips need no traversal or serialization. */
export function keyframeSnapshot(clipKeyframes: Map<string, Keyframe[]>): Map<string, Keyframe[]> {
  return new Map(clipKeyframes);
}

export function changedKeyframeClipIds(before: Map<string, Keyframe[]>, after: Map<string, Keyframe[]>): string[] {
  const clipIds = new Set([...before.keys(), ...after.keys()]);
  return [...clipIds].filter(clipId => {
    const a = before.get(clipId), b = after.get(clipId);
    if (a === b) return false;
    if (!a || !b || a.length !== b.length) return true;
    return a.some((key, index) => key !== b[index] && JSON.stringify(key) !== JSON.stringify(b[index]));
  });
}

export function clonePathKeyframeValue(pathValue: NonNullable<Keyframe['pathValue']>): NonNullable<Keyframe['pathValue']> {
  return structuredClone(pathValue);
}

export function createPathValueKeyframeId(): string {
  return `kf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function applyKeyframeSelection(
  currentSelection: Set<string>,
  selectedKeyframeIds: readonly string[],
  mode: 'replace' | 'add' | 'remove' | 'toggle' | 'clear',
): Set<string> {
  if (mode === 'clear') return new Set();

  const nextSelection = mode === 'replace' ? new Set<string>() : new Set(currentSelection);
  for (const keyframeId of selectedKeyframeIds) {
    if (mode === 'remove') {
      nextSelection.delete(keyframeId);
    } else if (mode === 'toggle') {
      if (nextSelection.has(keyframeId)) {
        nextSelection.delete(keyframeId);
      } else {
        nextSelection.add(keyframeId);
      }
    } else {
      nextSelection.add(keyframeId);
    }
  }
  return nextSelection;
}
