import type { Effect } from '../../types/effects';
import { getEffect, isParticleRenderEffectDefinition } from '../../effects';
import type { InlineEffectParams } from '../pipeline/CompositorPipeline';

export interface LayerEffectStack {
  inlineEffects: InlineEffectParams;
  complexEffects?: Effect[];
  renderEffects?: Effect[];
  unsupportedAfterRenderEffect?: Effect[];
}

function applyInlineEffect(inlineEffects: InlineEffectParams, effect: Effect): void {
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
  }
}

function isParticleRenderEffect(effect: Effect): boolean {
  return isParticleRenderEffectDefinition(getEffect(effect.type));
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

  const hasRenderEffect = effects.some((effect) => (
    effect.enabled &&
    !effect.type.startsWith('audio-') &&
    isParticleRenderEffect(effect)
  ));
  const complexEffects: Effect[] = [];
  const renderEffects: Effect[] = [];
  const unsupportedAfterRenderEffect: Effect[] = [];
  let seenRenderEffect = false;

  for (const effect of effects) {
    if (!effect.enabled || effect.type.startsWith('audio-')) {
      continue;
    }

    if (seenRenderEffect) {
      unsupportedAfterRenderEffect.push(effect);
      continue;
    }

    if (isParticleRenderEffect(effect)) {
      renderEffects.push(effect);
      seenRenderEffect = true;
      continue;
    }

    if (hasRenderEffect) {
      complexEffects.push(effect);
      continue;
    }

    switch (effect.type) {
      case 'brightness':
      case 'contrast':
      case 'saturation':
      case 'invert':
        applyInlineEffect(inlineEffects, effect);
        break;
      default:
        complexEffects.push(effect);
        break;
    }
  }

  return {
    inlineEffects,
    complexEffects: complexEffects.length > 0 ? complexEffects : undefined,
    renderEffects: renderEffects.length > 0 ? renderEffects : undefined,
    unsupportedAfterRenderEffect: unsupportedAfterRenderEffect.length > 0
      ? unsupportedAfterRenderEffect
      : undefined,
  };
}

export function hasUnsupportedEffectsAfterRenderEffect(stack: LayerEffectStack): boolean {
  return !!stack.unsupportedAfterRenderEffect && stack.unsupportedAfterRenderEffect.length > 0;
}

export function hasParticleRenderEffect(stack: LayerEffectStack): boolean {
  return !!stack.renderEffects?.some((effect) => isParticleRenderEffect(effect));
}
