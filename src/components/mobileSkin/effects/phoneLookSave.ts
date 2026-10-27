// "Save as look" of the phone Effects sheet: the clip's visual effect stack becomes a saved Look in
// the editor's look store (useLookStore.saveCustomLook with stackFromClipEffects, the same recipe the
// desktop Looks panel saves). Looks live in this browser, not in the project, so saving is not an undo
// step. A Look keeps effect types, on/off, plain values and colour/print graphs; what it leaves out
// (animation, edited node graphs, linked resources such as images) is named before saving.

import { getDefaultParams, getEffectDisplayName } from '../../../effects';
import { stackFromClipEffects } from '../../../effects/looks/applyLook';
import { useLookStore } from '../../../effects/looks/lookStore';
import type { LookDefinition, LookStackEntry } from '../../../effects/looks/types';
import { effectOperatorGraph } from '../../../services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../../services/operators/effectFamilyPresentation';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import { phoneVisibleEffects } from './usePhoneEffectsCommands';

export interface PhoneLookSavePlan {
  stack: LookStackEntry[];
  /** What the Look will not carry, in plain words; empty when it keeps everything. */
  notes: string[];
}

export function planPhoneLookSave(effects: readonly Effect[] | undefined, keys: readonly Keyframe[]): PhoneLookSavePlan {
  const visible = phoneVisibleEffects(effects);
  const stack = stackFromClipEffects(visible);
  const notes: string[] = [];
  const ids = new Set(visible.map((effect) => effect.id));
  const animated = keys.filter((key) => key.property.startsWith('effect.') && ids.has(key.property.split('.')[1] ?? '')).length;
  if (animated > 0) notes.push(`${animated} effect keyframe${animated === 1 ? '' : 's'} (a Look keeps the values at rest, not the animation)`);
  const graphs = visible.filter((effect, index) => effect.operatorGraph && !stack[index]?.operatorGraph && stack[index]?.recipe === undefined && !isRecipeGraph(effect));
  if (graphs.length > 0) notes.push(`edited node graphs of ${graphs.map((effect) => getEffectDisplayName(effect)).join(', ')}`);
  const resources = visible.filter((effect) => Object.values(effect.params ?? {}).some((value) => value !== null && typeof value === 'object'));
  if (resources.length > 0) notes.push(`linked resources (images, paths) of ${resources.map((effect) => getEffectDisplayName(effect)).join(', ')}`);
  return { stack, notes };
}

/** A graph the effect gets back from its own recipe when the Look is applied (not an edit to lose). */
function isRecipeGraph(effect: Effect): boolean {
  if (!effect.operatorGraph) return true;
  try {
    // A fresh instance (no stored graph) yields the recipe the effect would rebuild.
    const recipe = effectOperatorGraph({ id: effect.id, type: effect.type, params: { ...getDefaultParams(effect.type), ...effect.params } } as never);
    return matchesEffectRecipe(effect.operatorGraph, recipe);
  } catch {
    return false;
  }
}

export type PhoneLookSaveResult = { ok: true; look: LookDefinition } | { ok: false; message: string };

export function savePhoneLook(name: string, effects: readonly Effect[] | undefined): PhoneLookSaveResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: 'Type a name for the look first.' };
  const stack = stackFromClipEffects(phoneVisibleEffects(effects));
  if (stack.length === 0) return { ok: false, message: 'This clip has no effects to save as a look. Add effects first.' };
  const look = useLookStore.getState().saveCustomLook(trimmed, stack);
  return look ? { ok: true, look } : { ok: false, message: 'The editor did not accept this stack as a look (unknown effects).' };
}
