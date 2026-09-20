import { describe, expect, it } from 'vitest';
import { defaultCableOperatorGraph, compileCableOperatorGraph, cableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { landmarksToMesh } from '../../src/services/operators/geometry/mesh';
import { depthToMesh } from '../../src/services/operators/geometry/depthMesh';
import { mergeSurfaceMeshes } from '../../src/services/operators/geometry/mergeSurfaceMeshes';
import { meshCollision } from '../../src/services/operators/geometry/meshCollision';
import { listNodeCatalog } from '../../src/services/operators/operatorCatalog';
import { EFFECT_OPERATORS } from '../../src/services/operators/operatorRegistry';
import { listFlockOperators } from '../../src/services/flock/operators/flockOperatorRegistry';

describe('general surface operators', () => {
  it('upgrades the previous 12-node graph without changing its original document or saved artifacts', () => {
    const old = defaultCableOperatorGraph();
    const remove = new Set(['face-mesh', 'calibration', 'depth-mesh', 'smoothing']);
    old.nodes = old.nodes.filter(n => !remove.has(n.id));
    old.edges = old.edges.filter(e => !remove.has(e.from) && !remove.has(e.to) && e.to !== 'surface');
    delete old.domain; delete old.groups;
    old.nodes.find(n => n.id === 'surface')!.operator = 'surface.hybrid';
    old.nodes.find(n => n.id === 'face-contact')!.operator = 'collision.face';
    old.nodes.find(n => n.id === 'depth-contact')!.operator = 'collision.surface';
    for (const e of old.edges) {
      if (e.from === 'surface') e.output = 'surface';
      if (e.to === 'depth-contact') e.input = 'surface';
    }
    old.edges.push(...[
      ['tracking', 'landmarks', 'anchors', 'landmarks'], ['tracking', 'landmarks', 'surface', 'landmarks'],
      ['tracking', 'landmarks', 'face-contact', 'landmarks'], ['depth', 'depth', 'surface', 'depth'],
    ].map(([from, output, to, input]) => ({ id: `${from}-${to}`, from, output, to, input })));
    const serialized = JSON.stringify(old), params = { operatorGraph: serialized, sceneData: 'portable-artifact', sceneDepth: true, sceneDepthStrength: 1.4 };
    const plan = compileCableOperatorGraph(params);
    expect(validateEffectGraph(plan.graph)).toEqual([]);
    expect(plan.graph.nodes).toHaveLength(16);
    expect(plan.params).toMatchObject({ sceneData: 'portable-artifact', sceneDepth: true, sceneDepthStrength: 1.4, trackingSmoothing: 0 });
    expect(JSON.stringify(old)).toBe(serialized);
    expect(cableOperatorGraph({ operatorGraph: JSON.stringify(plan.graph) })).toEqual(plan.graph);
  });

  it('controls calibration and surface branches through connections rather than labels', () => {
    const graph = defaultCableOperatorGraph();
    graph.edges = graph.edges.filter(e => !(e.to === 'calibration' && e.input === 'reference') && !(e.to === 'surface' && e.input === 'primary'));
    const plan = compileCableOperatorGraph({ operatorGraph: JSON.stringify(graph), sceneDepth: true, surfaceBlendWidth: 0.1, surfaceSubdivisions: 2 });
    expect(plan.params).toMatchObject({ depthReferenceFace: false, sceneDepth: true });
    expect(plan.surfacePlan).toEqual({ face: false, blendWidth: 0.1, subdivisions: 2 });
    graph.edges = graph.edges.filter(e => e.to !== 'depth-mesh');
    expect(compileCableOperatorGraph({ operatorGraph: JSON.stringify(graph), sceneDepth: true }).params.sceneDepth).toBe(false);
  });

  it('reuses triangulation, depth reconstruction, merging and collision with an arbitrary triangle', () => {
    const primary = landmarksToMesh([{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.5, y: 0.7 }],
      [[-0.4, 0.4, 0.2], [0.4, 0.4, 0.2], [0, -0.4, 0.2]], [0, 1, 2], [0, 1, 2]);
    const depth = depthToMesh(new Float32Array(9).fill(-0.4), { width: 3, height: 3 }, [[-1, 1, 0], [1, 1, 0], [1, -1, 0], [-1, -1, 0]], [0, 0, 0], 1);
    expect(depth.indices).toHaveLength(24);
    const coarse = mergeSurfaceMeshes(primary, depth, 0.05, 0), fine = mergeSurfaceMeshes(primary, depth, 0.1, 3);
    expect(fine.indices.length).toBeGreaterThan(coarse.indices.length);
    expect(fine.vertices.slice(0, 3)).toEqual(primary.vertices);
    expect(fine.exterior.vertices[4].position).toEqual(primary.vertices[0].position);
    const area = fine.indices.reduce((sum, _, i) => {
      if (i % 3) return sum;
      const [a, b, c] = fine.indices.slice(i, i + 3).map(j => fine.vertices[j].uv);
      return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }, 0);
    expect(area).toBeCloseTo(1, 6);
    const contact = meshCollision(primary.vertices.map(v => ({ x: v.position[0], y: v.position[1], z: v.position[2] })), [[0, 1, 2]]);
    const point = { x: 0, y: 0, z: -1 }, previous = { ...point };
    contact(point, previous, 0.01); expect(point.z).toBeCloseTo(0.21); expect(previous.z).toBe(point.z);
  });

  it('derives its inventory from registries and identifies shared implementations', () => {
    const catalog = listNodeCatalog(), ids = catalog.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of EFFECT_OPERATORS.filter(o => !['surface.hybrid', 'collision.face', 'collision.surface'].includes(o.id))) expect(ids).toContain(o.id);
    for (const o of listFlockOperators()) expect(ids).toContain(o.id);
    expect(catalog.find(e => e.id === 'geometry.face')?.inputs[0].type).toBe('landmarks');
    expect(catalog.find(e => e.id === 'geometry.merge-surface')?.outputs[0].type).toBe('geometry');
    expect(catalog.some(e => e.sharedOperator === 'forces.wind')).toBe(true);
    expect(ids).toContain('effect:brightness');
  });
});
