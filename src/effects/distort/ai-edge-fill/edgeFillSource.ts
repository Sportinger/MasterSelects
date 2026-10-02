import type { Effect } from '../../../types/effects';

/** Immutable description of the still and the geometry sampled by generation. */
export function edgeFillSource(file: File, effects: Effect[], effectId: string, framing?: unknown): { effects: Effect[]; signature: string } {
  const index = effects.findIndex(effect => effect.id === effectId && effect.type === 'ai-edge-fill');
  if (index < 0) throw new Error('AI Edge Fill effect no longer exists.');
  const preceding = effects.slice(0, index).filter(effect => effect.enabled && !effect.detached);
  if (preceding.some(effect => !['lens-correction', 'guided-perspective'].includes(effect.type) || effect.operatorGraph)) {
    throw new Error('Place AI Edge Fill after Lens Correction / Guided Perspective and before other effects.');
  }
  return { effects: preceding, signature: JSON.stringify([
    file.name, file.size, file.lastModified, framing ?? null,
    preceding.map(effect => [effect.id, effect.type, Object.entries(effect.params).toSorted(([a], [b]) => a.localeCompare(b))]),
  ]) };
}

export function edgeFillFraming(transform: import('../../../types').ClipTransform,
  composition: { id: string; width: number; height: number }) {
  return { compositionId: composition.id, width: composition.width, height: composition.height,
    position: transform.position, scale: transform.scale, rotation: transform.rotation, anchor: transform.anchor };
}

/** A lone unchanged keyframe is a static setting, not animated geometry. */
export function edgeFillHasAnimation(frames: ReadonlyArray<{ property: string; value: number; animationSource?: unknown }>,
  effects: Effect[], transform: import('../../../types').ClipTransform): boolean {
  return frames.some(frame => {
    let baseline: unknown;
    const effect = effects.find(item => frame.property.startsWith(`effect.${item.id}.`));
    if (effect) baseline = effect.params[frame.property.slice(`effect.${effect.id}.`.length)];
    else {
      const match = /^(position|scale|rotation|anchor)\.([xyz]|all)$/.exec(frame.property);
      if (!match) return false;
      baseline = (transform[match[1] as 'position' | 'scale' | 'rotation' | 'anchor'] as Record<string, number> | undefined)?.[match[2]] ?? (match[2] === 'all' ? 1 : 0);
    }
    return !!frame.animationSource || !Number.isFinite(frame.value) || frame.value !== baseline;
  });
}
