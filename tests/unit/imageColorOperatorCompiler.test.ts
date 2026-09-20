import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const n = (id: string, operator: string, value?: number) => ({ id, operator, operatorVersion: 1 as const, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const e = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

function colorMathGraph(): EffectOperatorGraph {
  const nodes = [n('frame', 'image.frame'), n('split', 'vector.split.rgba'), n('quarter', 'values.number', 0.25), n('quarter-rgb', 'convert.scalar-to-rgb'),
    n('add', 'math.add.rgb'), n('two', 'values.number', 2), n('two-rgb', 'convert.scalar-to-rgb'), n('multiply', 'math.multiply.rgb'),
    n('luma', 'color.luminance-rec601.rgb'), n('luma-rgb', 'convert.scalar-to-rgb'), n('factor', 'values.number', 1.5), n('mix', 'math.mix.rgb'),
    n('zero', 'values.number', 0), n('zero-rgb', 'convert.scalar-to-rgb'), n('one', 'values.number', 1), n('one-rgb', 'convert.scalar-to-rgb'),
    n('clamp', 'math.clamp.rgb'), n('combine', 'vector.combine.rgba'), n('output', 'image.output')];
  const edges = [e('a', 'frame', 'image', 'split', 'image'), e('b', 'quarter', 'value', 'quarter-rgb', 'value'), e('c', 'split', 'rgb', 'add', 'a'),
    e('d', 'quarter-rgb', 'rgb', 'add', 'b'), e('e', 'two', 'value', 'two-rgb', 'value'), e('f', 'add', 'value', 'multiply', 'a'),
    e('g', 'two-rgb', 'rgb', 'multiply', 'b'), e('h', 'multiply', 'value', 'luma', 'rgb'), e('i', 'luma', 'value', 'luma-rgb', 'value'),
    e('j', 'luma-rgb', 'rgb', 'mix', 'a'), e('k', 'multiply', 'value', 'mix', 'b'), e('l', 'factor', 'value', 'mix', 't'),
    e('m', 'zero', 'value', 'zero-rgb', 'value'), e('n', 'one', 'value', 'one-rgb', 'value'), e('o', 'mix', 'value', 'clamp', 'value'),
    e('p', 'zero-rgb', 'rgb', 'clamp', 'min'), e('q', 'one-rgb', 'rgb', 'clamp', 'max'), e('r', 'clamp', 'value', 'combine', 'rgb'),
    e('s', 'split', 'alpha', 'combine', 'alpha'), e('t', 'combine', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: Object.fromEntries(nodes.map((node, index) => [node.id, { x: index * 100, y: 0 }])) };
}

describe('typed image color operators', () => {
  it('matches source-encoded Rec601 math, extrapolating mix, explicit clamp, and straight alpha preservation', () => {
    const plan = compileImageOperatorGraph(colorMathGraph());
    const result = evaluateImageOperatorPlan(plan, [0.2, 0.4, 0.6, 0.3]);
    expect(result[0]).toBeCloseTo(0.737, 10);
    expect(result.slice(1)).toEqual([1, 1, 0.3]);
    expect(plan.instructions.map(item => item.operation)).toEqual(expect.arrayContaining([
      'add-rgb', 'multiply-rgb', 'luminance-rec601', 'mix-rgb', 'clamp-rgb',
    ]));
    expect(plan.wgsl).toContain('dot(');
    expect(plan.wgsl).toContain('mix(');
    expect(plan.wgsl).toContain('clamp(');
  });

  it('uses each operation’s explicit source-preserving passthrough when bypassed', () => {
    const graph = colorMathGraph();
    graph.nodes.find(node => node.id === 'add')!.bypassed = true;
    graph.nodes.find(node => node.id === 'multiply')!.bypassed = true;
    graph.nodes.find(node => node.id === 'mix')!.bypassed = true;
    graph.nodes.find(node => node.id === 'clamp')!.bypassed = true;
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [0.2, 0.4, 0.6, 0.3])).toEqual([0.2, 0.4, 0.6, 0.3]);
  });
});
