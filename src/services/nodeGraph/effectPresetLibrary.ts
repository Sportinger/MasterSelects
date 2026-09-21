import type { Effect } from '../../types/effects';
import { getEffect } from '../../effects';
import { effectOperatorGraph, hasEffectOperatorGraph } from '../operators/effectGraphOwner';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';

export const EFFECT_PRESET_STORAGE_KEY = 'masterselects.effect.presets.v1';
export interface EffectPreset {
  id: string;
  label: string;
  effect: Pick<Effect, 'type' | 'enabled' | 'params' | 'operatorGraph'>;
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StoragePort {
  try { return window.localStorage; }
  catch { throw new Error('Effect preset storage is unavailable in this browser.'); }
}

export function listEffectPresets(store: StoragePort = storage()): EffectPreset[] {
  const raw = store.getItem(EFFECT_PRESET_STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.presets)
    || !data.presets.every((preset: Partial<EffectPreset> | null) => preset && typeof preset.id === 'string'
      && typeof preset.label === 'string' && preset.effect && typeof preset.effect.type === 'string'
      && typeof preset.effect.enabled === 'boolean' && preset.effect.params && typeof preset.effect.params === 'object')) {
    throw new Error('The effect preset library could not be read.');
  }
  return data.presets;
}

function write(presets: EffectPreset[], store: StoragePort): void {
  try { store.setItem(EFFECT_PRESET_STORAGE_KEY, JSON.stringify({ version: 1, presets })); }
  catch { throw new Error('Could not save effect presets. Browser storage may be full or disabled.'); }
}

export function saveEffectPreset(effect: Effect, label: string, store: StoragePort = storage()): EffectPreset {
  if (!label.trim()) throw new Error('Enter a name for the effect preset.');
  if (!getEffect(effect.type)) throw new Error('This effect cannot be saved as a preset.');
  // Explicit durable fields exclude transient tracking/render resources.
  const params = structuredClone(effect.params);
  const resolvedGraph = hasEffectOperatorGraph(effect.type) ? effectOperatorGraph(effect) : undefined;
  const operatorGraph = resolvedGraph ? structuredClone(effect.operatorGraph ?? resolvedGraph) : undefined;
  delete params[EFFECT_GRAPH_PARAM];
  const preset: EffectPreset = { id: crypto.randomUUID(), label: label.trim().slice(0, 80),
    effect: { type: effect.type, enabled: effect.enabled, params, ...(operatorGraph ? { operatorGraph } : {}) } };
  write([...listEffectPresets(store), preset], store);
  return preset;
}

export function removeEffectPreset(id: string, store: StoragePort = storage()): void {
  write(listEffectPresets(store).filter(preset => preset.id !== id), store);
}

export function instantiateEffectPreset(preset: EffectPreset): Effect {
  if (!getEffect(preset.effect.type)) throw new Error('This preset’s effect is no longer available.');
  const effect: Effect = { ...structuredClone(preset.effect), id: crypto.randomUUID(), name: preset.label };
  // Operator IDs are local to their effect owner; the new owner ID isolates every copy.
  if (hasEffectOperatorGraph(effect.type)) effectOperatorGraph(effect);
  return effect;
}
