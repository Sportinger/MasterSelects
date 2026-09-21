import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
const n = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const e = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
function rectGraph(width: number, height: number): EffectOperatorGraph {
  const nodes = [n('frame', 'image.frame'), n('uv', 'image.normalized-uv'), n('index', 'image.kernel-index'), n('step', 'values.number', .1),
    n('offset', 'math.multiply.vec2-scalar'), n('sample-uv', 'math.add.vec2'), n('sample', 'image.sample'), n('weight', 'values.number', 1),
    n('width', 'values.number', width), n('height', 'values.number', height), n('reduce', 'image.kernel-rect-reduce'),
    n('image', 'convert.vec4-to-image'), n('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, layout: {}, edges: [e('index', 'value', 'offset', 'a'), e('step', 'value', 'offset', 'b'),
    e('uv', 'uv', 'sample-uv', 'a'), e('offset', 'value', 'sample-uv', 'b'), e('frame', 'image', 'sample', 'image'), e('sample-uv', 'value', 'sample', 'uv'),
    e('sample', 'image', 'reduce', 'sample'), e('weight', 'value', 'reduce', 'weight'), e('width', 'value', 'reduce', 'width'), e('height', 'value', 'reduce', 'height'),
    e('reduce', 'sum', 'image', 'value'), e('image', 'image', 'output', 'image')] };
}
describe('Glow reusable image primitives', () => {
  it('reduces a clamped rectangular domain X outer and Y inner', () => {
    const coordinates: [number, number][] = [], plan = compileImageOperatorGraph(rectGraph(2.9, 3.9));
    evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [0, 0], sampleImage: uv => { coordinates.push(uv); return [1, 1, 1, 1]; } });
    expect(coordinates).toEqual([[0, 0], [0, .1], [0, .2], [.1, 0], [.1, .1], [.1, .2]]);
    expect(plan.wgsl).toContain('for (var x = 0; x < width; x++) { for (var y = 0; y < height; y++)');
    let count = 0; evaluateImageOperatorPlan(compileImageOperatorGraph(rectGraph(0, 100)), [0, 0, 0, 0], {
      uv: [0, 0], sampleImage: () => { count++; return [0, 0, 0, 0]; },
    }); expect(count).toBe(64);
  });
  it('shares Gaussian math, direction and scalar broadcast semantics', () => {
    const graph = rectGraph(1, 1); graph.nodes.push(n('angle', 'values.number', Math.PI / 2), n('direction', 'vector.unit-direction.scalar'),
      n('x', 'values.number', .5), n('sigma', 'values.number', .8), n('gaussian', 'math.gaussian.scalar'));
    graph.edges.push(e('angle', 'value', 'direction', 'angle'), e('x', 'value', 'gaussian', 'value'), e('sigma', 'value', 'gaussian', 'sigma'));
    const direction = evaluateImageOperatorPlan(compileImageOperatorPreview(graph, {}, { nodeId: 'direction', direction: 'output', portId: 'value' }), [0, 0, 0, 0]);
    expect(direction[0]).toBeCloseTo(0, 12); expect(direction[1]).toBeCloseTo(1, 12);
    const gaussian = evaluateImageOperatorPlan(compileImageOperatorPreview(graph, {}, { nodeId: 'gaussian', direction: 'output', portId: 'value' }), [0, 0, 0, 0]);
    expect(gaussian[0]).toBeCloseTo(Math.exp(-(.5 * .5) / ((2 * .8) * .8)), 12);
    expect(gaussian[3]).toBe(1);
  });
  it('materializes a rectangular reducer before a downstream sequence reducer', () => {
    const graph = rectGraph(1, 1); graph.edges = graph.edges.filter(item => item.to !== 'output');
    graph.nodes.push(n('sequence-weight', 'values.number', 1), n('count', 'values.number', 1), n('sequence', 'image.sequence-reduce'),
      n('sequence-image', 'convert.vec4-to-image'));
    graph.edges.push(e('image', 'image', 'sequence', 'sample'), e('sequence-weight', 'value', 'sequence', 'weight'), e('count', 'value', 'sequence', 'count'),
      e('sequence', 'sum', 'sequence-image', 'value'), e('sequence-image', 'image', 'output', 'image'));
    expect(compileImageOperatorGraph(graph).passes).toHaveLength(2);
  });
  it('scales image alpha and preserves IEEE RGB scalar division', () => {
    const nodes = [n('frame', 'image.frame'), n('half', 'values.number', .5), n('scaled', 'math.multiply.image-scalar'),
      n('rgba', 'convert.image-to-vec4'), n('rgb', 'convert.vec4-to-rgb'), n('zero', 'values.number', 0), n('divide', 'math.divide-ieee.rgb-scalar'),
      n('split', 'vector.split.rgba'), n('combine', 'vector.combine.rgba'), n('output', 'image.output')];
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', nodes, layout: {}, edges: [e('frame', 'image', 'scaled', 'a'), e('half', 'value', 'scaled', 'b'),
      e('scaled', 'value', 'rgba', 'image'), e('rgba', 'value', 'rgb', 'value'), e('rgb', 'rgb', 'divide', 'a'), e('zero', 'value', 'divide', 'b'),
      e('frame', 'image', 'split', 'image'), e('divide', 'value', 'combine', 'rgb'), e('split', 'alpha', 'combine', 'alpha'), e('combine', 'image', 'output', 'image')] };
    const scaled = compileImageOperatorPreview(graph, {}, { nodeId: 'scaled', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(scaled, [.2, .4, .6, .8])).toEqual([.1, .2, .3, .4]);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [.2, .4, .6, .8]).slice(0, 3).every(value => value === Infinity)).toBe(true);
  });
});
