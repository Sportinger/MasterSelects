import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
function graph(): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [node('jump', 'geometry.jump-flood'),
    node('x', 'values.number', 7.8), node('y', 'values.number', -2.4), node('pixel', 'vector.combine.vec2'),
    node('read', 'field.read-nearest-seed'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')],
    edges: [edge('jump', 'field', 'read', 'field'), edge('x', 'value', 'pixel', 'x'), edge('y', 'value', 'pixel', 'y'),
      edge('pixel', 'value', 'read', 'pixel'), edge('read', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image')] };
}
const fieldResources = [{ resourceId: 'voronoi-field:jump', producerNodeId: 'jump', outputPort: 'field' as const,
  format: 'nearest-seed-rgba16float' as const }];

describe('nearest-seed field image lowering', () => {
  it('retains typed provenance and exactly loads the raw seed record', () => {
    const plan = compileImageOperatorGraph(graph(), {}, { fieldResources });
    expect(plan.resourceInputs).toEqual(['voronoi-field:jump']);
    expect(plan.resourceSampling).toEqual(['exact-pixel-load']);
    expect(plan.fieldResources).toEqual(fieldResources);
    expect(plan.wgsl).toContain('loadImageGraphResource0(imageGraphPixelCoordinate');
    const calls: Array<[string, number, number]> = [];
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [4, 3],
      loadResource: (id, pixel) => { calls.push([id, ...pixel]); return [2, 1, 1, 0]; } });
    expect(calls).toEqual([['voronoi-field:jump', 3, 0]]); expect(result).toEqual([2, 1, 1, 0]);
  });

  it('fails closed for absent provenance, malformed formats, and resource aliases', () => {
    expect(() => compileImageOperatorGraph(graph(), {})).toThrow(/not declared/);
    expect(() => compileImageOperatorGraph(graph(), {}, { fieldResources: [{ ...fieldResources[0], format: 'wrong' as never }] }))
      .toThrow(/invalid port or format/);
    expect(() => compileImageOperatorGraph(graph(), {}, { fieldResources: [{ ...fieldResources[0], resourceId: 'image-resource:collision' }] }))
      .toThrow(/reserved id/);
  });
});
