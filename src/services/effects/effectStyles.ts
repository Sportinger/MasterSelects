import { getEffect } from '../../effects';
import { EFFECT_GROUPS, effectEngine, effectEngineMembers, effectGroup } from '../../effects/effectCatalogGroups';
import type { Effect } from '../../types/effects';
import type { EffectParam } from '../../effects/types';
import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';
import { createEffectProperty } from '../../types/animationProperties';
import { startBatch, endBatch } from '../../stores/historyStore';
import { isParameterNodeDriven } from '../parameterSources/parameterSourceTargets';

const paramsOf = (type: string): Record<string, EffectParam> => getEffect(type)?.params ?? {};
const nameOf = (type: string) => getEffect(type)?.name ?? type;
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

export interface EffectStyleOption { value: string; label: string }
export interface EffectStyleGroup { label: string; options: EffectStyleOption[] }

/**
 * Other looks of the same engine, as Style menu groups: the effect's own picker group first, then
 * the other groups in picker order, each alphabetical. A parameter two looks both have must be of
 * the same kind; what carries over on a switch is decided by changeEffectStyle.
 */
export function effectStyleGroups(type: string): EffectStyleGroup[] {
  const engine = effectEngine(type);
  const own = paramsOf(type);
  if (!engine || !getEffect(type)) return [];
  const members = effectEngineMembers(engine).filter((member) => {
    const other = getEffect(member)?.params;
    return !!other && Object.entries(own).every(([key, param]) => !other[key] || other[key].type === param.type);
  });
  const ownGroup = effectGroup(type).id;
  const order = [ownGroup, ...EFFECT_GROUPS.map(group => group.id).filter(id => id !== ownGroup), 'other'];
  return order.map(groupId => ({
    label: groupId === 'other' ? 'Other' : EFFECT_GROUPS.find(group => group.id === groupId)?.label ?? groupId,
    options: members.filter(member => effectGroup(member).id === groupId).map(member => ({ value: member, label: nameOf(member) })).toSorted(byLabel),
  })).filter(group => group.options.length > 0);
}

/** The Style menu entries in menu order (see effectStyleGroups). */
export function effectStyleOptions(type: string): EffectStyleOption[] {
  return effectStyleGroups(type).flatMap(group => group.options);
}

/**
 * A parameter another look of the same engine has but this look does not: a value kept from an
 * earlier style for a switch back. Its keyframe lane is hidden while this look is active.
 */
export function isOtherStyleParam(type: string | undefined, key: string): boolean {
  const engine = type ? effectEngine(type) : undefined;
  if (!engine || !getEffect(type!) || paramsOf(type!)[key]) return false;
  return effectEngineMembers(engine).some(member => !!paramsOf(member)[key]);
}

/** Drops the keyframe lanes of controls kept from another style (isOtherStyleParam) from a lane set. */
export function hideOtherStyleLanes(properties: Set<string>, effects: ReadonlyArray<{ id: string; type?: string }> | undefined): void {
  for (const property of properties) {
    const [prefix, effectId, key, ...rest] = property.split('.');
    if (prefix !== 'effect' || !key || rest.length) continue;
    const effect = effects?.find(candidate => candidate.id === effectId);
    if (effect && isOtherStyleParam(effect.type, key)) properties.delete(property);
  }
}

const formatValue = (value: unknown) => typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
const clampTo = (param: EffectParam, value: number) => Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, value));
const listText = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const sameValue = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 : a === b;

/**
 * Whether a stored value of `key` means the same in the new look (EffectParam.styleRole). A value the
 * old look does not have was kept from an earlier look, which the effect does not record: it carries
 * only when every look of the engine that has the key gives it the new look's role.
 */
function carriesStyleValue(engineType: string, key: string, old: EffectParam | undefined, param: EffectParam): boolean {
  if (old) return old.styleRole === param.styleRole;
  const engine = effectEngine(engineType);
  return !!engine && effectEngineMembers(engine).every(member => !paramsOf(member)[key] || paramsOf(member)[key].styleRole === param.styleRole);
}

/**
 * Replaces the look in place: same effect ID, stack position and one undo step. A control both looks
 * have in the same role (EffectParam.styleRole; Halftone's Ink is Riso's Dark Ink) keeps a value the
 * user set and its keyframes, brought into the new look's range; one still at the old look's default,
 * without keyframes or a node driving it, takes the new look's default, so an untouched control opens
 * like the new look. A control in another role (Halftone's Scale is a cell size, CRT Screen's Mask
 * Density a stripe width) starts at the new look's default, and its old keyframes are removed (Undo
 * brings both back). Controls only the new look has start at their defaults, a choice the new look
 * does not offer falls back to its default, and controls only the old look has keep their value and
 * keyframes for a switch back. A node source on a control stays and keeps driving it; the row says
 * so. Returns one short sentence per change the user cannot see in the card.
 */
export function changeEffectStyle(clipId: string, effectId: string, type: string): string[] {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId), effect = clip?.effects.find(candidate => candidate.id === effectId);
  if (!clip || !effect || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  if (effect.type === type) return [];
  if (!effectStyleOptions(effect.type).some(option => option.value === type)) throw new Error(`${type} is not a style of ${effect.type}.`);
  const oldParams = paramsOf(effect.type), newParams = paramsOf(type), newName = nameOf(type);
  const keyframes = state.clipKeyframes.get(clipId) ?? [];
  const keyed = (key: string) => keyframes.filter(keyframe => keyframe.property === createEffectProperty(effectId, key));
  const driven = (key: string) => isParameterNodeDriven(clip, createEffectProperty(effectId, key));
  const notes: string[] = [], renamed: Array<{ from: string; to: string }> = [], drivenLabels: string[] = [];
  const clampKeys: Array<{ id: string; value: number }> = [], removeKeys: string[] = [];
  // A customized node graph belongs to the previous look; the new style starts from its own default graph.
  const params = Object.fromEntries(Object.entries(effect.params).filter(([key]) => key !== EFFECT_GRAPH_PARAM));
  for (const [key, param] of Object.entries(newParams)) {
    const stored = params[key], old = oldParams[key];
    if (driven(key)) drivenLabels.push(param.label);
    if (stored !== undefined && !carriesStyleValue(effect.type, key, old, param)) {
      params[key] = param.default;
      if (old) renamed.push({ from: old.label, to: param.label });
      removeKeys.push(...keyed(key).map(keyframe => keyframe.id));
      continue;
    }
    const offered = param.type !== 'select' || param.options?.some(option => option.value === stored);
    if (stored === undefined || !offered) { params[key] = param.default; continue; }
    // Untouched: the old look's default, not keyed and not driven, opens at the new look's default.
    if (old && sameValue(stored, old.default) && !keyed(key).length && !driven(key)) { params[key] = param.default; continue; }
    if (param.type !== 'number') continue;
    if (typeof stored === 'number' && clampTo(param, stored) !== stored) {
      params[key] = clampTo(param, stored);
      notes.push(`${param.label} ${formatValue(stored)} → ${formatValue(params[key])} (${newName} range).`);
    }
    const outside = keyed(key).filter(keyframe => clampTo(param, keyframe.value) !== keyframe.value);
    if (outside.length) {
      clampKeys.push(...outside.map(keyframe => ({ id: keyframe.id, value: clampTo(param, keyframe.value) })));
      notes.push(`${param.label} keyframes brought into ${formatValue(param.min ?? -Infinity)}–${formatValue(param.max ?? Infinity)}.`);
    }
  }
  if (renamed.length) {
    const one = renamed.length === 1, from = listText(renamed.map(entry => entry.from));
    const removed = removeKeys.length ? ` and ${one ? 'its' : 'their'} keyframes` : '';
    notes.unshift(`${newName} has no ${from}: ${listText(renamed.map(entry => entry.to))} ${one ? 'starts at its default' : 'start at their defaults'} (Undo brings back ${from}${removed}).`);
  }
  if (drivenLabels.length) notes.push(`${listText(drivenLabels)} ${drivenLabels.length === 1 ? 'stays driven by its node' : 'stay driven by their nodes'}.`);
  const kept = Object.entries(oldParams).filter(([key]) => !newParams[key] && keyed(key).length > 0).map(([, param]) => param.label);
  if (kept.length) notes.push(`${listText(kept)} ${kept.length === 1 ? 'keeps its' : 'keep their'} keyframes for a switch back; ${newName} has no ${listText(kept)}.`);
  const next: Effect = { ...effect, type: type as Effect['type'], params, operatorGraph: undefined,
    name: effect.name === effect.type || effect.name === getEffect(effect.type)?.name ? type : effect.name };
  const batch = startBatch('Change effect style');
  try {
    state.updateClip(clip.id, { effects: clip.effects.map(candidate => candidate.id === effectId ? next : candidate) });
    const store = useTimelineStore.getState();
    for (const { id, value } of clampKeys) store.updateKeyframe(id, { value });
    for (const id of removeKeys) store.removeKeyframe(id);
  } finally { if (batch.opened) endBatch(); }
  return notes;
}
