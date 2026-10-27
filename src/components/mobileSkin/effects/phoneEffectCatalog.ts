// Pure catalog rules of the phone Effects sheet: which groups and effects it lists (straight from the
// editor's registry, getCategoriesWithEffects), which parameter is an effect's one main slider, and
// whether an effect can be added to the current target (adjustment layers render only the effects
// the editor admits for them, SUPPORTED_ADJUSTMENT_EFFECT_TYPES). No store access here.

import { getCategoriesWithEffects, getEffect, type EffectDefinition, type EffectParam } from '../../../effects';
import type { LookDefinition } from '../../../effects/looks/types';
import {
  isSupportedAdjustmentEffectType, SUPPORTED_ADJUSTMENT_EFFECT_TYPES,
} from '../../../services/motionDesign/adjustment/supportedEffects';
import { phoneEffectPreviewParams } from './phoneEffectPreviewParams';

export interface PhoneEffectGroup {
  id: string;
  label: string;
  effects: readonly EffectDefinition[];
}

/** The editor's effect catalog in its own group order (every offered effect, nothing hidden). */
export function phoneEffectGroups(): PhoneEffectGroup[] {
  return getCategoriesWithEffects().map((group) => ({ id: group.group, label: group.category, effects: group.effects }));
}

/** Effects of `groupId` ('all' for every group) whose name, id or group matches `query`, catalog order kept. */
export function filterPhoneEffects(groups: readonly PhoneEffectGroup[], groupId: string, query: string): EffectDefinition[] {
  const needle = query.trim().toLocaleLowerCase();
  return groups
    .filter((group) => groupId === 'all' || group.id === groupId)
    .flatMap((group) => group.effects.filter((effect) => (
      !needle || `${effect.name} ${effect.id} ${group.label}`.toLocaleLowerCase().includes(needle)
    )));
}

/**
 * The one-effect Look a card preview renders (as the desktop effect picker builds it): the effect at
 * its default parameters, so the thumbnail runtime shows what adding it does. Effects that are neutral
 * at their defaults render at a fixed demonstrative strength (phoneEffectPreviewParams.ts).
 */
export function phoneEffectPreviewLook(effect: EffectDefinition): LookDefinition {
  const { params, demo } = phoneEffectPreviewParams(effect.id);
  return {
    id: `effect-preview-${effect.id}${demo ? '-demo' : ''}`,
    name: effect.name,
    category: 'digital',
    thumbnail: { kind: 'generated' },
    stack: [{ effectId: effect.id, params, enabled: true }],
    tags: [effect.id],
    builtIn: true,
  };
}

/** Parameter names tried in this order for the one main slider of an effect. */
const PRIMARY_PARAM_ORDER = [
  'amount', 'opacity', 'strength', 'intensity', 'radius', 'size', 'exposure', 'temperature', 'shift',
  'level', 'levels', 'gamma', 'progress', 'trail',
] as const;

function isPlainVisibleNumber(param: EffectParam): boolean {
  return param.type === 'number' && !param.hidden && !param.deprecated && !param.quality && !param.graphOnly;
}

export interface PhonePrimaryParam {
  name: string;
  param: EffectParam;
}

/**
 * The parameter the phone shows as an effect's one main slider: the first visible number parameter
 * named like an intensity (amount, opacity, strength, …), otherwise its first visible number
 * parameter. Null for effects without one (Invert, Mirror, Chroma Key …): they are on/off only on
 * the phone until the full parameter set ships (M3).
 */
export function phonePrimaryParam(effectType: string): PhonePrimaryParam | null {
  const definition = getEffect(effectType);
  if (!definition) return null;
  const entries = Object.entries(definition.params).filter(([, param]) => isPlainVisibleNumber(param));
  for (const name of PRIMARY_PARAM_ORDER) {
    const hit = entries.find(([key]) => key === name);
    if (hit) return { name: hit[0], param: hit[1] };
  }
  const first = entries.find(([, param]) => param.animatable !== false) ?? entries[0];
  return first ? { name: first[0], param: first[1] } : null;
}

/** Slider bounds of a parameter; a parameter without declared bounds gets a range around its default. */
export function phoneParamRange(param: EffectParam): { min: number; max: number; step: number } {
  const fallback = typeof param.default === 'number' ? param.default : 0;
  const min = param.min ?? Math.min(0, fallback * 2);
  const max = param.max ?? Math.max(1, fallback * 2);
  const step = param.step ?? (max - min) / 100;
  return { min, max: max > min ? max : min + 1, step: step > 0 ? step : 0.01 };
}

/** Target kinds the Effects sheet edits. */
export type PhoneEffectTargetKind = 'clip' | 'adjustment';

export type PhoneEffectAvailability = { kind: 'available' } | { kind: 'unavailable'; reason: string };

const ADJUSTMENT_NAMES = SUPPORTED_ADJUSTMENT_EFFECT_TYPES.map((type) => getEffect(type)?.name ?? type);

/** Short sentence naming what an adjustment layer can render, from the editor's admission list. */
export const PHONE_ADJUSTMENT_SUPPORT_NOTE = `Adjustment layers render ${ADJUSTMENT_NAMES.slice(0, -1).join(', ')} and ${ADJUSTMENT_NAMES.at(-1)} so far.`;

/** Whether `effectType` can be added to the target; adjustment layers admit only the editor's supported set. */
export function phoneEffectAvailability(effectType: string, target: PhoneEffectTargetKind): PhoneEffectAvailability {
  if (!getEffect(effectType)) return { kind: 'unavailable', reason: `The effect ${effectType} is not in this editor version.` };
  if (target === 'adjustment' && !isSupportedAdjustmentEffectType(effectType)) {
    return { kind: 'unavailable', reason: `${getEffect(effectType)!.name} cannot go on an adjustment layer yet. ${PHONE_ADJUSTMENT_SUPPORT_NOTE} Select a clip to use it on that clip.` };
  }
  return { kind: 'available' };
}

/** Value shown next to a slider, in the parameter's display unit (degrees, EV …). */
export function formatPhoneParamValue(param: Pick<EffectParam, 'displayScale' | 'unit' | 'displayUnit' | 'step'>, value: number): string {
  const scale = param.displayUnit === 'degrees' ? 180 / Math.PI : param.displayScale ?? 1;
  const unit = param.displayUnit === 'degrees' ? '°' : param.unit ?? '';
  const shown = value * scale;
  const step = (param.step ?? 0.01) * scale;
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${shown.toFixed(decimals)}${unit}`;
}
