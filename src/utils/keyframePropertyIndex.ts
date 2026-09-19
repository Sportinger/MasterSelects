import type { Keyframe, AnimatableProperty } from '../types';

// Timeline edits replace keyframe arrays. Weak ownership avoids retaining old edits.
const indexes = new WeakMap<readonly Keyframe[], Map<AnimatableProperty, Keyframe[]>>();
const empty: Keyframe[] = [];
export function keyframesForProperty(keys: readonly Keyframe[], property: AnimatableProperty): readonly Keyframe[] {
  let index = indexes.get(keys);
  if (!index) {
    index = new Map();
    for (const key of keys) {
      const group = index.get(key.property);
      if (group) group.push(key); else index.set(key.property, [key]);
    }
    for (const [name, group] of index) index.set(name, group.toSorted((a, b) => a.time - b.time));
    indexes.set(keys, index);
  }
  return index.get(property) ?? empty;
}
