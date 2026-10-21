import { getEffect } from '../../effects';
import type { EffectParam, EffectPreset } from '../../effects/types';
import type { AnimatableProperty } from '../../types/animationProperties';
import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { getEditorRepositorySession } from '../project/repository/transaction/editorMutationRuntime';
import { finishEditorGesture, runEditorGesture } from '../project/repository/transaction/editorGestureOwnership';
import { isParameterNodeDriven } from '../parameterSources/parameterSourceTargets';
import { effectParamDefinitions, type EffectParamOwner } from '../operators/effectParamVisibility';

type Primitive = number | boolean | string;

/** The presets an effect declares in its definition (EffectPreset), in card order. */
export function effectPresets(type: string): readonly EffectPreset[] {
  return getEffect(type)?.presets ?? [];
}

/** Controls a preset may set on this instance: shown in its card (not hidden, retired or unread by its graph). */
function presetControls(effect: EffectParamOwner): Array<[string, EffectParam]> {
  return Object.entries(effectParamDefinitions(effect)).filter(([, definition]) => !definition.hidden && !definition.deprecated);
}

/**
 * Values a preset gives this instance: its own values, the default for every other shown control.
 * Text controls (a typed word, a ramp) keep what the user wrote unless the preset names them.
 */
export function resolveEffectPreset(effect: EffectParamOwner, preset: EffectPreset): Record<string, Primitive> {
  return Object.fromEntries(presetControls(effect).flatMap(([key, definition]): Array<[string, Primitive]> => {
    if (key in preset.params) return [[key, preset.params[key]]];
    return definition.type === 'text' ? [] : [[key, definition.default]];
  }));
}

const currentValue = (effect: EffectParamOwner, key: string, definition: EffectParam | undefined) =>
  effect.params[key] ?? definition?.legacyDefault ?? definition?.default;

/** The preset whose values the instance shows right now, if any (the card names it in its Preset row). */
export function matchingEffectPreset(effect: EffectParamOwner): EffectPreset | undefined {
  const definitions = getEffect(effect.type)?.params ?? {};
  return effectPresets(effect.type).find(preset => Object.entries(resolveEffectPreset(effect, preset))
    .every(([key, value]) => Object.is(currentValue(effect, key, definitions[key]), value)));
}

export interface EffectPresetResult {
  preset: EffectPreset;
  /** Controls the preset changed. */
  changed: string[];
  /** Controls left as they were, with the reason the card shows ("Amount has keyframes"). */
  kept: Array<{ key: string; label: string; reason: 'keyframes' | 'node' }>;
}

/** One line for the card: which controls kept their animation, or undefined when none did. */
export function effectPresetNotice(result: EffectPresetResult): string | undefined {
  if (!result.kept.length) return undefined;
  const names = (reason: 'keyframes' | 'node') => result.kept.filter(item => item.reason === reason).map(item => item.label);
  const join = (labels: string[]) => labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
  const parts = [
    names('keyframes').length ? `${join(names('keyframes'))} kept ${names('keyframes').length > 1 ? 'their' : 'its'} keyframes` : '',
    names('node').length ? `${join(names('node'))} stayed driven by ${names('node').length > 1 ? 'their nodes' : 'its node'}` : '',
  ].filter(Boolean);
  return `${result.preset.name}: ${parts.join('; ')}.`;
}

/**
 * Applies a preset in one undo step, as if the user set each control in the card. A control with
 * keyframes or a node driving it keeps its animation; the result names it, so nothing changes silently.
 */
export function applyEffectPreset(clipId: string, effectId: string, presetId: string): EffectPresetResult {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId), effect = clip?.effects.find(candidate => candidate.id === effectId);
  if (!clip || !effect || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const preset = effectPresets(effect.type).find(candidate => candidate.id === presetId);
  if (!preset) throw new Error(`${presetId} is not a preset of ${effect.type}.`);
  const definitions = getEffect(effect.type)?.params ?? {};
  const result: EffectPresetResult = { preset, changed: [], kept: [] };
  const numbers: Array<[string, number]> = [], others: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(resolveEffectPreset(effect, preset))) {
    const property = `effect.${effect.id}.${key}` as AnimatableProperty, label = definitions[key]?.label ?? key;
    if (typeof value === 'number' && state.hasKeyframes(clip.id, property)) { result.kept.push({ key, label, reason: 'keyframes' }); continue; }
    if (typeof value === 'number' && isParameterNodeDriven(clip, property)) { result.kept.push({ key, label, reason: 'node' }); continue; }
    if (Object.is(currentValue(effect, key, definitions[key]), value)) continue;
    if (typeof value === 'number') numbers.push([key, value]); else others[key] = value;
    result.changed.push(key);
  }
  if (!result.changed.length) return result;
  const batch = startBatch(`Apply preset ${preset.name}`);
  // In a project repository session the edits must run inside the batch's gesture to form one undo step.
  const repository = getEditorRepositorySession() !== null && batch.batchId !== null;
  const apply = () => {
    // Numbers go through the card's own path (parameter sources in constant mode included).
    for (const [key, value] of numbers) state.setPropertyValue(clip.id, `effect.${effect.id}.${key}` as AnimatableProperty, value);
    if (Object.keys(others).length) state.updateClipEffect(clip.id, effect.id, others);
  };
  try {
    if (repository) runEditorGesture(batch.batchId!, apply); else apply();
  } finally {
    if (batch.opened) {
      if (repository) finishEditorGesture(batch.batchId!);
      endBatch();
    }
  }
  return result;
}
