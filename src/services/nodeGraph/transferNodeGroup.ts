import type { NodeGraph } from '../../types/nodeGraph';
import type { Effect } from '../../types/effects';
import type { OperatorValue } from '../../types/operatorGraph';
import type { AnimatableProperty } from '../../types/animationProperties';
import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { renderHostPort } from '../render/renderHostPort';
import { effectOperatorGraph, effectOperatorParams, addableEffectOperators, validateEffectOwnerGraph } from '../operators/effectGraphOwner';
import { sceneGraphForClip, compileSceneGraph, sceneGraphSupportsSource } from '../operators/sceneGraph';
import { SCENE_OPERATORS } from '../operators/sceneOperators';
import { transferOperators, type OperatorTransferOwner } from '../operators/transferOperators';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';
import { prepareEditableOperatorGraph } from '../operators/editableOperatorGraph';
import { effectGraphId } from './effectGraphProjection';
import { createClipNodeGraphState } from './clipGraphProjectionState';

/** Changes executable ownership, never just the color of a frame. */
export function transferNodeGroup(clipId: string, view: NodeGraph, nodeIds: string[], targetGroupId: string): Record<string, string> {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(candidate => candidate.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const targetGroup = view.groups?.find(group => group.id === targetGroupId);
  if (!targetGroup) throw new Error('Drop onto an expanded effect or scene group.');
  const rootOf = (id: string): string => {
    const group = view.groups?.find(candidate => candidate.id === id);
    return group?.parentId ? rootOf(group.parentId) : id;
  };
  const visible = nodeIds.map(id => view.nodes.find(node => node.id === id));
  if (visible.some(node => !node || !['effect-operator', 'scene-operator'].includes(node.binding?.kind ?? ''))) {
    throw new Error('These nodes use a different runtime. Only compatible executable effect and scene nodes can change effect groups.');
  }
  const sourceOwners = new Set(visible.map(node => node?.binding?.kind === 'effect-operator' ? `effect:${node.binding.effectId}` : 'scene3d'));
  if (sourceOwners.size !== 1) throw new Error('Move nodes from one source effect at a time.');
  const sourceId = [...sourceOwners][0], targetId = rootOf(targetGroupId);
  const ids = visible.map(node => (node!.binding as { nodeId: string }).nodeId);
  const targetInnerGroup = targetGroupId === targetId ? undefined : targetGroupId.slice(targetId.length + 1);
  const owner = (id: string): OperatorTransferOwner & { effect?: Effect } => {
    if (id === 'scene3d') {
      if (!sceneGraphSupportsSource(clip.source?.type, clip.effects.some(effect => effect.enabled && effect.type === 'face-cables' && !!effect.params.scene3D),
        clip.effects.some(effect => effect.enabled && effect.type === 'voxel-relief'))) throw new Error('This scene uses its source-specific renderer.');
      const definition = sceneGraphForClip(clip);
      return { ...definition, accepts: operator => SCENE_OPERATORS.some(spec => spec.id === operator), removable: () => true };
    }
    const effect = clip.effects.find(candidate => `effect:${candidate.id}` === id);
    if (!effect) throw new Error('The target is not a compatible executable effect.');
    const graph = effectOperatorGraph(effect);
    const sourceType = clip.effects.find(candidate => `effect:${candidate.id}` === sourceId)?.type;
    return { effect, graph, params: effectOperatorParams(effect),
      accepts: operator => sourceType === effect.type || graph.nodes.some(node => node.operator === operator)
        || addableEffectOperators(effect.type).some(spec => spec.id === operator), removable: () => true };
  };
  const source = owner(sourceId), target = sourceId === targetId ? source : owner(targetId);
  let from = structuredClone(source.graph), to = from, params = target.params;
  let idMap = Object.fromEntries(ids.map(id => [id, id])), parameterMap: Record<string, string> = {};
  if (sourceId === targetId) {
    if (targetInnerGroup && !to.groups?.some(group => group.id === targetInnerGroup)) throw new Error('The target group is unavailable.');
    to.groups?.forEach(group => { group.nodeIds = group.nodeIds.filter(id => !ids.includes(id)); });
    to.groups?.find(group => group.id === targetInnerGroup)?.nodeIds.push(...ids);
  } else {
    const transferred = transferOperators(source, target, ids, targetInnerGroup);
    ({ from, to, params, idMap, parameterMap } = transferred);
  }
  const validate = (context: typeof source, graph: typeof from, values: typeof params) => {
    prepareEditableOperatorGraph(graph, () => {
      if (context.effect) validateEffectOwnerGraph(context.effect, graph, values);
      else compileSceneGraph({ graph, params: values as Record<string, OperatorValue> });
    });
  };
  validate(source, from, sourceId === targetId ? params : source.params); validate(target, to, params);
  const propertyMap = new Map<string, AnimatableProperty>();
  if (sourceId !== targetId && source.effect) for (const [key, next] of Object.entries(parameterMap)) {
    const property = `effect.${source.effect.id}.${key}`;
    const animated = (state.clipKeyframes.get(clipId) ?? []).some(frame => frame.property === property)
      || clip.nodeGraph?.keyframeNodes?.some(node => node.channels.some(channel => channel.property === property || channel.targets.some(binding => binding.property === property)));
    if (animated && !target.effect) throw new Error('Animated effect parameters need an effect target that supports their keyframes.');
    if (target.effect) {
      const shared = from.nodes.some(node => JSON.stringify(node.bindings).includes(JSON.stringify(key)));
      if (animated && shared) throw new Error('This animated parameter is shared with another source node. Separate the binding before transferring it.');
      propertyMap.set(property, `effect.${target.effect.id}.${next}` as AnimatableProperty);
    }
  }
  const model = structuredClone(clip.nodeGraph ?? createClipNodeGraphState(clip));
  if (!source.effect) model.scene = { graph: from, params: source.params as Record<string, OperatorValue> };
  if (!target.effect) model.scene = { graph: to, params: params as Record<string, OperatorValue> };
  if (propertyMap.size) for (const node of model.keyframeNodes ?? []) for (const channel of node.channels) {
    channel.property = propertyMap.get(channel.property) ?? channel.property;
    channel.targets = channel.targets.map(binding => ({ ...binding, property: propertyMap.get(binding.property) ?? binding.property }));
  }
  const effects = clip.effects.map(effect => {
    if (effect.id === target.effect?.id) {
      const nextParams = { ...params } as Effect['params']; delete nextParams[EFFECT_GRAPH_PARAM];
      return { ...effect, params: nextParams, operatorGraph: to };
    }
    if (effect.id === source.effect?.id) {
      const nextParams = { ...effect.params }; delete nextParams[EFFECT_GRAPH_PARAM];
      return { ...effect, params: nextParams, operatorGraph: from };
    }
    return effect;
  });
  const targetNode = view.nodes.find(node => node.binding?.kind === 'effect-operator' ? `effect:${node.binding.effectId}` === targetId
    : node.binding?.kind === 'scene-operator' && targetId === 'scene3d');
  const prefix = targetNode ? targetNode.id.slice(0, targetNode.id.lastIndexOf('/') + 1)
    : `${target.effect ? effectGraphId(clipId, target.effect.id) : `${view.id}:scene3d`}/`;
  const result = Object.fromEntries(visible.map(node => [node!.id, `${prefix}${idMap[(node!.binding as { nodeId: string }).nodeId]}`]));
  const batch = startBatch('Transfer nodes between groups');
  try {
    state.updateClip(clipId, { effects, nodeGraph: model });
    for (const frame of state.clipKeyframes.get(clipId) ?? []) {
      const property = propertyMap.get(frame.property); if (property) state.updateKeyframe(frame.id, { property });
    }
    state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
  return result;
}
