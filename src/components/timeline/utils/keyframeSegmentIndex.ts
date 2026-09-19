interface SegmentKeyframe {
  id: string;
  property: string;
  time: number;
}

interface KeyframeSegmentIndex<T> {
  byId: Map<string, T>;
  outgoingIds: Set<string>;
  easingTargets: Map<string, T>;
}

// Keyframe arrays are replaced by timeline edits. Share the ordering across all
// property rows, and let old indexes disappear with their immutable source array.
const indexes = new WeakMap<readonly SegmentKeyframe[], KeyframeSegmentIndex<SegmentKeyframe>>();

export function getKeyframeSegmentIndex<T extends SegmentKeyframe>(
  keyframes: readonly T[],
): KeyframeSegmentIndex<T> {
  const cached = indexes.get(keyframes);
  if (cached) return cached as KeyframeSegmentIndex<T>;

  const byId = new Map<string, T>();
  const byProperty = new Map<string, T[]>();
  for (const keyframe of keyframes) {
    byId.set(keyframe.id, keyframe);
    const group = byProperty.get(keyframe.property);
    if (group) group.push(keyframe);
    else byProperty.set(keyframe.property, [keyframe]);
  }
  const outgoingIds = new Set<string>();
  const easingTargets = new Map<string, T>();
  for (const group of byProperty.values()) {
    const ordered = group.toSorted((a, b) => a.time - b.time);
    ordered.forEach((keyframe, index) => {
      if (index < ordered.length - 1) outgoingIds.add(keyframe.id);
      easingTargets.set(keyframe.id,
        index === ordered.length - 1 && index > 0 ? ordered[index - 1] : keyframe);
    });
  }
  const result = { byId, outgoingIds, easingTargets };
  indexes.set(keyframes, result);
  return result;
}
