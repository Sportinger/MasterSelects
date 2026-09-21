import { describe, expect, it } from 'vitest';
import { transferOperators } from '../../src/services/operators/transferOperators';
import { defaultCableOperatorGraph, compileCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { defaultSceneGraph } from '../../src/services/operators/sceneGraph';
import { evaluateGraphForces, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { canRemoveEffectOperator, addableEffectOperators, effectOperatorCompileParams, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createMockClip, createMockTrack, createMockKeyframe } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphDocument';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { transferNodeGroup } from '../../src/services/nodeGraph/transferNodeGroup';
import { useTimelineStore } from '../../src/stores/timeline';
import { operatorGraphPauseReason } from '../../src/services/operators/editableOperatorGraph';
import { createEffectGraphActions } from '../../src/services/operators/effectGraphEditing';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const canonical = (graph: EffectOperatorGraph): EffectOperatorGraph => ({
  ...graph, schemaVersion: 1, nodes: graph.nodes.map(node => ({ ...node, operatorVersion: 1 })),
});

const makeOwner = (gravity = false) => {
  const graph = defaultCableOperatorGraph();
  if (gravity) {
    graph.nodes.push({ id: 'gravity', operator: 'forces.gravity', bindings: { strength: 'gravityStrength' } });
    graph.layout.gravity = { x: 1800, y: 750 };
    graph.groups!.find(group => group.id === 'simulation')!.nodeIds.push('gravity');
    graph.edges.push({ id: 'gravity-simulation', from: 'gravity', output: 'force', to: 'simulation', input: 'forces' });
  }
  return { graph, params: { gravityStrength: 7 },
    accepts: (operator: string) => graph.nodes.some(node => node.operator === operator) || addableEffectOperators('face-cables').some(spec => spec.id === operator),
    removable: (node: { id: string; operator: string }) => canRemoveEffectOperator('face-cables', node.id, node.operator) };
};

describe('executable operator transfers', () => {
  it('removes a force from its old simulation and executes it in the target simulation', () => {
    const source = makeOwner(true), target = makeOwner(), before = JSON.stringify([source, target]);
    const moved = transferOperators(source, target, ['gravity'], 'simulation');
    expect(evaluateGraphForces(moved.from, 'simulation', source.params, '', [], 0).force).toEqual([0, 0, 0]);
    expect(evaluateGraphForces(moved.to, 'simulation', moved.params, '', [], 0).force).toEqual([0, -7, 0]);
    expect(moved.to.groups!.find(group => group.id === 'simulation')!.nodeIds).toContain(moved.idMap.gravity);
    expect(validateEffectGraph(moved.from)).toEqual([]); expect(validateEffectGraph(moved.to)).toEqual([]);
    expect(JSON.stringify([source, target])).toBe(before);
  });

  it('remaps colliding ids without overwriting target nodes or parameters', () => {
    const moved = transferOperators(makeOwner(true), makeOwner(true), ['gravity']);
    expect(moved.idMap.gravity).not.toBe('gravity');
    expect(moved.to.nodes.filter(node => node.operator === 'forces.gravity')).toHaveLength(2);
    expect(evaluateGraphForces(moved.to, 'simulation', moved.params, '', [], 0).force).toEqual([0, -14, 0]);
  });

  it('rejects runtime mismatches without changing either graph', () => {
    const source = makeOwner(true), target = makeOwner(), before = JSON.stringify([source, target]);
    expect(() => transferOperators(source, { ...target, accepts: () => false }, ['gravity'])).toThrow('cannot run');
    expect(JSON.stringify([source, target])).toBe(before);
  });

  it('moves a node without replacing an occupied single input', () => {
    const definition = defaultSceneGraph(), owner = { ...definition, accepts: () => true, removable: () => true };
    const before = JSON.stringify(definition);
    const moved = transferOperators(owner, owner, ['material']);
    expect(moved.to.edges).toContainEqual(expect.objectContaining({ from: 'material', to: 'mesh', input: 'material' }));
    expect(moved.to.nodes.some(node => node.id === moved.idMap.material)).toBe(true);
    expect(moved.to.edges.some(edge => edge.from === moved.idMap.material && edge.to === 'mesh')).toBe(false);
    expect(JSON.stringify(definition)).toBe(before);
  });

  it('retains a transferred UV transform for wiring without changing an occupied target chain', () => {
    const source = defaultSceneGraph(), target = defaultSceneGraph();
    source.params.uv_scaleU = 2;
    const moved = transferOperators({ ...source, accepts: () => true, removable: () => true },
      { ...target, accepts: () => true, removable: () => true }, ['uv']);
    const inserted = moved.idMap.uv;
    expect(moved.to.nodes.some(node => node.id === inserted)).toBe(true);
    expect(moved.to.edges).toContainEqual(expect.objectContaining({ from: 'uv', output: 'uv', to: 'texture', input: 'uv' }));
    expect(moved.params[moved.parameterMap.uv_scaleU]).toBe(2);
    expect(validateEffectGraph(moved.to)).toEqual([]);
  });

  it('commits real effect ownership and moves animated parameter paths together', () => {
    const source = makeOwner(true), target = makeOwner();
    const clip = createMockClip({ id: 'transfer-fixture', source: { type: 'video' }, effects: [
      { id: 'from', name: 'From', type: 'face-cables', enabled: true, params: source.params, operatorGraph: canonical(source.graph) },
      { id: 'to', name: 'To', type: 'face-cables', enabled: true, params: {}, operatorGraph: canonical(target.graph) },
    ] });
    const key = createMockKeyframe({ clipId: clip.id, property: 'effect.from.gravityStrength', time: 0, value: 9 });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, [key]]]) });
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true);
    const node = graph.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'from' && node.binding.nodeId === 'gravity')!;
    const renamed = transferNodeGroup(clip.id, graph, [node.id], 'effect:to/simulation');
    const current = useTimelineStore.getState().clips[0];
    const from = current.effects[0].operatorGraph!, to = current.effects[1].operatorGraph!;
    expect(current.effects.every(effect => effect.params.operatorGraph === undefined)).toBe(true);
    expect(from.nodes.some((candidate: { id: string }) => candidate.id === 'gravity')).toBe(false);
    expect(renamed[node.id]).toContain(':effect:to/');
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)![0].property).toMatch(/^effect\.to\./);
    expect(evaluateGraphForces(to, 'simulation', current.effects[1].params, 'to', useTimelineStore.getState().clipKeyframes.get(clip.id)!, 0).force).toEqual([0, -9, 0]);
    useTimelineStore.setState({ clips: [], clipKeyframes: new Map() });
  });

  it('keeps a transferred core node, pauses its incomplete source, and resumes after repair', () => {
    const source = makeOwner(true), target = makeOwner();
    const clip = createMockClip({ id: 'core-transfer', source: { type: 'video' }, effects: [
      { id: 'from', name: 'From', type: 'face-cables', enabled: true, params: source.params, operatorGraph: canonical(source.graph) },
      { id: 'to', name: 'To', type: 'face-cables', enabled: true, params: {}, operatorGraph: canonical(target.graph) },
    ] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map() });
    const view = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true);
    const node = view.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'from' && node.binding.nodeId === 'simulation')!;
    const renamed = transferNodeGroup(clip.id, view, [node.id], 'effect:to');
    let current = useTimelineStore.getState().clips[0];
    expect(current.effects.every(effect => effect.params.operatorGraph === undefined)).toBe(true);
    expect(effectOperatorGraph(current.effects[0]).nodes.some(node => node.operator === 'simulation.rope')).toBe(false);
    expect(effectOperatorGraph(current.effects[1]).nodes.filter(node => node.operator === 'simulation.rope')).toHaveLength(2);
    expect(operatorGraphPauseReason(current.effects[0])).toContain('Curves');
    expect(current.effects[0].enabled).toBe(true);
    expect(useTimelineStore.getState().getInterpolatedEffects(clip.id, 0)[0].enabled).toBe(false);
    expect(evaluateCompositionClipEffects(current.effects, [], 0)[0].enabled).toBe(false);
    expect(() => compileCableOperatorGraph(effectOperatorCompileParams(current.effects[0]))).toThrow('Curves');
    const projected = buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current, [current], [], undefined, true);
    expect(projected.groups!.find(group => group.id === 'effect:from')!.issue).toContain('Curves');
    expect(projected.nodes.some(candidate => candidate.id === renamed[node.id])).toBe(true);
    transferNodeGroup(clip.id, projected, [renamed[node.id]], 'effect:from');
    current = useTimelineStore.getState().clips[0];
    expect(operatorGraphPauseReason(current.effects[0])).toBeUndefined();
    expect(evaluateCompositionClipEffects(current.effects, [], 0)[0].enabled).toBe(true);
    const graph = effectOperatorGraph(current.effects[0]), curve = graph.edges.find(edge => edge.to === 'render' && edge.input === 'curves')!;
    createEffectGraphActions(clip.id, 'from').disconnectEdge(curve.id);
    expect(operatorGraphPauseReason(useTimelineStore.getState().clips[0].effects[0])).toBeTruthy();
    createEffectGraphActions(clip.id, 'from').connectPorts({ fromNodeId: curve.from, fromPortId: curve.output, toNodeId: curve.to, toPortId: curve.input });
    expect(operatorGraphPauseReason(useTimelineStore.getState().clips[0].effects[0])).toBeUndefined();
    useTimelineStore.setState({ clips: [], clipKeyframes: new Map() });
  });

  it('keeps empty effects visible and accepts nodes into them', () => {
    const source = makeOwner(), empty = { ...source.graph, nodes: [], edges: [], groups: [], layout: {}, incomplete: 'The graph needs one clip output.' };
    const clip = createMockClip({ id: 'empty-transfer', source: { type: 'video' }, effects: [
      { id: 'from', name: 'From', type: 'face-cables', enabled: true, params: {}, operatorGraph: canonical(source.graph) },
      { id: 'to', name: 'To', type: 'face-cables', enabled: true, params: {}, operatorGraph: canonical(empty) },
    ] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map() });
    const view = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true);
    const ids = view.nodes.filter(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'from').map(node => node.id);
    transferNodeGroup(clip.id, view, ids, 'effect:to');
    const current = useTimelineStore.getState().clips[0], after = buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current, [current], [], undefined, true);
    expect(after.groups!.find(group => group.id === 'effect:from')!.nodeIds).toHaveLength(1);
    expect(after.nodes.filter(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'to')).toHaveLength(ids.length);
    expect(operatorGraphPauseReason(current.effects[0])).toBeTruthy();
    expect(operatorGraphPauseReason(current.effects[1])).toBeUndefined();
    useTimelineStore.setState({ clips: [], clipKeyframes: new Map() });
  });
});
