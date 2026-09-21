import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import { defaultCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { createDefaultVoxelGraph } from '../../src/services/operators/voxelGraph';
import {
  effectOperatorGraph,
  effectOperatorCompileParams,
  migratePersistedEffectOperatorGraph,
  addableEffectOperators,
} from '../../src/services/operators/effectGraphOwner';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { compileCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { voxelOperatorGraph } from '../../src/services/operators/voxelGraph';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';

const effect = (type: Effect['type'], params: Effect['params'] = {}): Effect => ({
  id: `effect-${type}`,
  name: type,
  type,
  enabled: true,
  params,
});

describe('effect-owned operator graph persistence', () => {
  it.each([
    ['face-cables', defaultCableOperatorGraph()],
    ['voxel-relief', createDefaultVoxelGraph()],
  ] as const)('migrates the %s legacy JSON field without changing graph IDs', (type, graph) => {
    const legacy = effect(type, { operatorGraph: JSON.stringify(graph), stableParam: 42 });
    const migrated = migratePersistedEffectOperatorGraph(legacy);

    expect(migrated.operatorGraph).toMatchObject({ ...graph, schemaVersion: 1 });
    expect(migrated.params).toEqual({ stableParam: 42 });
    expect(migrated.operatorGraph?.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect(migrated.operatorGraph?.nodes.map(node => node.bindings)).toEqual(graph.nodes.map(node => node.bindings));
    expect(migrated.operatorGraph?.nodes.every(node => node.operatorVersion === 1)).toBe(true);
  });

  it('round-trips only the canonical field and remains idempotent after JSON storage', () => {
    const graph = defaultCableOperatorGraph();
    graph.layout.wind = { x: 1234, y: 5678 };
    graph.groups![0].label = 'Saved layout group';
    const migrated = migratePersistedEffectOperatorGraph(effect('face-cables', {
      operatorGraph: JSON.stringify(graph),
      globalWindStrength: 7,
    }));
    const stored = JSON.parse(JSON.stringify(migrated)) as Effect;
    const restored = migratePersistedEffectOperatorGraph(stored);

    expect(restored).toEqual(migrated);
    expect(restored.params.operatorGraph).toBeUndefined();
    expect(effectOperatorGraph(restored)).toEqual(restored.operatorGraph);
  });

  it('prefers and validates canonical data while removing a stale legacy copy', () => {
    const canonical = defaultCableOperatorGraph();
    canonical.layout.wind = { x: 99, y: 101 };
    const stale = defaultCableOperatorGraph();
    stale.layout.wind = { x: -1, y: -1 };
    const migrated = migratePersistedEffectOperatorGraph({
      ...effect('face-cables', { operatorGraph: JSON.stringify(stale) }),
      operatorGraph: canonical,
    });

    expect(migrated.operatorGraph).toMatchObject({ ...canonical, schemaVersion: 1 });
    expect(migrated.params.operatorGraph).toBeUndefined();
  });

  it('never replaces malformed or unsupported saved graphs with defaults', () => {
    expect(() => migratePersistedEffectOperatorGraph(effect('face-cables', { operatorGraph: '{' })))
      .toThrow('Invalid saved operator graph');
    expect(() => migratePersistedEffectOperatorGraph({
      ...effect('face-cables'),
      operatorGraph: { ...defaultCableOperatorGraph(), schemaVersion: 2 as 1 },
    })).toThrow('Invalid operator graph');
    expect(() => migratePersistedEffectOperatorGraph({
      ...effect('face-cables'),
      operatorGraph: {
        ...defaultCableOperatorGraph(),
        nodes: defaultCableOperatorGraph().nodes.map((node, index) => index === 0
          ? { ...node, operatorVersion: 2 as 1 }
          : node),
      },
    })).toThrow('Invalid node');
  });

  it('provides the legacy-compatible invert default but preserves an edited canonical image graph', () => {
    const legacy = effect('invert');
    expect(effectOperatorGraph(legacy)).toMatchObject(createDefaultInvertImageGraph());

    const graph = createDefaultInvertImageGraph();
    graph.layout.invert = { x: 777, y: 12 };
    const restored = migratePersistedEffectOperatorGraph({ ...legacy, operatorGraph: graph });
    expect(effectOperatorGraph(restored)).toMatchObject(graph);
  });

  it('bridges canonical cable and voxel graphs into params-only runtime compilers', () => {
    const cable = defaultCableOperatorGraph();
    cable.layout.wind = { x: 321, y: 654 };
    const cableEffect = { ...effect('face-cables'), operatorGraph: cable };
    expect(compileCableOperatorGraph(effectOperatorCompileParams(cableEffect)).graph.layout.wind).toEqual({ x: 321, y: 654 });

    const voxel = createDefaultVoxelGraph();
    voxel.layout.render = { x: 987, y: 123 };
    const voxelEffect = { ...effect('voxel-relief'), operatorGraph: voxel };
    expect(voxelOperatorGraph(effectOperatorCompileParams(voxelEffect)).layout.render).toEqual({ x: 987, y: 123 });
  });

  it('does not silently default malformed or incomplete invert graphs', () => {
    expect(() => effectOperatorGraph(effect('invert', { operatorGraph: '{' }))).toThrow('Invalid saved operator graph');
    const incomplete = createDefaultInvertImageGraph();
    incomplete.edges = incomplete.edges.filter(edge => edge.id !== 'invert-combine');
    incomplete.incomplete = 'Reconnect RGB output.';
    expect(effectOperatorGraph({ ...effect('invert'), operatorGraph: incomplete })).toMatchObject(incomplete);
    const addable = addableEffectOperators('invert').map(operator => operator.id);
    expect(addable).toEqual(expect.arrayContaining([
      'image.frame', 'values.number', 'vector.split.vec2', 'vector.split.vec3', 'vector.split.vec4',
      'vector.combine.vec2', 'vector.combine.vec3', 'vector.combine.vec4', 'convert.image-to-vec4',
      'convert.vec4-to-image', 'math.subtract.scalar',
    ]));
    expect(addable).not.toEqual(expect.arrayContaining(['image.rgb-split', 'image.rgb-combine', 'color.invert.rgb']));
  });

  it('migrates short-lived image operator IDs before validation and persists only canonical operators', () => {
    const legacy = {
      version: 1 as const,
      schemaVersion: 1 as const,
      domain: 'image' as const,
      nodes: [
        { id: 'frame', operator: 'image.frame', operatorVersion: 1 as const, bindings: {} },
        { id: 'split', operator: 'image.rgb-split', operatorVersion: 1 as const, bindings: {} },
        { id: 'invert', operator: 'color.invert.rgb', operatorVersion: 1 as const, bindings: {} },
        { id: 'combine', operator: 'image.rgb-combine', operatorVersion: 1 as const, bindings: {} },
        { id: 'output', operator: 'image.output', operatorVersion: 1 as const, bindings: {} },
      ],
      edges: [
        { id: 'frame-split', from: 'frame', output: 'image', to: 'split', input: 'image' },
        { id: 'split-invert', from: 'split', output: 'rgb', to: 'invert', input: 'rgb' },
        { id: 'invert-combine', from: 'invert', output: 'rgb', to: 'combine', input: 'rgb' },
        { id: 'alpha-combine', from: 'split', output: 'alpha', to: 'combine', input: 'alpha' },
        { id: 'combine-output', from: 'combine', output: 'image', to: 'output', input: 'image' },
      ],
      layout: { frame: { x: 0, y: 0 }, split: { x: 200, y: 0 }, invert: { x: 400, y: 0 }, combine: { x: 600, y: 0 }, output: { x: 800, y: 0 } },
    };
    const runtime = effectOperatorGraph({ ...effect('invert'), operatorGraph: legacy });
    expect(runtime.nodes.map(node => node.operator)).not.toEqual(expect.arrayContaining([
      'image.rgb-split', 'image.rgb-combine', 'color.invert.rgb',
    ]));
    expect(runtime.nodes.find(node => node.id === 'frame')?.operator).toBe('image.frame');
    expect(runtime.nodes.find(node => node.id === 'split')?.operator).toBe('vector.split.rgba');
    expect(runtime.nodes.find(node => node.id === 'combine')?.operator).toBe('vector.combine.rgba');
    expect(runtime.nodes.find(node => node.id === 'invert')?.operator).toBe('math.subtract.rgb');
    expect(runtime.nodes.find(node => node.id === 'invert-one')).toMatchObject({ operator: 'values.number', constants: { value: 1 } });
    expect(runtime.nodes.find(node => node.id === 'invert-ones')?.operator).toBe('convert.scalar-to-rgb');
    expect(runtime.layout.frame).toEqual(legacy.layout.frame);
    expect(runtime.layout.output).toEqual(legacy.layout.output);
    const persisted = migratePersistedEffectOperatorGraph({ ...effect('invert'), operatorGraph: legacy });
    expect(persisted.operatorGraph).toEqual(runtime);
    expect(persisted.params.operatorGraph).toBeUndefined();
  });

  it('preserves variant-mismatched wiring only as an explicitly incomplete repair state', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.find(node => node.id === 'split')!.operator = 'vector.split.vec2';
    expect(validateEffectGraph(graph, true)).toEqual([]);
    expect(validateEffectGraph(graph)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Invalid connection:/),
    ]));
    graph.incomplete = 'Reconnect ports after changing the vector variant.';
    expect(effectOperatorGraph({ ...effect('invert'), operatorGraph: graph }).incomplete).toBe(graph.incomplete);

    const missingNode = structuredClone(graph);
    missingNode.nodes = missingNode.nodes.filter(node => node.id !== 'rgba');
    expect(validateEffectGraph(missingNode, true)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Invalid connection:/),
    ]));
  });
});
