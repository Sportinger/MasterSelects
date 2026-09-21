import type { Effect } from '../../types/effects';
import { getEffect, isParticleRenderEffectDefinition } from '../../effects';
import type { InlineEffectParams } from '../pipeline/CompositorPipeline';
import { isLocalImageEffectType } from '../../services/operators/effectGraphOwner';
import { prepareImageEffect } from '../../services/operators/imageEffectRuntimePlan';

export interface LayerEffectStack {
  inlineEffects: InlineEffectParams;
  complexEffects?: Effect[];
  renderEffects?: Effect[];
  unsupportedAfterRenderEffect?: Effect[];
}

function applyInlineEffect(inlineEffects: InlineEffectParams, effect: Effect): 'inline' | 'contextual' | 'incomplete' {
  if (isLocalImageEffectType(effect.type)) {
    const { plan: program } = prepareImageEffect(effect);
    if (!program) return 'incomplete';
    if (program.capabilities.length || program.passes?.length) return 'contextual';
    inlineEffects.operatorProgram = program;
    return 'inline';
  }
  return 'contextual';
}

function isParticleRenderEffect(effect: Effect): boolean {
  return isParticleRenderEffectDefinition(getEffect(effect.type));
}

export function splitLayerEffects(
  effects: Effect[] | undefined,
  skipEffects = false,
  separateInlineEffects = false,
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

  // A multi-effect chain must execute in stack order. Folding color operations into
  // the final compositor would move them past blur/distortion and merge duplicates.
  const preserveOrder = separateInlineEffects || effects.filter(effect => effect.enabled && !effect.type.startsWith('audio-')).length > 1;
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

    if (hasRenderEffect || preserveOrder) {
      complexEffects.push(effect);
      continue;
    }

    if (isLocalImageEffectType(effect.type)) {
      if (applyInlineEffect(inlineEffects, effect) === 'contextual') complexEffects.push(effect);
    } else complexEffects.push(effect);
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
