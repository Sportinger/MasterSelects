import type { Effect } from '../../../types/effects';
import { lensGeometryChangedSince327 } from '../lens-correction';

/** Immutable description of the still and the geometry sampled by generation. */
/** Marker an update adds to the signature when it draws a saved correction differently (a bug fix, not a user change). */
export const EDGE_FILL_UPDATE_MARKER = 'lens-geometry-2';

/**
 * `legacySignature` leaves the update markers out: a fill or a paid task made before the update carries it,
 * so the card can say the update (not the user) changed the correction, and a pending task can still resume.
 */
export function edgeFillSource(file: File, effects: Effect[], effectId: string, framing?: unknown): { effects: Effect[]; signature: string; legacySignature: string } {
  const index = effects.findIndex(effect => effect.id === effectId && effect.type === 'ai-edge-fill');
  if (index < 0) throw new Error('AI Edge Fill effect no longer exists.');
  const preceding = effects.slice(0, index).filter(effect => effect.enabled && !effect.detached);
  if (preceding.some(effect => !['lens-correction', 'guided-perspective'].includes(effect.type) || effect.operatorGraph)) {
    throw new Error('Place AI Edge Fill after Lens Correction / Guided Perspective and before other effects.');
  }
  const signature = (markers: boolean) => JSON.stringify([
    file.name, file.size, file.lastModified, framing ?? null,
    preceding.map(effect => [effect.id, effect.type, Object.entries(effect.params).toSorted(([a], [b]) => a.localeCompare(b)),
      // A Lens Correction that draws visibly differently since 3.2.7 (no fold, Fit sets the scale alone) marks older fills out of date.
      ...(markers && effect.type === 'lens-correction' && lensGeometryChangedSince327(effect.params as Record<string, number | boolean | string>) ? [EDGE_FILL_UPDATE_MARKER] : [])]),
  ]);
  return { effects: preceding, signature: signature(true), legacySignature: signature(false) };
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
