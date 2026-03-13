import type { Effect } from '../../types';
import type { InlineEffectParams } from '../pipeline/CompositorPipeline';

export interface LayerEffectStack {
  inlineEffects: InlineEffectParams;
  complexEffects?: Effect[];
}

export function splitLayerEffects(
  effects: Effect[] | undefined,
  skipEffects = false
): LayerEffectStack {
  const inlineEffects: InlineEffectParams = {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    invert: false,
  };

  if (skipEffects || !effects || effects.length === 0) {
    return { inlineEffects };
  }

  const complexEffects: Effect[] = [];

  for (const effect of effects) {
    if (!effect.enabled || effect.type.startsWith('audio-')) {
      continue;
    }

    switch (effect.type) {
      case 'brightness':
        inlineEffects.brightness = (effect.params.amount as number) ?? 0;
        break;
      case 'contrast':
        inlineEffects.contrast = (effect.params.amount as number) ?? 1;
        break;
      case 'saturation':
        inlineEffects.saturation = (effect.params.amount as number) ?? 1;
        break;
      case 'invert':
        inlineEffects.invert = true;
        break;
      default:
        complexEffects.push(effect);
        break;
    }
  }

  return {
    inlineEffects,
    complexEffects: complexEffects.length > 0 ? complexEffects : undefined,
  };
}
