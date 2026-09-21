import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph, compileComputeImagePreview } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { effectOperatorCompileContext, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';

describe('Pixel Sort compute-image compilation', () => {
  const context = effectOperatorCompileContext({ type: 'pixel-sort' });

  it('keeps a resource-free graph as an executable final program with no specialized stages', () => {
    const params = effectOperatorParams({ type: 'pixel-sort', params: {} });
    const plan = compileComputeImageGraph(createDefaultPixelSortGraph(), params, context);
    expect(plan).toMatchObject({ stages: [], output: 'combined', passthrough: false });
    expect(plan.imageProgram).toBeDefined();
    expect(plan.imageProgram?.resourceInputs ?? []).toEqual([]);
  });

  it('uses the canonical owner schema for sparse graph and preview parameters', () => {
    const graph = createDefaultPixelSortGraph();
    const plan = compileComputeImageGraph(graph, {}, context);
    const preview = compileComputeImagePreview(graph, {}, { nodeId: 'scale', direction: 'output', portId: 'value' }, context);
    expect(plan.imageProgram?.values).toContain(16);
    expect(preview.plan.values).toContain(16);
  });

  it('keeps bound values outside the structural key and distinguishes bypass from output passthrough', () => {
    const graph = createDefaultPixelSortGraph();
    const first = compileComputeImageGraph(graph, effectOperatorParams({ type: 'pixel-sort', params: { amount: .2, threshold: .1, scale: 5 } }), context);
    const second = compileComputeImageGraph(graph, effectOperatorParams({ type: 'pixel-sort', params: { amount: .9, threshold: .8, scale: 15 } }), context);
    expect(first.key).toBe(second.key);
    expect(first.imageProgram?.values).not.toEqual(second.imageProgram?.values);

    graph.nodes.find(node => node.id === 'sorted')!.bypassed = true;
    expect(compileComputeImageGraph(graph, effectOperatorParams({ type: 'pixel-sort', params: {} }), context).passthrough).toBe(false);
    const rewired = connectEffectGraph(createDefaultPixelSortGraph(), {
      id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image',
    });
    const passthrough = compileComputeImageGraph(rewired, effectOperatorParams({ type: 'pixel-sort', params: {} }), context);
    expect(passthrough).toMatchObject({ stages: [], output: 'frame', passthrough: true });
    expect(passthrough.imageProgram).toBeUndefined();
  });
});
