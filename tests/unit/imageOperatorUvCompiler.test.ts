import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const n = (id: string, operator: string, value?: number) => ({ id, operator, operatorVersion: 1 as const, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const e = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

function uvGraph(): EffectOperatorGraph {
  const nodes = [n('frame', 'image.frame'), n('output', 'image.output'), n('uv', 'image.normalized-uv'), n('half', 'values.number', 0.5),
    n('half2', 'convert.scalar-to-vec2'), n('offset', 'math.subtract.vec2'), n('scale', 'math.multiply.vec2'), n('length', 'vector.length.vec2'),
    n('zero', 'values.number', 0), n('one', 'values.number', 1), n('smooth', 'math.smoothstep.scalar'), n('mix', 'math.mix.scalar')];
  const edges = [e('frame-output', 'frame', 'image', 'output', 'image'), e('half-half2', 'half', 'value', 'half2', 'value'),
    e('uv-offset', 'uv', 'uv', 'offset', 'a'), e('half2-offset', 'half2', 'value', 'offset', 'b'), e('offset-scale-a', 'offset', 'value', 'scale', 'a'),
    e('half2-scale-b', 'half2', 'value', 'scale', 'b'), e('scale-length', 'scale', 'value', 'length', 'value'),
    e('zero-smooth', 'zero', 'value', 'smooth', 'edge0'), e('one-smooth', 'one', 'value', 'smooth', 'edge1'), e('length-smooth', 'length', 'value', 'smooth', 'value'),
    e('zero-mix', 'zero', 'value', 'mix', 'a'), e('one-mix', 'one', 'value', 'mix', 'b'), e('smooth-mix', 'smooth', 'value', 'mix', 't')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 100, y: 0 }])) };
}

describe('contextual image operator compiler', () => {
  it('keeps pixel-only plans on the one-argument ABI', () => {
    const plan = compileImageOperatorGraph(uvGraph());
    expect(plan.capabilities).toEqual([]);
    expect(plan.wgsl).toContain('fn evaluateImageGraph(inputColor: vec4f) -> vec4f');
    expect(evaluateImageOperatorPlan(plan, [0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('requires normalized UV context and emits the contextual ABI for reachable UV math', () => {
    const plan = compileImageOperatorPreview(uvGraph(), {}, { nodeId: 'mix', direction: 'output', portId: 'value' });
    expect(plan.capabilities).toEqual(['uv']);
    expect(plan.wgsl).toContain('fn evaluateImageGraph(inputColor: vec4f, inputUv: vec2f) -> vec4f');
    expect(plan.instructions.map(item => item.operation)).toEqual(expect.arrayContaining([
      'uv', 'scalar-to-vec2', 'subtract-vec2', 'multiply-vec2', 'length-vec2', 'smoothstep-scalar', 'mix-scalar',
    ]));
    expect(() => evaluateImageOperatorPlan(plan, [0, 0, 0, 1])).toThrow(/requires normalized UV context/);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [0.5, 0.5] })).toEqual([0, 0, 0, 1]);
  });

  it('orders UV before dynamic parameters in the shared WGSL ABI', () => {
    const graph = uvGraph();
    const half = graph.nodes.find(node => node.id === 'half')!;
    half.bindings.value = 'center';
    delete half.constants;
    const plan = compileImageOperatorPreview(graph, { center: 0.5 }, { nodeId: 'mix', direction: 'output', portId: 'value' });
    expect(plan.values).toEqual([0.5]);
    expect(plan.wgsl).toContain('inputColor: vec4f, inputUv: vec2f, imageParameters: ImageOperatorParameters');
  });
});
