import { splatEffectScene } from '../../src/engine/scene/splatEffectScene';
import type { Effect } from '../../src/types/effects';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { primitiveSplatGraph } from '../../src/services/operators/splatGraphDefaults';
import { composeSplatGraph } from '../../src/services/operators/splatGraphComposition';
import { SPLAT_COMPOSITIONS } from '../../src/services/operators/splatCompositions';
import { describe, expect, it } from 'vitest';
import { compileSplatGraph, defaultSplatGraph } from '../../src/services/operators/splatGraph';
import { validateSceneGraph, sceneGraphSupportsSource } from '../../src/services/operators/sceneGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { expandSceneOperatorGraph } from '../../src/engine/scene/sceneGraphRuntime';
import type { SceneSplatLayer } from '../../src/engine/scene/types';
import { reconstructSplatMesh } from '../../src/engine/gaussian/graph/splatMesh';
import { packSplatOperations, prepareSplatSampling } from '../../src/engine/gaussian/graph/SplatGraphCompute';

describe('splat graph execution', () => {
  it('compiles a reusable sphere crop and restores the source stream when bypassed', () => {
    const d = defaultSplatGraph();
    const crop = { id: 'crop', operator: 'splat.sphere-crop', bindings: {}, constants: { x: 1, y: -2, z: 3, radius: 4, softness: 0.5 }, bypassed: false };
    d.graph.nodes.push(crop);
    d.graph.edges.find(e => e.to === 'surface')!.from = 'crop';
    d.graph.edges.push({ id: 'source-crop', from: 'source', output: 'splats', to: 'crop', input: 'splats' });
    expect(validateSceneGraph(d)).toEqual([]);
    const operations = compileSplatGraph(d)[0].operations;
    expect(operations).toEqual([{ kind: 'sphere-crop', values: [1, -2, 3, 4, 0.5] }]);
    expect(Array.from(packSplatOperations(operations).slice(0, 9))).toEqual([9, 0, 0, 0, 1, -2, 3, 4, 0.5]);
    crop.bypassed = true;
    expect(compileSplatGraph(d)[0].operations).toEqual([]);
    expect(d.graph.nodes.some(node => node.id === 'source')).toBe(true);
  });
  it('opens splats in the executable scene graph without changing legacy sources', () => {
    expect(sceneGraphSupportsSource('gaussian-splat')).toBe(true);
    expect(sceneGraphSupportsSource('flock')).toBe(false);
    const d = defaultSplatGraph(); expect(validateSceneGraph(d)).toEqual([]);
    expect(compileSplatGraph(d)).toEqual([{ id: 'surface-0', operations: [], applyClipTransform: true, budget: 0 }]);
  });
  it('round trips four independent branches and preserves the shared transform', () => {
    const d = JSON.parse(JSON.stringify(defaultSplatGraph(true)));
    expect(validateSceneGraph(d)).toEqual([]);
    const branches = compileSplatGraph(d); expect(branches).toHaveLength(4);
    expect(branches.map(b => b.operations.map(o => o.kind))).toEqual([
      ['limit', 'camera-fade'], ['limit', 'select', 'scale', 'noise', 'color'], ['select', 'limit', 'particles', 'camera-fade'], [],
    ]);
    expect(branches[3].mesh).toMatchObject({ resolution: 32 });
    expect(branches.every(b => b.applyClipTransform)).toBe(true);
    const worldMatrix = new Float32Array(16);
    const layer = { kind: 'splat', worldMatrix, clipId: 'splat', gaussianSplatRuntimeKey: 'asset' } as SceneSplatLayer;
    const expanded = expandSceneOperatorGraph(layer, d) as SceneSplatLayer[];
    expect(expanded).toHaveLength(4);
    expect(expanded.every(l => l.worldMatrix === worldMatrix && l.gaussianSplatRuntimeKey === 'asset')).toBe(true);
    expect(layer.splatGraphBranch).toBeUndefined();
  });
  it('mutes only the disconnected or bypassed branch and passes bypassed attributes through', () => {
    const d = defaultSplatGraph(true);
    d.graph.nodes.find(n => n.id === 'motion')!.bypassed = true;
    d.graph.nodes.find(n => n.id === 'mesh')!.bypassed = true;
    expect(compileSplatGraph(d)).toHaveLength(3);
    expect(compileSplatGraph(d)[1].operations.some(o => o.kind === 'noise')).toBe(false);
    d.graph.edges = d.graph.edges.filter(e => e.to !== 'simulation');
    expect(compileSplatGraph(d)).toHaveLength(2);
  });
  it('rejects incompatible geometry, invalid limits and animated reconstruction', () => {
    const d = defaultSplatGraph(true);
    d.graph.nodes.push({ id: 'plane', operator: 'geometry.plane', bindings: {} });
    expect(() => connectEffectGraph(d.graph, { id: 'bad', from: 'plane', output: 'geometry', to: 'limit', input: 'splats' })).toThrow();
    d.params.limit_min = 1; expect(() => compileSplatGraph(d)).toThrow('Minimum'); d.params.limit_min = 0.001;
    d.graph.edges.find(e => e.to === 'reconstruct')!.from = 'motion';
    expect(() => compileSplatGraph(d)).toThrow('other attribute modifiers');
  });
  it('passes crop settings through to mesh reconstruction and removes bypassed masks', () => {
    const d = defaultSplatGraph(true);
    const crop = { id: 'crop', operator: 'splat.sphere-crop', bindings: {}, constants: { x: 1, y: 2, z: 3, radius: 4, softness: 0.2 }, bypassed: false };
    d.graph.nodes.push(crop);
    d.graph.edges.find(e => e.to === 'reconstruct' && e.input === 'splats')!.from = 'crop';
    d.graph.edges.push({ id: 'crop-source', from: 'source', output: 'splats', to: 'crop', input: 'splats' });
    expect(validateSceneGraph(d)).toEqual([]);
    expect(compileSplatGraph(d).find(b => b.mesh)?.mesh?.crops).toEqual([{ center: [1, 2, 3], radius: 4, softness: 0.2 }]);
    crop.constants.radius = 2;
    expect(compileSplatGraph(d).find(b => b.mesh)?.mesh?.crops?.[0].radius).toBe(2);
    crop.bypassed = true;
    expect(compileSplatGraph(d).find(b => b.mesh)?.mesh?.crops).toBeUndefined();
  });
  it('packs simulation and noise parameters without overlapping neighboring operations', () => {
    const ops = compileSplatGraph(defaultSplatGraph(true))[2].operations;
    const packed = packSplatOperations(ops);
    expect(packed[24]).toBe(7); expect(packed[28]).toBe(2); expect(packed[34]).toBe(42);
    expect(packed[36]).toBe(8); expect(packed[41]).toBeCloseTo(0.5);
  });
  it('evaluates connected forces and removes their contribution when disconnected or bypassed', () => {
    const d = defaultSplatGraph(true);
    d.params.turbulence_strength = 0.7; d.params.gravity_strength = 2;
    const simulation = () => compileSplatGraph(d)[2].operations.find(o => o.kind === 'particles')!.values;
    expect(simulation()).toEqual([2, 0.5, 0.1, 0.7, 2, 0.4, 42, -2]);
    d.graph.nodes.find(n => n.id === 'turbulence')!.bypassed = true;
    d.graph.edges = d.graph.edges.filter(e => e.to !== 'simulation' || e.input !== 'dragField');
    expect(simulation()).toEqual([2, 0.5, 0.1, 0, 2, 0, 42, -2]);
  });
  it('drives particle force controls with the shared scalar nodes', () => {
    const d = defaultSplatGraph(true);
    d.graph.nodes.push({ id: 'value', operator: 'values.number', bindings: {}, constants: { value: 0.75 } });
    d.graph.edges.push({ id: 'force-value', from: 'value', output: 'value', to: 'turbulence', input: 'strength' });
    expect(compileSplatGraph(d)[2].operations.find(o => o.kind === 'particles')!.values[3]).toBe(0.75);
  });
  it('reduces actual GPU output counts before evaluating particle paths', () => {
    const branches = compileSplatGraph(defaultSplatGraph(true));
    const sourceCount = 3807536;
    expect(prepareSplatSampling(branches[0].operations, sourceCount, branches[0].budget).count).toBe(sourceCount);
    const particles = prepareSplatSampling(branches[2].operations, sourceCount, branches[2].budget);
    expect(particles.count).toBe(8192); expect(particles.remapped).toBe(true);
    expect(particles.operations.some(o => o.kind === 'select')).toBe(false);
    expect(prepareSplatSampling([{ kind: 'select', values: [0, 42] }], sourceCount).count).toBe(0);
  });
});

describe('splat density mesh', () => {
  const options = { resolution: 20, threshold: 0.35, radius: 1.5 };
  const source = () => {
    const data = new Float32Array(8 * 14);
    for (let i = 0; i < 8; i++) data.set([3 + (i & 1) * 0.2, 7 + ((i >> 1) & 1) * 0.2, -5 + ((i >> 2) & 1) * 0.2, 0.01, 0.01, 0.01, 1, 0, 0, 0, 0.3, 0.6, 0.9, 1], i * 14);
    return data;
  };
  it('reconstructs only retained centers, weights soft edges and never changes the source', () => {
    const data = source(), before = data.slice();
    const cropped = { center: [3, 7, -5] as [number, number, number], radius: 0.1, softness: 0 };
    const retained = data.slice(0, 14);
    expect(reconstructSplatMesh(data, 8, { ...options, crops: [cropped] }))
      .toEqual(reconstructSplatMesh(retained, 1, options));
    const soft = { ...cropped, center: [3.05, 7, -5] as [number, number, number], softness: 0.1 };
    retained[13] = 0.5;
    const softMesh = reconstructSplatMesh(data, 8, { ...options, threshold: 0.1, crops: [soft] });
    const expected = reconstructSplatMesh(retained, 1, { ...options, threshold: 0.1 });
    expect(softMesh.indices).toEqual(expected.indices);
    expect(softMesh.vertices.length).toBeGreaterThan(0);
    softMesh.vertices.forEach((v, i) => expect(v).toBeCloseTo(expected.vertices[i], 5));
    expect(reconstructSplatMesh(data, 8, { ...options, crops: [cropped, { ...cropped, center: [0, 0, 0] }] }).indices.length).toBe(0);
    expect(data).toEqual(before);
  });
  it('creates finite indexed edges in source coordinates and preserves source data', () => {
    const data = source(), copy = data.slice(), mesh = reconstructSplatMesh(data, 8, options);
    expect(mesh.indices.length).toBeGreaterThan(0); expect(mesh.indices.length % 2).toBe(0);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vertices.length / 6);
    for (let i = 0; i < mesh.vertices.length; i += 6) {
      expect(mesh.vertices[i]).toBeGreaterThan(2.8); expect(mesh.vertices[i]).toBeLessThan(3.4);
      expect(mesh.vertices[i + 1]).toBeGreaterThan(6.8); expect(mesh.vertices[i + 2]).toBeLessThan(-4.6);
      expect(mesh.vertices[i + 3]).toBeCloseTo(0.3);
    }
    expect(data).toEqual(copy); expect(reconstructSplatMesh(data, 8, options)).toEqual(mesh);
  });
  it('handles empty and transparent sources, and responds to the density threshold', () => {
    expect(reconstructSplatMesh(new Float32Array(), 0, options).indices.length).toBe(0);
    const data = source(); for (let i = 13; i < data.length; i += 14) data[i] = 0;
    expect(reconstructSplatMesh(data, 8, options).indices.length).toBe(0);
    expect(reconstructSplatMesh(source(), 8, { ...options, threshold: 4 }).indices.length).toBe(0);
    expect(() => reconstructSplatMesh(source(), 8, { ...options, radius: NaN })).toThrow();
  });
});

describe('reusable splat compositions', () => {
  it('stores four shared definitions and preserves execution and bound controls after reopening', () => {
    const original = primitiveSplatGraph(true), composed = defaultSplatGraph(true);
    const packed = packOperatorCompositions(composed.graph);
    expect(packed.nodes.filter(n => SPLAT_COMPOSITIONS.some(d => d.id === n.operator))).toHaveLength(4);
    expect(validateSceneGraph({ ...composed, graph: packed })).toEqual([]);
    expect(compileSplatGraph({ ...composed, graph: packed })).toEqual(compileSplatGraph(original));
    composed.params.simulation_speed = 0.9;
    expect(compileSplatGraph({ ...composed, graph: packed })[2].operations.find(o => o.kind === 'particles')!.values[2]).toBe(0.9);
  });
  it('keeps two particle instances independent and detaches only the edited interior', () => {
    const composed = defaultSplatGraph(true), packed = packOperatorCompositions(composed.graph);
    packed.nodes.push({ id: 'second-particles', operator: 'splat.particle-system', operatorVersion: 1, bindings: {} });
    const expanded = expandOperatorCompositions(packed);
    expanded.nodes.find(n => n.id === 'second-particles--simulation')!.constants!.speed = 3;
    const saved = packOperatorCompositions(expanded);
    expect(saved.nodes.some(n => n.id === 'splat-module-2' && n.operator === 'splat.particle-system')).toBe(true);
    expect(saved.nodes.find(n => n.id === 'second-particles--simulation')!.constants!.speed).toBe(3);
    expect(compileSplatGraph({ ...composed, graph: saved })[2].operations.find(o => o.kind === 'particles')!.values[2]).toBe(0.1);
  });
  it('does not replace edited constants while organizing a legacy flat graph', () => {
    const legacy = primitiveSplatGraph(true);
    legacy.graph.nodes.find(n => n.id === 'simulation')!.constants = { speed: 5 };
    expect(composeSplatGraph(legacy)).toBe(legacy);
  });
});

describe('splat preview work budgets', () => {
  it('remaps a reduced render budget across the entire scan, even without attribute operations', () => {
    const sample = prepareSplatSampling([], 3807536, 500000);
    expect(sample).toMatchObject({ count: 500000, remapped: true, offset: 0, operations: [] });
    expect(prepareSplatSampling([], 3807536, 0)).toMatchObject({ count: 3807536, remapped: false });
    expect(prepareSplatSampling([], 100, 500000)).toMatchObject({ count: 100, remapped: false });
  });
  it('reuses unchanged scene plans but invalidates edited and animated parameters', () => {
    const defaults = defaultSplatGraph(true);
    const effect = { id: 'test', type: 'splat-exploration', enabled: true, params: defaults.params, operatorGraph: defaults.graph } as Effect;
    const first = splatEffectScene([effect]);
    expect(splatEffectScene([{ ...effect, params: { ...effect.params } }])).toBe(first);
    expect(splatEffectScene([{ ...effect, params: { ...effect.params, simulation_speed: 2 } }])).not.toBe(first);
    expect(splatEffectScene([{ ...effect, operatorGraph: structuredClone(defaults.graph) }])).not.toBe(first);
  });
});
