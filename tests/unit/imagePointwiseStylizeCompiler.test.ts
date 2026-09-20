import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const n = (id: string, operator: string, value?: number) => ({ id, operator, operatorVersion: 1 as const, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const e = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });
const graph = (nodes: ReturnType<typeof n>[], edges: ReturnType<typeof e>[]): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((node, index) => [node.id, { x: index * 100, y: 0 }])),
});

function thresholdGraph(level: number) {
  const nodes = [n('frame', 'image.frame'), n('split', 'vector.split.rgba'), n('luma', 'color.luminance-rec709.rgb'), n('level', 'values.number', level),
    n('greater', 'compare.greater.scalar'), n('zero', 'values.number', 0), n('one', 'values.number', 1), n('select', 'select.scalar'),
    n('gray', 'convert.scalar-to-rgb'), n('combine', 'vector.combine.rgba'), n('output', 'image.output')];
  return graph(nodes, [e('a', 'frame', 'image', 'split', 'image'), e('b', 'split', 'rgb', 'luma', 'rgb'), e('c', 'luma', 'value', 'greater', 'a'),
    e('d', 'level', 'value', 'greater', 'b'), e('e', 'zero', 'value', 'select', 'falseValue'), e('f', 'one', 'value', 'select', 'trueValue'),
    e('g', 'greater', 'condition', 'select', 'condition'), e('h', 'select', 'value', 'gray', 'value'), e('i', 'gray', 'rgb', 'combine', 'rgb'),
    e('j', 'split', 'alpha', 'combine', 'alpha'), e('k', 'combine', 'image', 'output', 'image')]);
}

function posterizeGraph(levels: number) {
  const nodes = [n('frame', 'image.frame'), n('split', 'vector.split.rgba'), n('levels', 'values.number', levels), n('two', 'values.number', 2),
    n('safe-levels', 'math.max.scalar'), n('levels-rgb', 'convert.scalar-to-rgb'), n('scale', 'math.multiply.rgb'), n('floor', 'math.floor.rgb'),
    n('one', 'values.number', 1), n('denominator', 'math.subtract.scalar'), n('denominator-rgb', 'convert.scalar-to-rgb'), n('divide', 'math.divide-ieee.rgb'),
    n('combine', 'vector.combine.rgba'), n('output', 'image.output')];
  return graph(nodes, [e('a', 'frame', 'image', 'split', 'image'), e('b', 'levels', 'value', 'safe-levels', 'a'), e('c', 'two', 'value', 'safe-levels', 'b'),
    e('d', 'safe-levels', 'value', 'levels-rgb', 'value'), e('e', 'split', 'rgb', 'scale', 'a'), e('f', 'levels-rgb', 'rgb', 'scale', 'b'),
    e('g', 'scale', 'value', 'floor', 'value'), e('h', 'safe-levels', 'value', 'denominator', 'a'), e('i', 'one', 'value', 'denominator', 'b'),
    e('j', 'denominator', 'value', 'denominator-rgb', 'value'), e('k', 'floor', 'value', 'divide', 'a'), e('l', 'denominator-rgb', 'rgb', 'divide', 'b'),
    e('m', 'divide', 'value', 'combine', 'rgb'), e('n', 'split', 'alpha', 'combine', 'alpha'), e('o', 'combine', 'image', 'output', 'image')]);
}

describe('pointwise stylize image operators', () => {
  it('uses Rec709 and a strict greater-than threshold while preserving alpha', () => {
    const graph = thresholdGraph(0.2126);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [1, 0, 0, 0.4])).toEqual([0, 0, 0, 0.4]);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(thresholdGraph(0.2)), [1, 0, 0, 0.4])).toEqual([1, 1, 1, 0.4]);
    const condition = compileImageOperatorPreview(graph, {}, { nodeId: 'greater', direction: 'output', portId: 'condition' });
    expect(condition.instructions[condition.output].type).toBe('boolean');
    expect(condition.wgsl).toContain('>');
  });

  it('preserves the legacy posterize formula including white above one before target clamp', () => {
    const plan = compileImageOperatorGraph(posterizeGraph(6));
    expect(evaluateImageOperatorPlan(plan, [1, 0.5, 0, 0.25])).toEqual([1.2, 0.6, 0, 0.25]);
    expect(plan.instructions.map(item => item.operation)).toEqual(expect.arrayContaining(['max-scalar', 'multiply-rgb', 'floor-rgb', 'divide-ieee-rgb']));
    expect(plan.wgsl).toContain('floor(');
  });
});
