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
import { effectParamDefinitions, graphBoundParameters, type EffectParamOwner } from '../operators/effectParamVisibility';
import { exposedGraphValues } from '../operators/exposedGraphValueList';
import { effectOperatorGraph, hasEffectOperatorGraph } from '../operators/effectGraphOwner';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';
import { getEffectOperator } from '../operators/operatorRegistry';

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
 * Whether a preset that does not name this control leaves it as it is: setup controls (`presetKeeps`:
 * Chroma Key's Screen, a measured lens profile, a figure's position) and quality controls (Edge
 * Sampling), which describe the shot or the render cost rather than the look.
 */
export const presetKeepsControl = (definition: EffectParam) => definition.presetKeeps ?? definition.quality === true;
/** Controls a preset resets when it leaves them out: not text (a typed word stays), retired or kept. */
const resetByPresets = (definition: EffectParam) => definition.type !== 'text' && !definition.deprecated && !presetKeepsControl(definition);

type GraphValue = { key: string; label: string; value?: number };
const graphValuesOf = (effect: EffectParamOwner): GraphValue[] => {
  if (!hasEffectOperatorGraph(effect.type)) return [];
  try {
    const graph = effectOperatorGraph(effect, { inspectionOnly: true });
    return exposedGraphValues(graph).map(({ key, label, nodeId }) => {
      // A bound value without a stored param runs at the node's literal, else at its operator's default.
      const node = graph.nodes.find(candidate => candidate.id === nodeId);
      const value = node?.constants?.value ?? getEffectOperator(node?.operator ?? '')?.parameters.find(parameter => parameter.id === 'value')?.default;
      return { key, label, value: typeof value === 'number' && Number.isFinite(value) ? value : undefined };
    });
  } catch { return []; }
};
/** The exposed values of the effect's default graph, built once per type (the card's graph value rows on a fresh instance). */
const defaultGraphCache = new Map<string, GraphValue[]>();
function defaultGraphValues(type: string): GraphValue[] {
  let values = defaultGraphCache.get(type);
  if (!values) defaultGraphCache.set(type, values = graphValuesOf({ type, params: {} }));
  return values;
}
/** Whether the instance runs an edited graph rather than its effect's default graph. */
const hasEditedGraph = (effect: EffectParamOwner) => !!effect.operatorGraph || effect.params[EFFECT_GRAPH_PARAM] !== undefined;

/**
 * Values a preset gives this instance: its own values, the default for every other shown control.
 * The shown controls are judged once on the target: the current values with every control at its
 * default and the preset's values in place, so a preset that switches a mode (a Form) resets the
 * controls of that mode, also of a mode it leaves by not naming it. Text controls (a typed word, a
 * ramp), setup controls (`presetKeeps`) and quality controls keep their value unless the preset names
 * them (presetKeepsControl). A graph effect's exposed graph values
 * (`<node>_value`) that any of its presets names return to the default graph's value when this preset
 * leaves them out, so the result never depends on the preset picked before.
 */
export function resolveEffectPreset(effect: EffectParamOwner, preset: EffectPreset): Record<string, Primitive> {
  const definitions = getEffect(effect.type)?.params ?? {};
  const defaults = Object.fromEntries(Object.entries(definitions)
    .filter(([, definition]) => resetByPresets(definition)).map(([key, definition]) => [key, definition.default]));
  const target = { ...effect, params: { ...effect.params, ...defaults, ...preset.params } };
  const values: Record<string, Primitive> = Object.fromEntries(presetControls(target)
    .flatMap(([key, definition]): Array<[string, Primitive]> => key in preset.params || !resetByPresets(definition) ? [] : [[key, definition.default]]));
  const named = new Set(effectPresets(effect.type).flatMap(candidate => Object.keys(candidate.params)).filter(key => !definitions[key]));
  for (const { key, value } of defaultGraphValues(effect.type)) if (named.has(key) && value !== undefined && !(key in preset.params)) values[key] = value;
  for (const [key, value] of Object.entries(preset.params)) if (!definitions[key]?.deprecated) values[key] = value;
  return values;
}

/** The card label of a control a preset sets on this instance: the parameter's, or its graph value's in the graph it runs. */
function presetControlLabel(effect: EffectParamOwner, key: string): string | undefined {
  return getEffect(effect.type)?.params[key]?.label ?? graphValuesOf(effect).find(value => value.key === key)?.label;
}

const currentValue = (effect: EffectParamOwner, key: string, definition: EffectParam | undefined) =>
  effect.params[key] ?? definition?.legacyDefault ?? definition?.default ?? defaultGraphValues(effect.type).find(value => value.key === key)?.value;

/**
 * resolveEffectPreset overwrites every control it resets with a default or the preset's value, so its
 * answer depends only on the rest of the params (text and kept controls, a stored graph, graph values,
 * retired params) and the instance's graph. Graph values a preset names are overwritten too. A slider drag makes a new params object per frame but leaves that
 * rest alone, so the card keeps one answer per rest (a few per effect type) instead of rebuilding the
 * control list for every preset on every frame.
 */
type ResolvedPresets = { type: string; graph: unknown; rest: Array<[string, unknown]>; values: Array<Record<string, Primitive>> };
const resolvedCache = new WeakMap<readonly EffectPreset[], ResolvedPresets[]>();
const RESOLVED_PER_TYPE = 8;
/** Keys resolveEffectPreset always sets: every control presets reset (resetByPresets) and every graph value a preset of the type names. */
function overwrittenKeys(type: string): Set<string> {
  const definitions = getEffect(type)?.params ?? {};
  const graphValues = effectPresets(type).flatMap(preset => Object.keys(preset.params)).filter(key => !definitions[key]);
  return new Set([...Object.entries(definitions).filter(([, definition]) => resetByPresets(definition)).map(([key]) => key), ...graphValues]);
}
const overwrittenCache = new WeakMap<readonly EffectPreset[], Map<string, Set<string>>>();
function resolvedPresetValues(effect: EffectParamOwner, presets: readonly EffectPreset[]): Array<Record<string, Primitive>> {
  let byType = overwrittenCache.get(presets);
  if (!byType) overwrittenCache.set(presets, byType = new Map());
  let overwritten = byType.get(effect.type);
  if (!overwritten) byType.set(effect.type, overwritten = overwrittenKeys(effect.type));
  const rest = Object.entries(effect.params).filter(([key]) => !overwritten.has(key));
  let entries = resolvedCache.get(presets);
  if (!entries) resolvedCache.set(presets, entries = []);
  // Two looks may share one presets array (a factory option): an entry answers only for its own type.
  const hit = entries.find(entry => entry.type === effect.type && entry.graph === effect.operatorGraph && entry.rest.length === rest.length
    && entry.rest.every(([key, value], index) => key === rest[index][0] && Object.is(value, rest[index][1])));
  if (hit) return hit.values;
  const values = presets.map(preset => resolveEffectPreset(effect, preset));
  entries.unshift({ type: effect.type, graph: effect.operatorGraph, rest, values });
  entries.length = Math.min(entries.length, RESOLVED_PER_TYPE);
  return values;
}

/**
 * Keys a preset names that this instance cannot set: a graphOnly control its stored graph does not read,
 * or a graph value (`<node>_value`) that graph does not expose. Only a stored graph (an edited one, or a
 * node setup saved by an earlier version) can lack them; the effect's current graph reads all of them.
 */
function unsetPresetKeys(effect: EffectParamOwner, preset: EffectPreset): string[] {
  if (!hasEditedGraph(effect)) return [];
  const definitions = getEffect(effect.type)?.params ?? {};
  const named = Object.keys(preset.params).filter(key => !definitions[key]?.deprecated);
  const bound = named.some(key => definitions[key]?.graphOnly) ? graphBoundParameters(effect) : undefined;
  const exposed = named.some(key => !definitions[key]) ? new Set(graphValuesOf(effect).map(value => value.key)) : undefined;
  return named.filter(key => definitions[key] ? !!definitions[key].graphOnly && !!bound && !bound.has(key) : !exposed?.has(key));
}

/**
 * The preset whose values the instance shows right now, if any (the card names it in its Preset row).
 * A preset that names a control the instance's stored graph lacks never matches: the card would name
 * a look it cannot show.
 */
export function matchingEffectPreset(effect: EffectParamOwner): EffectPreset | undefined {
  const presets = effectPresets(effect.type);
  if (!presets.length) return undefined;
  const definitions = getEffect(effect.type)?.params ?? {};
  const resolved = resolvedPresetValues(effect, presets);
  const match = presets.find((_, index) => Object.entries(resolved[index])
    .every(([key, value]) => Object.is(currentValue(effect, key, definitions[key]), value)));
  return match && !unsetPresetKeys(effect, match).length ? match : undefined;
}

export interface EffectPresetResult {
  preset: EffectPreset;
  /** Controls the preset changed. */
  changed: string[];
  /**
   * Controls left as they were, with the reason the card shows ("Amount has keyframes"); 'missing':
   * a graph value (or a graphOnly control) the preset names that this instance's stored graph (edited,
   * or saved by an earlier version) does not expose or read.
   */
  kept: Array<{ key: string; label: string; reason: 'keyframes' | 'node' | 'missing' }>;
  /** The instance runs a stored graph rather than the effect's current graph. */
  graphEdited?: boolean;
  /**
   * The effect's current graph has every missing control: applying the preset with `currentGraph`
   * swaps it in (the card offers it, Undo brings the stored graph back).
   */
  upgradable?: boolean;
  /** The stored graph was replaced by the effect's current graph (applyEffectPreset `currentGraph`). */
  graphReplaced?: boolean;
}

/**
 * One line for the card, or undefined when the preset simply applied: which controls kept their
 * animation or are missing from the stored graph, and when nothing changed at all, that it did not.
 */
export function effectPresetNotice(result: EffectPresetResult): string | undefined {
  const replaced = result.graphReplaced ? 'the node setup is updated (Undo brings back the old one)' : '';
  if (!result.kept.length) {
    if (replaced) return `${result.preset.name}: ${replaced}.`;
    return result.changed.length ? undefined : `${result.preset.name}: the card already has these values.`;
  }
  const names = (reason: EffectPresetResult['kept'][number]['reason']) => result.kept.filter(item => item.reason === reason).map(item => item.label);
  const join = (labels: string[]) => labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
  const missing = names('missing');
  const parts = [
    replaced,
    names('keyframes').length ? `${join(names('keyframes'))} kept ${names('keyframes').length > 1 ? 'their' : 'its'} keyframes` : '',
    names('node').length ? `${join(names('node'))} stayed driven by ${names('node').length > 1 ? 'their nodes' : 'its node'}` : '',
    // When `upgradable`, the card puts its Update node setup button right after this line.
    missing.length ? `${join(missing)} ${missing.length > 1 ? 'are' : 'is'} not in this effect's ${result.graphEdited ? 'saved node setup' : 'graph'}` : '',
  ].filter(Boolean);
  return `${result.preset.name}${result.changed.length || replaced ? '' : ' changed nothing'}: ${parts.join('; ')}.`;
}

/** The instance on the effect's current graph: no stored graph, so its default graph renders. */
function onCurrentGraph<T extends EffectParamOwner>(effect: T): T {
  const { [EFFECT_GRAPH_PARAM]: _stored, ...params } = effect.params;
  void _stored;
  return { ...effect, params, operatorGraph: undefined };
}

/**
 * Applies a preset in one undo step, as if the user set each control in the card. A control with
 * keyframes or a node driving it keeps its animation; the result names it, so nothing changes silently.
 * A control the instance's stored graph lacks is named too; when the effect's current graph has all of
 * them the result is `upgradable`, and `currentGraph: true` first swaps in that graph (same undo step).
 */
export function applyEffectPreset(clipId: string, effectId: string, presetId: string, options: { currentGraph?: boolean } = {}): EffectPresetResult {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId), stored = clip?.effects.find(candidate => candidate.id === effectId);
  if (!clip || !stored || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const preset = effectPresets(stored.type).find(candidate => candidate.id === presetId);
  if (!preset) throw new Error(`${presetId} is not a preset of ${stored.type}.`);
  const replace = !!options.currentGraph && hasEditedGraph(stored);
  const effect = replace ? onCurrentGraph(stored) : stored;
  const definitions = getEffect(effect.type)?.params ?? {};
  const result: EffectPresetResult = { preset, changed: [], kept: [], graphEdited: hasEditedGraph(effect), ...replace ? { graphReplaced: true } : {} };
  const numbers: Array<[string, number]> = [], others: Record<string, Primitive> = {};
  const resolved = resolvedPresetValues(effect, effectPresets(effect.type))[effectPresets(effect.type).indexOf(preset)];
  // A card control only a graph reads (graphOnly) that this instance's stored graph does not read (a
  // Weave whose Reveal node was unbound, a glyph look saved before its Background): setting it would
  // change nothing, so the result names it.
  const bound = graphBoundParameters(effect);
  for (const [key, value] of Object.entries(resolved)) {
    const unread = definitions[key]?.graphOnly && bound && !bound.has(key);
    if (unread) {
      if (key in preset.params) result.kept.push({ key, label: definitions[key].label, reason: 'missing' });
      continue;
    }
    const property = `effect.${effect.id}.${key}` as AnimatableProperty, label = presetControlLabel(effect, key);
    if (label === undefined) {
      // A graph value this preset leaves out (reset for order independence) that an edited graph dropped: nothing to set.
      if (key in preset.params) result.kept.push({ key, label: defaultGraphValues(effect.type).find(value => value.key === key)?.label ?? key, reason: 'missing' });
      continue;
    }
    if (typeof value === 'number' && state.hasKeyframes(clip.id, property)) { result.kept.push({ key, label, reason: 'keyframes' }); continue; }
    if (typeof value === 'number' && isParameterNodeDriven(clip, property)) { result.kept.push({ key, label, reason: 'node' }); continue; }
    if (Object.is(currentValue(effect, key, definitions[key]), value)) continue;
    if (typeof value === 'number') numbers.push([key, value]); else others[key] = value;
    result.changed.push(key);
  }
  const missing = result.kept.filter(item => item.reason === 'missing').map(item => item.key);
  if (missing.length && result.graphEdited) {
    // The current graph judged with the preset's values in place (a Weave's Form decides what it reads).
    const current = onCurrentGraph(effect), currentBound = graphBoundParameters({ ...current, params: { ...current.params, ...preset.params } });
    result.upgradable = missing.every(key => definitions[key] ? currentBound?.has(key) ?? true
      : defaultGraphValues(effect.type).some(value => value.key === key));
  }
  if (!result.changed.length && !replace) return result;
  const batch = startBatch(`Apply preset ${preset.name}`);
  // In a project repository session the edits must run inside the batch's gesture to form one undo step.
  const repository = getEditorRepositorySession() !== null && batch.batchId !== null;
  // A number the card would simply store joins one effect update: one write per control made a store
  // update, a repository transaction and a graph compile each (Analog Signal Lab: 0.5 s of frozen
  // playback per preset). Numbers the card records as keys or writes through a constant-mode source
  // still take its own path.
  const ownPath = numbers.filter(([key]) => {
    const property = `effect.${effect.id}.${key}` as AnimatableProperty;
    return state.isRecording(clip.id, property) || clip.nodeGraph?.parameterSources?.targets[property]?.localMode === 'constant';
  });
  const patch = { ...Object.fromEntries(numbers.filter(entry => !ownPath.includes(entry))), ...others };
  const apply = () => {
    if (replace) state.updateClip(clip.id, { effects: clip.effects.map(candidate => candidate.id === effectId ? { ...candidate, ...effect } : candidate) });
    for (const [key, value] of ownPath) state.setPropertyValue(clip.id, `effect.${effect.id}.${key}` as AnimatableProperty, value);
    if (Object.keys(patch).length) state.updateClipEffect(clip.id, effect.id, patch);
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
