import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { effectOperatorCompileContext, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';

describe('Quadtree Zoom compute-image compilation', () => {
  const context = effectOperatorCompileContext({ type: 'quadtree-zoom' });

  it('compiles as a resource-free executable final program with authoritative defaults', () => {
    const plan = compileComputeImageGraph(createDefaultQuadtreeGraph(), {}, context);
    expect(plan).toMatchObject({ stages: [], output: 'combined', passthrough: false });
    expect(plan.imageProgram).toBeDefined();
    expect(plan.imageProgram?.resourceInputs ?? []).toEqual([]);
    expect(plan.imageProgram?.values).toEqual(expect.arrayContaining([8, .025, .8, .5]));
  });

  it('keeps dynamic values outside the structural key and recognizes direct output passthrough', () => {
    const graph = createDefaultQuadtreeGraph();
    const first = compileComputeImageGraph(graph, effectOperatorParams({ type: 'quadtree-zoom', params: { scale: 4, threshold: .01 } }), context);
    const second = compileComputeImageGraph(graph, effectOperatorParams({ type: 'quadtree-zoom', params: { scale: 28, threshold: .18 } }), context);
    expect(first.key).toBe(second.key); expect(first.imageProgram?.values).not.toEqual(second.imageProgram?.values);
    graph.nodes.find(node => node.id === 'mixed')!.bypassed = true;
    expect(compileComputeImageGraph(graph, {}, context)).toMatchObject({ stages: [], passthrough: false });
    const rewired = connectEffectGraph(graph, { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    const passthrough = compileComputeImageGraph(rewired, {}, context);
    expect(passthrough).toMatchObject({ stages: [], output: 'frame', passthrough: true });
    expect(passthrough.imageProgram).toBeUndefined();
  });
});
