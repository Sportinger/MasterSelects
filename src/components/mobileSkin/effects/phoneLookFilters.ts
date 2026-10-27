// Filters of the phone skin are the editor's Looks (effects/looks: the built-in starter Looks plus the
// person's saved ones). A filter is applied with the editor's own applyLookToClip, so the clip gets the
// same editable effect stack as on the desktop. Strength is the phone's one slider: it scales each
// Look effect's mix-like control (Amount, Mix, Opacity) between "none" and the Look's value, and the
// neutral colour effects (Brightness, Contrast …) between their neutral value and the Look's. Effects
// without such a control keep their values and are named in the sheet (no silent clamping).

import { getEffect, getEffectDisplayName } from '../../../effects';
import { applyLookToClip } from '../../../effects/looks/applyLook';
import { lookEntryParams } from '../../../effects/looks/lookEntryGraph';
import type { LookDefinition } from '../../../effects/looks/types';
import { COLOR_RECIPE_EFFECT_TYPES } from '../../../services/operators/colorEffectGraphs';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty, type AnimatableProperty } from '../../../types/animationProperties';
import type { Effect } from '../../../types/effects';
import { phonePrimaryParam } from './phoneEffectCatalog';
import { phoneVisibleEffects } from './usePhoneEffectsCommands';

const MIX_LIKE = new Set(['amount', 'opacity', 'intensity', 'mix']);

export interface PhoneStrengthControl {
  name: string;
  /** Value at strength 0 (the effect does nothing). */
  neutral: number;
}

/** The control Strength scales on an effect of `effectType`, or null when it has none. */
export function phoneStrengthControl(effectType: string): PhoneStrengthControl | null {
  const primary = phonePrimaryParam(effectType);
  if (!primary || typeof primary.param.default !== 'number') return null;
  // The rebuilt colour recipes are identity at their defaults (Brightness 0, Contrast 1, Saturation 1 …).
  if (COLOR_RECIPE_EFFECT_TYPES.has(effectType)) return { name: primary.name, neutral: primary.param.default };
  if (MIX_LIKE.has(primary.name) && (primary.param.min ?? 0) === 0) return { name: primary.name, neutral: 0 };
  return null;
}

/** One effect a filter put on a clip, with what Strength does to it. */
export interface PhoneFilterEffect {
  effectId: string;
  effectType: string;
  /** Null: Strength leaves this effect as it is. */
  control: PhoneStrengthControl | null;
  /** The control's value at strength 1 (the Look's own value). */
  full: number;
}

export interface PhoneAppliedFilter {
  clipId: string;
  lookId: string;
  effects: PhoneFilterEffect[];
}

/** Value of a strength-scaled control at strength `strength` (0..1). */
export function phoneStrengthValue(effect: Pick<PhoneFilterEffect, 'control' | 'full'>, strength: number): number | null {
  if (!effect.control) return null;
  const s = Math.min(1, Math.max(0, strength));
  return effect.control.neutral + (effect.full - effect.control.neutral) * s;
}

function lookFullValue(look: LookDefinition, index: number, control: PhoneStrengthControl): number {
  const entry = look.stack[index];
  const value = lookEntryParams(look, entry)[control.name];
  if (typeof value === 'number') return value;
  const fallback = getEffect(entry.effectId)?.params[control.name]?.default;
  return typeof fallback === 'number' ? fallback : control.neutral;
}

/** Relative tolerance for comparing a stored number with a Look's value (store round trips, float noise). */
const VALUE_TOLERANCE = 1e-4;

function sameLookValue(expected: number | boolean | string, actual: unknown): boolean {
  if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) <= VALUE_TOLERANCE * Math.max(1, Math.abs(expected));
  if (typeof expected === 'string') return typeof actual === 'string' && actual.trim().toLowerCase() === expected.trim().toLowerCase();
  return actual === expected;
}

/** The value an effect renders with: its stored parameter, or the registry default when it stores none. */
function effectValue(effect: Effect, name: string): unknown {
  return effect.params[name] !== undefined ? effect.params[name] : getEffect(effect.type)?.params[name]?.default;
}

interface PhoneLookMatch {
  filter: PhoneAppliedFilter;
  strength: number;
  /** Parameters the Look sets that the effects carry: a more specific Look wins a tie. */
  matched: number;
}

/**
 * Whether `tail` (the last effects of a clip, same types as the Look) carries exactly `look`'s values,
 * with every strength control at the same strength. Null when any value differs: then the effects are
 * someone's own (or another Look's with the same types) and must not be taken for this filter.
 */
function matchLook(clipId: string, tail: readonly Effect[], look: LookDefinition): PhoneLookMatch | null {
  const controls = tail.map((effect) => phoneStrengthControl(effect.type));
  const fulls = controls.map((control, index) => (control ? lookFullValue(look, index, control) : 0));
  let scale = 1;
  for (let index = 0; index < tail.length; index++) {
    const control = controls[index];
    if (!control || Math.abs(fulls[index] - control.neutral) <= 1e-9) continue;
    const current = effectValue(tail[index], control.name);
    if (typeof current !== 'number') continue;
    scale = Math.min(1, Math.max(0, (current - control.neutral) / (fulls[index] - control.neutral)));
    break;
  }
  let matched = 0;
  for (let index = 0; index < tail.length; index++) {
    const control = controls[index];
    const expected: Record<string, number | boolean | string> = { ...lookEntryParams(look, look.stack[index]) };
    if (control) expected[control.name] = control.neutral + (fulls[index] - control.neutral) * scale;
    for (const [name, value] of Object.entries(expected)) {
      if (!sameLookValue(value, effectValue(tail[index], name))) return null;
      matched++;
    }
  }
  const effects = tail.map((effect, index): PhoneFilterEffect => ({
    effectId: effect.id, effectType: effect.type, control: controls[index], full: fulls[index],
  }));
  return { filter: { clipId, lookId: look.id, effects }, strength: scale, matched };
}

/**
 * The Look whose effects end the clip's visible stack: same types in the same order AND the Look's
 * values, every strength control at one common strength (which is returned). That is how a filter
 * applied earlier is found again: a Look leaves no other trace in the project than its effects.
 * Built-in Looks can share their effect types (PAL Broadcast, Weak Antenna and Worn VHS are all one
 * Analog Signal Lab), so types alone are not enough; and an effect the person added by hand with
 * their own values is not a filter, so without an exact match there is no filter (picking one then
 * adds it on top instead of deleting their effects). Among exact matches the most specific Look wins.
 */
export function detectPhoneFilter(
  clipId: string,
  effects: readonly Effect[] | undefined,
  looks: readonly LookDefinition[],
): { filter: PhoneAppliedFilter; strength: number } | null {
  const stack = phoneVisibleEffects(effects);
  let best: PhoneLookMatch | null = null;
  for (const look of looks) {
    const count = look.stack.length;
    if (count === 0 || count > stack.length) continue;
    const tail = stack.slice(stack.length - count);
    if (!tail.every((effect, index) => effect.type === look.stack[index].effectId)) continue;
    const match = matchLook(clipId, tail, look);
    if (match && (!best || match.filter.effects.length > best.filter.effects.length
      || (match.filter.effects.length === best.filter.effects.length && match.matched > best.matched))) best = match;
  }
  return best ? { filter: best.filter, strength: best.strength } : null;
}

/** Applies `look` to `clipId` with applyLookToClip and records the effects it added. Runs in the caller's transaction. */
export function applyPhoneFilter(look: LookDefinition, clipId: string): { filter: PhoneAppliedFilter; problems: string[] } {
  const before = new Set(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects.map((effect) => effect.id) ?? []);
  const problems = applyLookToClip(look, clipId);
  const after = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects ?? [];
  const added = after.filter((effect) => !before.has(effect.id));
  const effects = added.map((effect): PhoneFilterEffect => {
    const control = phoneStrengthControl(effect.type);
    const value = control ? effect.params[control.name] : undefined;
    return { effectId: effect.id, effectType: effect.type, control, full: typeof value === 'number' ? value : control?.neutral ?? 0 };
  });
  return { filter: { clipId, lookId: look.id, effects }, problems };
}

/** Removes a recorded filter's effects from its clip. Runs in the caller's transaction. */
export function removePhoneFilter(filter: PhoneAppliedFilter): void {
  const { removeClipEffect } = useTimelineStore.getState();
  for (const effect of filter.effects) removeClipEffect(filter.clipId, effect.effectId);
}

/** Sets every scalable control of a recorded filter to `strength` (absolute values; keyframed controls get a key, as on the desktop). */
export function setPhoneFilterStrength(filter: PhoneAppliedFilter, strength: number): void {
  const { setPropertyValue, clips } = useTimelineStore.getState();
  const clip = clips.find((candidate) => candidate.id === filter.clipId);
  for (const effect of filter.effects) {
    const value = phoneStrengthValue(effect, strength);
    if (value === null || !clip?.effects.some((candidate) => candidate.id === effect.effectId)) continue;
    setPropertyValue(filter.clipId, createEffectProperty(effect.effectId, effect.control!.name) as AnimatableProperty, value);
  }
}

/** Names of the effects Strength leaves unchanged, for the sheet's note. */
export function phoneUnscaledEffectNames(filter: PhoneAppliedFilter | null): string[] {
  if (!filter) return [];
  return [...new Set(filter.effects.filter((effect) => !effect.control)
    .map((effect) => getEffectDisplayName({ name: effect.effectType, type: effect.effectType })))];
}
