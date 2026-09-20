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

export function keyframeSnapshot(clipKeyframes: Map<string, Keyframe[]>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const [clipId, keyframes] of clipKeyframes) {
    snapshot.set(clipId, JSON.stringify(keyframes.map(keyframe => ({
      id: keyframe.id,
      property: keyframe.property,
      time: keyframe.time,
      value: keyframe.value,
      pathValue: keyframe.pathValue,
      easing: keyframe.easing,
      hold: keyframe.hold,
      handleIn: keyframe.handleIn,
      handleOut: keyframe.handleOut,
      rotationInterpolation: keyframe.rotationInterpolation,
    }))));
  }
  return snapshot;
}

export function changedKeyframeClipIds(before: Map<string, string>, after: Map<string, Keyframe[]>): string[] {
  const clipIds = new Set([...before.keys(), ...after.keys()]);
  return [...clipIds].filter((clipId) => before.get(clipId) !== keyframeSnapshot(new Map([[clipId, after.get(clipId) ?? []]])).get(clipId));
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
