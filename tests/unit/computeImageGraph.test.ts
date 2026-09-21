import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph, compileComputeImagePreview } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';

describe('compute image graph compiler', () => {
  it('compiles reachable stages and the shared resolve with typed field provenance', () => {
    const plan = compileComputeImageGraph(createDefaultVoronoiGraph());
    expect(plan.passthrough).toBe(false);
    expect(plan.stages).toEqual([
      { nodeId: 'seeds', kind: 'seed', params: { scale: 24, speed: .5 } },
      { nodeId: 'jump-flood', kind: 'jump-flood', input: 'seeds', params: {} },
    ]);
    expect(plan.output).toBe('combined');
    expect(plan.imageProgram?.fieldResources).toEqual([{
      resourceId: 'voronoi-field:jump-flood', producerNodeId: 'jump-flood', outputPort: 'field', format: 'nearest-seed-rgba16float',
    }]);
    expect(plan.imageProgram?.resourceInputs).toContain('voronoi-field:jump-flood');
    expect(plan.imageProgram?.resourceSampling).toContain('exact-pixel-load');
    expect(plan.imageProgram?.instructions.filter(item => item.operation === 'field-load-nearest-seed')).toHaveLength(3);
    expect(plan.imageProgram?.values).toContain(.8);
  });

  it('keeps the structural key stable while stage and image parameter values change', () => {
    const graph = createDefaultVoronoiGraph();
    const first = compileComputeImageGraph(graph, { scale: 12, speed: .25, amount: .2 });
    const second = compileComputeImageGraph(graph, { scale: 48, speed: 2, amount: .9 });
    expect(second.key).toBe(first.key);
    expect(second.imageProgram?.key).toBe(first.imageProgram?.key);
    expect(second.stages[0]?.params).toEqual({ scale: 48, speed: 2 });
    expect(second.imageProgram?.values).not.toEqual(first.imageProgram?.values);
  });

  it('prefers bound stage params, validates their types, and prunes bypassed image dependencies', () => {
    const graph = createDefaultVoronoiGraph();
    graph.nodes.find(node => node.id === 'seeds')!.constants = { scale: 8, speed: 4 };
    expect(compileComputeImageGraph(graph, { scale: 32, speed: .75 }).stages[0]?.params).toEqual({ scale: 32, speed: .75 });
    expect(() => compileComputeImageGraph(graph, { scale: 'large' })).toThrow('Compute image parameter seeds.scale must be numeric.');
    graph.nodes.find(node => node.id === 'seeds')!.bindings.scale = 'customScale';
    expect(compileComputeImageGraph(graph).stages[0]?.params.scale).toBe(24);

    const mixed = graph.nodes.find(node => node.id === 'mixed')!;
    mixed.bypassed = true;
    const a = graph.edges.find(edge => edge.to === 'mixed' && edge.input === 'a')!;
    const b = graph.edges.find(edge => edge.to === 'mixed' && edge.input === 'b')!;
    [a.from, a.output, b.from, b.output] = [b.from, b.output, a.from, a.output];
    const pruned = compileComputeImageGraph(graph, { scale: 32, speed: .75 });
    expect(pruned.stages).toEqual([]);
    expect(pruned.imageProgram?.fieldResources).toBeUndefined();
  });

  it('does not schedule unreachable compute stages for a direct frame output', () => {
    const graph = connectEffectGraph(createDefaultVoronoiGraph(), {
      id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image',
    });
    const plan = compileComputeImageGraph(graph);
    expect(plan).toEqual(expect.objectContaining({ stages: [], output: 'frame', passthrough: true }));
    expect(plan.imageProgram).toBeUndefined();
  });

  it('fails closed for unsupported or malformed compute graphs', () => {
    const unsupported = createDefaultVoronoiGraph();
    unsupported.nodes.push({ id: 'gravity', operator: 'forces.gravity', operatorVersion: 1, bindings: {} });
    unsupported.layout.gravity = { x: 0, y: 0 };
    expect(() => compileComputeImageGraph(unsupported)).toThrow('Unsupported compute-image node: gravity.');

    const malformed = createDefaultVoronoiGraph();
    malformed.edges = malformed.edges.filter(edge => !(edge.to === 'jump-flood' && edge.input === 'field'));
    expect(() => compileComputeImageGraph(malformed)).toThrow('Jump Flood: connect Seed Field.');
  });

  it('previews uniform inputs and disconnected values without compute stages', () => {
    const graph = createDefaultVoronoiGraph();
    graph.nodes.push({ id: 'preview-only', operator: 'values.number', operatorVersion: 1, bindings: { value: 'amount' } });
    graph.layout['preview-only'] = { x: 0, y: 0 };
    const disconnected = compileComputeImagePreview(graph, { amount: .35 }, {
      nodeId: 'preview-only', direction: 'output', portId: 'value',
    });
    expect(disconnected.requiredStages).toEqual([]);
    expect(evaluateImageOperatorPlan(disconnected.plan, [0, 0, 0, 0])[0]).toBe(.35);

    const input = compileComputeImagePreview(graph, {}, { nodeId: 'style-scale', direction: 'input', portId: 'a' });
    expect(input.requiredStages).toEqual([]);
    expect(evaluateImageOperatorPlan(input.plan, [0, 0, 0, 0])[0]).toBe(.82);
  });

  it('reports field resources and stages for a preview disconnected from the full output', () => {
    const graph = connectEffectGraph(createDefaultVoronoiGraph(), {
      id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image',
    });
    expect(compileComputeImageGraph(graph).passthrough).toBe(true);
    const preview = compileComputeImagePreview(graph, {}, { nodeId: 'border', direction: 'output', portId: 'value' });
    expect(preview.plan.fieldResources).toEqual([{
      resourceId: 'voronoi-field:jump-flood', producerNodeId: 'jump-flood', outputPort: 'field', format: 'nearest-seed-rgba16float',
    }]);
    expect(preview.requiredStages.map(stage => stage.nodeId)).toEqual(['seeds', 'jump-flood']);
    const available = new Set(['seeds']);
    expect(preview.requiredStages.filter(stage => !available.has(stage.nodeId)).map(stage => stage.nodeId)).toEqual(['jump-flood']);
  });
});
