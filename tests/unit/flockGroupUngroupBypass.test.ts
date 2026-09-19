import { describe, expect, it } from 'vitest';
import type { FlockDefinition } from '../../src/types/flock';
import { createFlockProperty } from '../../src/types/flock';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import {
  createFlockGroupFromNodes,
  exposeFlockParam,
  setFlockNodeBypass,
  setFlockNodeParam,
  ungroupFlockNode,
} from '../../src/services/flock/mutations/flockGraphMutations';
import { createTestTimelineStore } from '../helpers/storeFactory';

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`mutation failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function nodeByOperator(definition: FlockDefinition, operator: string) {
  const node = definition.nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node;
}

describe('flock ungroup', () => {
  it('round-trips group -> ungroup to the same program structure with fresh ids', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const baseline = compileFlockDefinition(definition).program!;
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const rules = nodeByOperator(definition, 'flock.rules');
    const grouped = expectOk(createFlockGroupFromNodes(definition, [turbulence.id, rules.id], 'Behaviors'));
    const ungrouped = expectOk(ungroupFlockNode(grouped.definition, grouped.groupNodeId));
    const program = compileFlockDefinition(ungrouped.definition).program!;

    expect(program.hashes.topology).toBe(baseline.hashes.topology);
    expect(program.ops.map((op) => op.kind)).toEqual(baseline.ops.map((op) => op.kind));
    expect(program.ops.map((op) => op.params.numbers.strength?.base ?? op.params.numbers.cohesion?.base))
      .toEqual(baseline.ops.map((op) => op.params.numbers.strength?.base ?? op.params.numbers.cohesion?.base));
    expect(ungrouped.definition.groups).toHaveLength(0);
    expect(ungrouped.definition.nodes.some((node) => node.id === grouped.groupNodeId)).toBe(false);
    expect(Object.keys(ungrouped.nodeIdMap).toSorted()).toEqual([rules.id, turbulence.id].toSorted());
    expect(Object.values(ungrouped.nodeIdMap)).not.toContain(turbulence.id);
  });

  it('moves instance overrides and promoted controls back onto the inner nodes', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const exposedTurbulence = definition.exposed.find((exposed) => exposed.nodeId === turbulence.id && exposed.param === 'strength');
    expect(exposedTurbulence).toBeDefined();
    const grouped = expectOk(createFlockGroupFromNodes(definition, [turbulence.id], 'Swirl'));
    const overridden = expectOk(setFlockNodeParam(grouped.definition, grouped.groupNodeId, `${turbulence.id}__strength`, 7));
    const ungrouped = expectOk(ungroupFlockNode(overridden.definition, grouped.groupNodeId));
    const innerId = ungrouped.nodeIdMap[turbulence.id];
    expect(ungrouped.definition.nodes.find((node) => node.id === innerId)?.params.strength).toBe(7);
    const exposed = ungrouped.definition.exposed.find((entry) => entry.id === exposedTurbulence!.id);
    expect(exposed).toMatchObject({ nodeId: innerId, param: 'strength' });
  });

  it('rejects ungrouping a non-group node', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    expect(ungroupFlockNode(definition, nodeByOperator(definition, 'flock.rules').id).ok).toBe(false);
  });

  it('rewrites group override keyframes to the inlined nodes in the store', () => {
    const store = createTestTimelineStore();
    const clipId = store.getState().addFlockClip('video-1', 0, { presetId: 'free-swarm' })!;
    const definition = store.getState().clips.find((clip) => clip.id === clipId)!.flock!;
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const property = createFlockProperty(turbulence.id, 'strength');
    store.setState({
      clipKeyframes: new Map([[clipId, [{ id: 'k1', clipId, time: 1, property, value: 3, easing: 'linear' }]]]),
    });
    const groupNodeId = store.getState().groupFlockGraphNodes(clipId, [turbulence.id], 'Swirl')!;
    expect(store.getState().clipKeyframes.get(clipId)?.[0].property).toBe(createFlockProperty(groupNodeId, `${turbulence.id}__strength`));
    const idMap = store.getState().ungroupFlockGraphNode(clipId, groupNodeId)!;
    expect(store.getState().clipKeyframes.get(clipId)?.[0].property).toBe(createFlockProperty(idMap[turbulence.id], 'strength'));
  });
});

describe('flock group bypass', () => {
  it('mutes every output of a bypassed group instance', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const grouped = expectOk(createFlockGroupFromNodes(definition, [turbulence.id], 'Swirl'));
    expect(compileFlockDefinition(grouped.definition).program!.ops.map((op) => op.kind)).toEqual(['rules', 'turbulence']);
    const bypassed = expectOk(setFlockNodeBypass(grouped.definition, grouped.groupNodeId, true));
    const result = compileFlockDefinition(bypassed.definition);
    expect(result.ok).toBe(true);
    expect(result.program!.ops.map((op) => op.kind)).toEqual(['rules']);
    const enabled = expectOk(setFlockNodeBypass(bypassed.definition, grouped.groupNodeId, false));
    expect(compileFlockDefinition(enabled.definition).program!.ops.map((op) => op.kind)).toEqual(['rules', 'turbulence']);
  });

  it('keeps exposing controls independent from bypass', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const grouped = expectOk(createFlockGroupFromNodes(definition, [turbulence.id], 'Swirl'));
    const bypassed = expectOk(setFlockNodeBypass(grouped.definition, grouped.groupNodeId, true));
    expect(exposeFlockParam(bypassed.definition, grouped.groupNodeId, `${turbulence.id}__strength`).ok).toBe(true);
  });
});
