import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, constants?: BoundOperatorNode['constants'], bindings: BoundOperatorNode['bindings'] = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

function sourceLoadGraph(): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'),
    node('uv-parts', 'vector.split.vec2'), node('uv-rgb', 'convert.scalar-to-rgb'), node('split', 'vector.split.rgba'),
    node('add', 'math.add.rgb'), node('combined', 'vector.combine.rgba'), node('pixel-x', 'values.number', { value: 9.8 }),
    node('pixel-y', 'values.number', { value: -.9 }), node('pixel', 'vector.combine.vec2'),
    node('load', 'image.load-pixel-clamped'), node('output', 'image.output')], edges: [edge('frame', 'image', 'split', 'image'),
    edge('uv', 'uv', 'uv-parts', 'value'), edge('uv-parts', 'x', 'uv-rgb', 'value'), edge('split', 'rgb', 'add', 'a'),
    edge('uv-rgb', 'rgb', 'add', 'b'), edge('add', 'value', 'combined', 'rgb'), edge('split', 'alpha', 'combined', 'alpha'),
    edge('pixel-x', 'value', 'pixel', 'x'), edge('pixel-y', 'value', 'pixel', 'y'),
    edge('combined', 'image', 'load', 'image'), edge('pixel', 'value', 'load', 'pixel'), edge('load', 'image', 'output', 'image')] };
}

describe('image.load-pixel-clamped', () => {
  it('clamps and truncates integer coordinates while re-evaluating the connected expression at pixel-center UV', () => {
    const plan = compileImageOperatorGraph(sourceLoadGraph(), {}), loaded: Array<[number, number]> = [];
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'resolution', 'pixel-load']));
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.1, .2], resolution: [4, 3],
      loadImage: pixel => { loaded.push(pixel); return [pixel[0], pixel[1], .2, .7]; } });
    expect(loaded).toEqual([[3, 0]]);
    expect(result).toEqual([3.875, .875, 1.075, .7]);
    expect(plan.wgsl).toContain('loadImageGraphSource(imageGraphPixelCoordinate');
  });

  it('loads named resources through the distinct integer callback without requiring a source callback', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {},
      nodes: [node('resource', 'image.named-input', undefined, { resource: 'field' }), node('pixel-x', 'values.number', { value: 2.9 }),
        node('pixel-y', 'values.number', { value: 1.8 }), node('pixel', 'vector.combine.vec2'),
        node('load', 'image.load-pixel-clamped'), node('output', 'image.output')],
      edges: [edge('resource', 'image', 'load', 'image'), edge('pixel-x', 'value', 'pixel', 'x'), edge('pixel-y', 'value', 'pixel', 'y'),
        edge('pixel', 'value', 'load', 'pixel'), edge('load', 'image', 'output', 'image')] };
    const plan = compileImageOperatorGraph(graph, {}, { namedImages: [{ id: 'field', sampling: 'hardware-linear-clamp' }] });
    const loaded: Array<[string, number, number]> = [];
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [4, 3],
      loadResource: (id, pixel) => { loaded.push([id, ...pixel]); return [.1, .2, .3, .4]; } });
    expect(loaded).toEqual([['field', 2, 1]]); expect(result).toEqual([.1, .2, .3, .4]);
    expect(plan.wgsl).toContain('loadImageGraphResource0(inputPixel)');
  });

  it('emits exact textureLoad overloads for texture and external sources', () => {
    const plan = compileImageOperatorGraph(sourceLoadGraph(), {});
    expect(imageGraphProgramShader(plan, 'fragmentMain', 'texture')).toContain('textureLoad(inputTex, coordinate, 0)');
    expect(imageGraphProgramShader(plan, 'fragmentMain', 'external')).toContain('textureLoad(inputTex, coordinate);');
  });

  it('forwards integer coordinates through lazy resource branches inside a load scope', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
      node('a', 'image.named-input', undefined, { resource: 'a' }), node('b', 'image.named-input', undefined, { resource: 'b' }),
      node('condition', 'values.boolean', { value: true }), node('select', 'control.select.image'),
      node('x', 'values.number', { value: 1.9 }), node('y', 'values.number', { value: 2.2 }), node('pixel', 'vector.combine.vec2'),
      node('load', 'image.load-pixel-clamped'), node('output', 'image.output')], edges: [edge('a', 'image', 'select', 'falseValue'),
      edge('b', 'image', 'select', 'trueValue'), edge('condition', 'value', 'select', 'condition'), edge('x', 'value', 'pixel', 'x'),
      edge('y', 'value', 'pixel', 'y'), edge('select', 'image', 'load', 'image'), edge('pixel', 'value', 'load', 'pixel'),
      edge('load', 'image', 'output', 'image')] };
    const plan = compileImageOperatorGraph(graph, {}, { namedImages: [
      { id: 'a', sampling: 'hardware-linear-clamp' }, { id: 'b', sampling: 'hardware-linear-clamp' }] });
    const calls: string[] = [], output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [4, 4],
      loadResource: (id, pixel) => { calls.push(`${id}:${pixel.join(',')}`); return id === 'b' ? [1, .5, .25, 1] : [0, 0, 0, 0]; } });
    expect(calls).toEqual(['b:1,2']); expect(output).toEqual([1, .5, .25, 1]);
    expect(plan.wgsl).toContain('loadImageGraphResource1(inputPixel)');
  });

  it('keeps a nested normalized sample in UV mode inside a pixel-load scope', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
      node('resource', 'image.named-input', undefined, { resource: 'field' }), node('uv', 'image.normalized-uv'), node('sample', 'image.sample'),
      node('x', 'values.number', { value: 1 }), node('y', 'values.number', { value: 1 }), node('pixel', 'vector.combine.vec2'),
      node('load', 'image.load-pixel-clamped'), node('output', 'image.output')], edges: [edge('resource', 'image', 'sample', 'image'),
      edge('uv', 'uv', 'sample', 'uv'), edge('sample', 'image', 'load', 'image'), edge('x', 'value', 'pixel', 'x'),
      edge('y', 'value', 'pixel', 'y'), edge('pixel', 'value', 'load', 'pixel'), edge('load', 'image', 'output', 'image')] };
    const plan = compileImageOperatorGraph(graph, {}, { namedImages: [{ id: 'field', sampling: 'hardware-linear-clamp' }] });
    expect(plan.instructions.some(item => item.operation === 'resource-input')).toBe(true);
    expect(plan.instructions.some(item => item.operation === 'resource-load-input')).toBe(false);
    const output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [4, 4],
      sampleImage: () => [0, 0, 0, 0], sampleResource: () => [.2, .3, .4, .5] });
    expect(output).toEqual([.2, .3, .4, .5]);
  });
});
