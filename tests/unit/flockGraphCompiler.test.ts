import { describe, expect, it } from 'vitest';
import type { FlockDefinition } from '../../src/types/flock';
import { FLOCK_PRESETS, createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { validateFlockDefinition } from '../../src/services/flock/graph/flockGraphValidation';
import { expandFlockGroups } from '../../src/services/flock/graph/flockGroupExpansion';
import {
  addFlockNode,
  connectFlockPorts,
  createFlockGroupFromNodes,
  disconnectFlockEdge,
  duplicateFlockNodes,
  exposeFlockParam,
  moveFlockNode,
  remapFlockDefinitionIds,
  removeFlockNodes,
  setFlockNodeBypass,
  setFlockNodeParam,
} from '../../src/services/flock/mutations/flockGraphMutations';
import { listFlockOperators, toSignalOperatorDescriptor } from '../../src/services/flock/operators/flockOperatorRegistry';
import { isSignalOperatorDescriptor } from '../../src/signals/guards';

function nodeByOperator(definition: FlockDefinition, operator: string) {
  const node = definition.nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node;
}

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`mutation failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('flock presets', () => {
  it.each(FLOCK_PRESETS.map((preset) => [preset.id]))('%s compiles without errors', (presetId) => {
    const result = compileFlockDefinition(createFlockPresetDefinition(presetId));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.program?.capacity).toBeGreaterThan(0);
    expect(result.program?.branches.length).toBeGreaterThan(0);
  });

  it('exposes the default clip controls', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    expect(definition.exposed.map((exposed) => exposed.param)).toEqual(
      expect.arrayContaining(['count', 'cohesion', 'separation', 'alignment', 'maxSpeed', 'strength', 'size', 'color']),
    );
  });
});

describe('flock graph validation', () => {
  it('rejects connections between mismatched port types', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const emitter = nodeByOperator(definition, 'flock.emitter');
    const simulation = nodeByOperator(definition, 'flock.simulation');
    const result = connectFlockPorts(definition, { nodeId: emitter.id, port: 'spawn' }, { nodeId: simulation.id, port: 'behavior' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('type-mismatch');
  });

  it('rejects cycles between value nodes', () => {
    let definition = createFlockPresetDefinition('free-swarm');
    const a = expectOk(addFlockNode(definition, 'flock.math'));
    definition = a.definition;
    const b = expectOk(addFlockNode(definition, 'flock.math'));
    definition = expectOk(connectFlockPorts(b.definition, { nodeId: a.nodeId, port: 'value' }, { nodeId: b.nodeId, port: 'a' })).definition;
    const cycle = connectFlockPorts(definition, { nodeId: b.nodeId, port: 'value' }, { nodeId: a.nodeId, port: 'b' });
    expect(cycle.ok).toBe(false);
    expect(!cycle.ok && cycle.code).toBe('cycle');
  });

  it('keeps an invalid draft inspectable with node-scoped diagnostics', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const spawnEdge = definition.edges.find((edge) => edge.to.port === 'spawn')!;
    const draft = expectOk(disconnectFlockEdge(definition, spawnEdge.id)).definition;
    const result = compileFlockDefinition(draft);
    expect(result.ok).toBe(false);
    const missing = result.diagnostics.find((diagnostic) => diagnostic.code === 'missing-required-input');
    expect(missing?.nodeIds).toEqual([nodeByOperator(draft, 'flock.simulation').id]);
  });

  it('rejects unsupported operator versions and invalid params', () => {
    const definition = structuredClone(createFlockPresetDefinition('free-swarm'));
    nodeByOperator(definition, 'flock.rules').operatorVersion = 99;
    nodeByOperator(definition, 'flock.emitter').params.count = -5;
    const codes = validateFlockDefinition(definition).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('unsupported-operator-version');
    expect(codes).toContain('invalid-param');
    const mutation = setFlockNodeParam(createFlockPresetDefinition('free-swarm'), nodeByOperator(definition, 'flock.emitter').id, 'count', -5);
    expect(mutation.ok).toBe(false);
  });

  it('retains unknown operators as errors instead of dropping them', () => {
    const definition = structuredClone(createFlockPresetDefinition('free-swarm'));
    definition.nodes.push({ id: 'fn-future', operator: 'flock.future-thing', operatorVersion: 1, params: { secret: 3 } });
    const result = compileFlockDefinition(definition);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'unknown-operator')).toBe(true);
    expect(definition.nodes.find((node) => node.id === 'fn-future')?.params.secret).toBe(3);
  });

  it('replaces an occupied single input and keeps repeated inputs ordered', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const simulation = nodeByOperator(definition, 'flock.simulation');
    const extra = expectOk(addFlockNode(definition, 'flock.boundary'));
    const replaced = expectOk(connectFlockPorts(extra.definition, { nodeId: extra.nodeId, port: 'boundary' }, { nodeId: simulation.id, port: 'boundary' }));
    expect(replaced.replacedEdgeId).toBeDefined();
    expect(replaced.definition.edges.filter((edge) => edge.to.nodeId === simulation.id && edge.to.port === 'boundary')).toHaveLength(1);

    const compose = nodeByOperator(definition, 'flock.compose');
    const drag = expectOk(addFlockNode(replaced.definition, 'flock.drag'));
    const connected = expectOk(connectFlockPorts(drag.definition, { nodeId: drag.nodeId, port: 'behavior' }, { nodeId: compose.id, port: 'behavior' }));
    const program = compileFlockDefinition(connected.definition).program!;
    expect(program.ops.map((op) => op.kind)).toEqual(['rules', 'turbulence', 'drag']);
  });

  it('rejects recursive groups', () => {
    const definition = structuredClone(createFlockPresetDefinition('free-swarm'));
    definition.groups.push({
      id: 'fg-loop',
      label: 'Loop',
      version: 1,
      nodes: [{ id: 'inner', operator: 'flock.group', operatorVersion: 1, params: {}, groupRef: 'fg-loop' }],
      edges: [],
      inputs: [],
      outputs: [],
      layout: {},
    });
    definition.nodes.push({ id: 'fn-loop', operator: 'flock.group', operatorVersion: 1, params: {}, groupRef: 'fg-loop' });
    expect(expandFlockGroups(definition).diagnostics.map((diagnostic) => diagnostic.code)).toContain('group-recursion');
  });
});

describe('flock compiler semantics', () => {
  it('classifies changes by invalidation hash; layout never invalidates', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const base = compileFlockDefinition(definition).program!;
    const points = nodeByOperator(definition, 'flock.render-points');
    const rules = nodeByOperator(definition, 'flock.rules');
    const emitter = nodeByOperator(definition, 'flock.emitter');

    const moved = compileFlockDefinition(expectOk(moveFlockNode(definition, rules.id, { x: 999, y: 3 })).definition).program!;
    expect(moved.hashes).toEqual(base.hashes);

    const appearance = compileFlockDefinition(expectOk(setFlockNodeParam(definition, points.id, 'size', 9)).definition).program!;
    expect(appearance.hashes.behavior).toBe(base.hashes.behavior);
    expect(appearance.hashes.appearance).not.toBe(base.hashes.appearance);

    const behavior = compileFlockDefinition(expectOk(setFlockNodeParam(definition, rules.id, 'cohesion', 3)).definition).program!;
    expect(behavior.hashes.topology).toBe(base.hashes.topology);
    expect(behavior.hashes.behavior).not.toBe(base.hashes.behavior);

    const topology = compileFlockDefinition(expectOk(setFlockNodeParam(definition, emitter.id, 'count', 10)).definition).program!;
    expect(topology.hashes.topology).not.toBe(base.hashes.topology);
    expect(topology.capacity).toBe(10);
  });

  it('applies mute and passthrough bypass semantics', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const muted = compileFlockDefinition(expectOk(setFlockNodeBypass(definition, turbulence.id, true)).definition).program!;
    expect(muted.ops.map((op) => op.kind)).toEqual(['rules']);
    expect(setFlockNodeBypass(definition, nodeByOperator(definition, 'flock.compose').id, true).ok).toBe(false);
  });

  it('drives a parameter from a connected value node', () => {
    const definition = createFlockPresetDefinition('vortex');
    const vortex = nodeByOperator(definition, 'flock.vortex');
    const oscillator = expectOk(addFlockNode(definition, 'flock.oscillator'));
    const connected = expectOk(connectFlockPorts(oscillator.definition, { nodeId: oscillator.nodeId, port: 'value' }, { nodeId: vortex.id, port: 'strength' }));
    const program = compileFlockDefinition(connected.definition).program!;
    const op = program.ops.find((candidate) => candidate.kind === 'vortex')!;
    expect(op.params.numbers.strength.valueIndex).toBe(0);
    expect(program.values[0].kind).toBe('oscillator');
  });

  it('expands groups with per-instance overrides keyed on the group node', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = nodeByOperator(definition, 'flock.turbulence');
    const grouped = expectOk(createFlockGroupFromNodes(definition, [turbulence.id], 'Swirl'));
    expect(compileFlockDefinition(grouped.definition).ok).toBe(true);
    const overridden = expectOk(setFlockNodeParam(grouped.definition, grouped.groupNodeId, `${turbulence.id}__strength`, 5));
    const program = compileFlockDefinition(overridden.definition).program!;
    const op = program.ops.find((candidate) => candidate.kind === 'turbulence')!;
    expect(op.params.numbers.strength.base).toBe(5);
    expect(op.params.numbers.strength.property).toBe(`flock.node.${grouped.groupNodeId}.${turbulence.id}__strength`);
    expect(op.sourceNodeId).toBe(grouped.groupNodeId);
  });

  it('removes exposed controls with their node and remaps ids for independent copies', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const rules = nodeByOperator(definition, 'flock.rules');
    const removed = expectOk(removeFlockNodes(definition, [rules.id]));
    expect(removed.definition.exposed.some((exposed) => exposed.nodeId === rules.id)).toBe(false);
    expect(removed.removedExposedIds.length).toBe(3);

    const { definition: copy, nodeIdMap } = remapFlockDefinitionIds(definition);
    expect(Object.keys(nodeIdMap)).toHaveLength(definition.nodes.length);
    expect(copy.nodes.map((node) => node.id)).not.toContain(rules.id);
    expect(compileFlockDefinition(copy).ok).toBe(true);
    expect(copy.exposed.every((exposed) => copy.nodes.some((node) => node.id === exposed.nodeId))).toBe(true);
  });

  it('duplicates nodes with internal edges and exposes once', () => {
    const definition = createFlockPresetDefinition('follow-path');
    const path = nodeByOperator(definition, 'flock.path');
    const follow = nodeByOperator(definition, 'flock.follow-path');
    const duplicated = expectOk(duplicateFlockNodes(definition, [path.id, follow.id]));
    expect(duplicated.definition.nodes.length).toBe(definition.nodes.length + 2);
    expect(duplicated.definition.edges.some((edge) => edge.from.nodeId === duplicated.idMap[path.id] && edge.to.nodeId === duplicated.idMap[follow.id])).toBe(true);
    const first = expectOk(exposeFlockParam(definition, path.id, 'radius'));
    const second = expectOk(exposeFlockParam(first.definition, path.id, 'radius'));
    expect(second.exposedId).toBe(first.exposedId);
  });

  it('describes every operator as a valid Signal operator', () => {
    for (const operator of listFlockOperators()) {
      expect(isSignalOperatorDescriptor(toSignalOperatorDescriptor(operator))).toBe(true);
    }
  });
});
