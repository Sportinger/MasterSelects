import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph, compileComputeImagePreview } from '../../src/services/operators/computeImageGraph';
import { createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';

const params = { scale: 2, threshold: 1, speed: .5, amount: 1 };

describe('image.quadtree-partition compiler', () => {
  it('memoizes joint origin and size outputs and emits the exact bounded load order', () => {
    const program = compileComputeImageGraph(createDefaultQuadtreeGraph(), params).imageProgram!;
    expect(program.instructions.filter(item => item.operation === 'quadtree-partition')).toHaveLength(1);
    expect(program.instructions.filter(item => item.operation === 'quadtree-origin')).toHaveLength(1);
    expect(program.instructions.filter(item => item.operation === 'quadtree-size')).toHaveLength(1);
    expect(program.wgsl).toContain('for (var level = 0; level < 6; level += 1)');
    expect(program.wgsl.indexOf('let a = imageQuadtreeTone')).toBeLessThan(program.wgsl.indexOf('let b = imageQuadtreeTone'));
    expect(program.wgsl.indexOf('let b = imageQuadtreeTone')).toBeLessThan(program.wgsl.indexOf('let e = imageQuadtreeTone'));
  });

  it('evaluates a root partition through exactly five ordered loads when the first level terminates', () => {
    const graph = createDefaultQuadtreeGraph();
    const plan = compileComputeImagePreview(graph, params, { nodeId: 'partition', direction: 'output', portId: 'origin' }).plan;
    const calls: Array<[number, number]> = [];
    const result = createImageOperatorEvaluator(plan)([0, 0, 0, 1], { uv: [37.5 / 128, 19.5 / 96], resolution: [128, 96],
      pixelCoordinate: [37, 19], timelineTimeSeconds: 0, loadImage: pixel => { calls.push([...pixel]); return [pixel[0] / 128, pixel[1] / 96, 0, 1]; } });
    expect(result).toEqual([0, 0, 0, 1]);
    expect(calls).toEqual([[0, 0], [63, 0], [0, 63], [63, 63], [32, 32]]);
  });

  it('rejects nested partition scopes instead of approximating them', () => {
    const graph = createDefaultQuadtreeGraph(), partition = graph.nodes.find(node => node.id === 'partition')!;
    graph.nodes.push({ ...partition, id: 'outer-partition', bindings: {} });
    for (const input of ['scale', 'threshold', 'time', 'speed']) {
      const original = graph.edges.find(edge => edge.to === 'partition' && edge.input === input)!;
      graph.edges.push({ ...original, id: `outer-${input}`, to: 'outer-partition' });
    }
    graph.edges.push({ id: 'center-sample-outer-image', from: 'center-sample', output: 'image', to: 'outer-partition', input: 'image' });
    const local = graph.edges.find(edge => edge.to === 'local' && edge.input === 'b')!;
    local.from = 'outer-partition'; local.output = 'origin';
    expect(() => compileComputeImageGraph(graph, params)).toThrow(/cannot be nested/);
  });
});
