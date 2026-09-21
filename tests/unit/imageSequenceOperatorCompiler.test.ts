import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
function sequenceGraph(count: number): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('sequence', 'image.sequence-index'),
    node('index-vec', 'convert.scalar-to-vec2'), node('step', 'values.number', .1), node('step-vec', 'convert.scalar-to-vec2'),
    node('offset', 'math.multiply.vec2'), node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'), node('count', 'values.number', count),
    node('reduce', 'image.sequence-reduce'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')];
  const edges = [edge('sequence', 'index', 'index-vec', 'value'), edge('step', 'value', 'step-vec', 'value'), edge('index-vec', 'value', 'offset', 'a'),
    edge('step-vec', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('offset', 'value', 'sample-uv', 'b'),
    edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'), edge('sample', 'image', 'reduce', 'sample'),
    edge('sequence', 't', 'reduce', 'weight'), edge('count', 'value', 'reduce', 'count'), edge('reduce', 'sum', 'image', 'value'),
    edge('image', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
}

describe('image sequence operator compiler', () => {
  it('iterates i=0..N-1, exposes normalized t and accumulates RGBA jointly', () => {
    const coordinates: [number, number][] = [], plan = compileImageOperatorGraph(sequenceGraph(3.9));
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.2, .3], sampleImage: uv => {
      coordinates.push(uv); return [uv[0], uv[1], 1, .5];
    } });
    [[.2, .3], [.3, .4], [.4, .5]].forEach((expected, tap) => expected.forEach((value, axis) => expect(coordinates[tap][axis]).toBeCloseTo(value, 12)));
    [.55, .7, 1.5, .75].forEach((expected, index) => expect(result[index]).toBeCloseTo(expected, 12));
    expect(plan.wgsl).toContain('for (var i = 0; i < count; i++)');
  });

  it('defines count-one progress as zero and rejects sequence index previews outside scope', () => {
    let samples = 0;
    const result = evaluateImageOperatorPlan(compileImageOperatorGraph(sequenceGraph(-2)), [0, 0, 0, 0], {
      uv: [.2, .3], sampleImage: () => { samples++; return [1, 1, 1, 1]; },
    });
    expect(samples).toBe(1); expect(result).toEqual([0, 0, 0, 0]);
    expect(() => compileImageOperatorPreview(sequenceGraph(2), {}, { nodeId: 'sequence', direction: 'output', portId: 't' }))
      .toThrow('image.sequence-index is only available inside a sequence reduction scope.');
  });

  it('matches the legacy mirror-repeat coordinate formula', () => {
    const graph = sequenceGraph(2), mirror = node('mirror', 'coordinates.mirror-repeat.vec2');
    graph.nodes.push(mirror); graph.edges = graph.edges.map(item => item.to === 'sample' && item.input === 'uv' ? edge('mirror', 'value', 'sample', 'uv') : item);
    graph.edges.push(edge('sample-uv', 'value', 'mirror', 'value'));
    const coordinates: [number, number][] = [];
    evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [0, 0, 0, 0], { uv: [1.95, -.1], sampleImage: uv => { coordinates.push(uv); return [1, 1, 1, 1]; } });
    expect(coordinates[0]).toEqual([.050000000000000044, .10000000000000009]);
  });

  it('materializes a sequence feeding a grid, but not parallel neighborhood reducers', () => {
    const weight = node('weight', 'values.number', 1), count = node('count', 'values.number', 1), extent = node('extent', 'values.number', 0);
    const nodes = [node('frame', 'image.frame'), weight, count, extent, node('sequence-reduce', 'image.sequence-reduce'),
      node('sequence-image', 'convert.vec4-to-image'), node('grid-reduce', 'image.kernel-grid-reduce'), node('grid-image', 'convert.vec4-to-image'), node('output', 'image.output')];
    const edges = [edge('frame', 'image', 'sequence-reduce', 'sample'), edge('weight', 'value', 'sequence-reduce', 'weight'), edge('count', 'value', 'sequence-reduce', 'count'),
      edge('sequence-reduce', 'sum', 'sequence-image', 'value'), edge('sequence-image', 'image', 'grid-reduce', 'sample'), edge('weight', 'value', 'grid-reduce', 'weight'),
      edge('extent', 'value', 'grid-reduce', 'extent'), edge('grid-reduce', 'sum', 'grid-image', 'value'), edge('grid-image', 'image', 'output', 'image')];
    const serial: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
    expect(compileImageOperatorGraph(serial).passes).toHaveLength(2);
    const parallel = structuredClone(serial);
    parallel.edges = parallel.edges.filter(item => item.from !== 'sequence-image' && item.to !== 'output');
    parallel.nodes.push({ ...node('choose', 'values.boolean'), constants: { value: true } }, node('select', 'control.select.image'));
    parallel.edges.push(edge('frame', 'image', 'grid-reduce', 'sample'), edge('choose', 'value', 'select', 'condition'),
      edge('sequence-image', 'image', 'select', 'falseValue'), edge('grid-image', 'image', 'select', 'trueValue'), edge('select', 'image', 'output', 'image'));
    expect(compileImageOperatorGraph(parallel).passes).toBeUndefined();
  });
});
