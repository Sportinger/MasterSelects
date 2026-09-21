import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultBrightnessGraph, createDefaultContrastGraph } from '../../src/services/operators/colorEffectGraphs';
import { compileImageOperatorGraph, createDefaultInvertImageGraph, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
const rasterizeGlyphAtlas = vi.hoisted(() => vi.fn());
vi.mock('../../src/effects/_shared/glyphAtlasRaster', () => ({ rasterizeGlyphAtlas }));
import { applyWorkerSoftwareImageGraphs, canApplyWorkerSoftwareImageGraphPlan, clearWorkerSoftwareGlyphAtlasCache } from '../../src/services/render/workerSoftwareImageGraphs';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (id: string, from: string, output: string, to: string, input: string): OperatorEdge => ({ id, from, output, to, input });
function samplingGraph(u?: number, v?: number): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('u', 'values.number', u ?? -1 / 3),
    node('v', 'values.number', v ?? 0), node('offset', 'vector.combine.vec2'), node('sample-uv', 'math.add.vec2'),
    node('sample', 'image.sample'), node('output', 'image.output')];
  const edges = [edge('u-offset', 'u', 'value', 'offset', 'x'), edge('v-offset', 'v', 'value', 'offset', 'y'),
    edge('frame-sample', 'frame', 'image', 'sample', 'image'), edge('sample-output', 'sample', 'image', 'output', 'image')];
  if (u === undefined) edges.push(edge('uv-add', 'uv', 'uv', 'sample-uv', 'a'), edge('offset-add', 'offset', 'value', 'sample-uv', 'b'),
    edge('add-sample', 'sample-uv', 'value', 'sample', 'uv'));
  else edges.push(edge('offset-sample', 'offset', 'value', 'sample', 'uv'));
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index, y: 0 }])) };
}

function pixelLoadGraph(x: number, y: number): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('x', 'values.number', x), node('y', 'values.number', y),
    node('pixel', 'vector.combine.vec2'), node('load', 'image.load-pixel-clamped'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges: [
    edge('x-pixel', 'x', 'value', 'pixel', 'x'), edge('y-pixel', 'y', 'value', 'pixel', 'y'),
    edge('frame-load', 'frame', 'image', 'load', 'image'), edge('pixel-load', 'pixel', 'value', 'load', 'pixel'),
    edge('load-output', 'load', 'image', 'output', 'image'),
  ], layout: {} };
}

const identityGraph: EffectOperatorGraph = {
  version: 1, schemaVersion: 1, domain: 'image', nodes: [node('frame', 'image.frame'), node('output', 'image.output')],
  edges: [edge('frame-output', 'frame', 'image', 'output', 'image')], layout: { frame: { x: 0, y: 0 }, output: { x: 1, y: 0 } },
};

function derivativeImageGraph(mode: 'auto' | 'fine' | 'coarse'): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('sample', 'image.sample'),
    node('luma', 'color.luminance-rec709.image'), node('derivative', `image.derivative.${mode}.scalar`),
    node('gradient', 'vector.split.vec2'), node('zero', 'values.number', 0), node('vector', 'vector.combine.vec3'),
    node('rgb', 'convert.vec3-to-rgb'), node('split', 'vector.split.rgba'), node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  const edges = [edge('frame-sample', 'frame', 'image', 'sample', 'image'), edge('uv-sample', 'uv', 'uv', 'sample', 'uv'),
    edge('sample-luma', 'sample', 'image', 'luma', 'image'), edge('luma-derivative', 'luma', 'value', 'derivative', 'value'),
    edge('derivative-gradient', 'derivative', 'gradient', 'gradient', 'value'), edge('x-vector', 'gradient', 'x', 'vector', 'x'),
    edge('y-vector', 'gradient', 'y', 'vector', 'y'), edge('zero-vector', 'zero', 'value', 'vector', 'z'),
    edge('vector-rgb', 'vector', 'value', 'rgb', 'value'), edge('sample-split', 'sample', 'image', 'split', 'image'),
    edge('rgb-combine', 'rgb', 'rgb', 'combine', 'rgb'), edge('alpha-combine', 'split', 'alpha', 'combine', 'alpha'),
    edge('combine-output', 'combine', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} };
}

describe('worker software image graphs', () => {
  beforeEach(() => { clearWorkerSoftwareGlyphAtlasCache(); rasterizeGlyphAtlas.mockReset(); });
  it('applies canonical identity and rewrite graphs while preserving straight alpha', () => {
    const original = new Uint8ClampedArray([20, 80, 160, 37, 200, 40, 10, 219]);
    const identity = original.slice();
    applyWorkerSoftwareImageGraphs(identity, 2, 1, [compileImageOperatorGraph(identityGraph)], 0);
    expect(identity).toEqual(original);
    applyWorkerSoftwareImageGraphs(identity, 2, 1, [compileImageOperatorGraph(createDefaultInvertImageGraph())], 0);
    expect([...identity]).toEqual([235, 175, 95, 37, 55, 215, 245, 219]);
  });

  it('bilinearly samples all four straight-alpha channels at normalized coordinates', () => {
    const data = new Uint8ClampedArray([0, 20, 40, 60, 100, 120, 140, 160, 200, 180, 160, 140, 40, 60, 80, 100]);
    applyWorkerSoftwareImageGraphs(data, 2, 2, [compileImageOperatorGraph(samplingGraph(.5, .5))], 0);
    expect([...data]).toEqual(Array(4).fill([85, 95, 105, 115]).flat());
  });

  it('snapshots each program input so sampling cannot observe earlier output pixels', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40, 90, 100, 110, 120, 210, 220, 230, 240]);
    applyWorkerSoftwareImageGraphs(data, 3, 1, [compileImageOperatorGraph(samplingGraph())], 0);
    expect([...data]).toEqual([10, 20, 30, 40, 10, 20, 30, 40, 90, 100, 110, 120]);
  });

  it('loads exact integer-truncated source pixels with clamp and without in-place contamination', () => {
    const source = new Uint8ClampedArray([10, 20, 30, 40, 90, 100, 110, 120, 210, 220, 230, 240]);
    const plan = compileImageOperatorGraph(pixelLoadGraph(1.9, .8));
    expect(canApplyWorkerSoftwareImageGraphPlan(plan)).toBe(true);
    const fractional = source.slice();
    applyWorkerSoftwareImageGraphs(fractional, 3, 1, [plan], 0);
    expect([...fractional]).toEqual(Array(3).fill([90, 100, 110, 120]).flat());
    const negative = source.slice();
    applyWorkerSoftwareImageGraphs(negative, 3, 1, [compileImageOperatorGraph(pixelLoadGraph(-4.2, 9.7))], 0);
    expect([...negative]).toEqual(Array(3).fill([10, 20, 30, 40]).flat());
    const oversize = source.slice();
    applyWorkerSoftwareImageGraphs(oversize, 3, 1, [compileImageOperatorGraph(pixelLoadGraph(99.8, 0))], 0);
    expect([...oversize]).toEqual(Array(3).fill([210, 220, 230, 240]).flat());
  });

  it('applies stacked programs in order with rgba8 quantization between programs', () => {
    const data = new Uint8ClampedArray([51, 51, 51, 127]);
    const brightness = compileImageOperatorGraph(createDefaultBrightnessGraph(), { amount: .2 });
    const contrast = compileImageOperatorGraph(createDefaultContrastGraph(), { amount: 2 });
    applyWorkerSoftwareImageGraphs(data, 1, 1, [brightness, contrast], 0);
    expect([...data]).toEqual([77, 77, 77, 127]);
  });

  it('defines automatic derivatives as coarse while preserving explicit fine derivatives and alpha', () => {
    const source = new Uint8ClampedArray([0, 0, 0, 31, 51, 51, 51, 47, 102, 102, 102, 63, 255, 255, 255, 79]);
    const coarse = source.slice(), automatic = source.slice(), fine = source.slice();
    applyWorkerSoftwareImageGraphs(coarse, 2, 2, [compileImageOperatorGraph(derivativeImageGraph('coarse'))], 0);
    applyWorkerSoftwareImageGraphs(automatic, 2, 2, [compileImageOperatorGraph(derivativeImageGraph('auto'))], 0);
    applyWorkerSoftwareImageGraphs(fine, 2, 2, [compileImageOperatorGraph(derivativeImageGraph('fine'))], 0);
    expect(automatic).toEqual(coarse);
    expect([...coarse.slice(12, 16)]).toEqual([51, 102, 0, 79]);
    expect([...fine.slice(12, 16)]).toEqual([153, 204, 0, 79]);
  });

  it('supplies valid derivative quad context at an odd raster edge', () => {
    const data = new Uint8ClampedArray(Array.from({ length: 9 }, (_, index) => [index * 17, index * 17, index * 17, 20 + index]).flat());
    applyWorkerSoftwareImageGraphs(data, 3, 3, [compileImageOperatorGraph(derivativeImageGraph('auto'))], 0);
    expect(data).toHaveLength(36);
    expect(data[35]).toBe(28);
  });

  it('fails closed for materialized passes and missing resource descriptors', () => {
    const plan = compileImageOperatorGraph(identityGraph), data = new Uint8ClampedArray([0, 0, 0, 255]);
    expect(() => applyWorkerSoftwareImageGraphs(data, 1, 1, [{ ...plan, resourceInputs: ['prior'] }], 0)).toThrow(/has no glyph-atlas descriptor/);
    const passPlan: ImageOperatorPlan = { ...plan, passes: [{ id: 'pass', program: plan, inputResources: [] }] };
    expect(() => applyWorkerSoftwareImageGraphs(data, 1, 1, [passPlan], 0)).toThrow(/materialized passes/);
  });

  it('samples rasterized glyph RGBA through the canonical resource callback and bounded cache identity', () => {
    rasterizeGlyphAtlas.mockImplementation((options: { charset: string }) => {
      const rgba = options.charset === 'A' ? [32, 96, 160, 77] : [240, 120, 20, 199];
      return { plan: { width: 1, height: 1 }, canvas: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(rgba) }) }) } };
    });
    const base = compileImageOperatorGraph(identityGraph);
    const external = (charset: string): ImageOperatorPlan => ({ ...base, capabilities: ['uv'],
      instructions: [{ nodeId: 'atlas', operation: 'resource-input', type: 'image', inputs: [], value: 0 }], output: 0,
      resourceInputs: ['glyph-atlas:atlas'], resourceSampling: ['hardware-linear-clamp'],
      externalResources: [{ id: 'glyph-atlas:atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset, cellSize: 32 } }] });
    const first = new Uint8ClampedArray([0, 0, 0, 0]);
    applyWorkerSoftwareImageGraphs(first, 1, 1, [external('A')], 0);
    expect([...first]).toEqual([32, 96, 160, 77]);
    applyWorkerSoftwareImageGraphs(first, 1, 1, [external('A')], 0);
    expect(rasterizeGlyphAtlas).toHaveBeenCalledTimes(1);
    applyWorkerSoftwareImageGraphs(first, 1, 1, [external('B')], 0);
    expect([...first]).toEqual([240, 120, 20, 199]);
    expect(rasterizeGlyphAtlas).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 16; index++) applyWorkerSoftwareImageGraphs(first, 1, 1, [external(`cache-${index}`)], 0);
    applyWorkerSoftwareImageGraphs(first, 1, 1, [external('A')], 0);
    expect(rasterizeGlyphAtlas).toHaveBeenCalledTimes(19);
  });

  it('loads a real glyph resource with output-lattice coordinates and resource-owned stride/clamp', () => {
    rasterizeGlyphAtlas.mockReturnValue({ plan: { width: 2, height: 1 }, canvas: { getContext: () => ({ getImageData: () => ({
      data: new Uint8ClampedArray([12, 34, 56, 78, 210, 190, 170, 150]),
    }) }) } });
    const nodes = [node('atlas', 'glyph.atlas'), node('x', 'values.number', 2.9), node('y', 'values.number', 0),
      node('pixel', 'vector.combine.vec2'), node('load', 'image.load-pixel-clamped'), node('output', 'image.output')];
    nodes[0].bindings = { rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' };
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', nodes, layout: {}, edges: [
      edge('atlas-load', 'atlas', 'image', 'load', 'image'), edge('x-pixel', 'x', 'value', 'pixel', 'x'),
      edge('y-pixel', 'y', 'value', 'pixel', 'y'), edge('pixel-load', 'pixel', 'value', 'load', 'pixel'),
      edge('load-output', 'load', 'image', 'output', 'image'),
    ] };
    const plan = compileImageOperatorGraph(graph, { rampPreset: 'custom', customRamp: 'AB', fontFamily: 'mono', fontWeight: 600 }, {
      resolveGlyphAtlas: () => ({ fontFamily: 'mono', charset: 'AB', cellSize: 32 }),
    });
    expect(plan.instructions.some(item => item.operation === 'resource-load-input')).toBe(true);
    expect(canApplyWorkerSoftwareImageGraphPlan(plan)).toBe(true);
    const data = new Uint8ClampedArray(3 * 1 * 4);
    applyWorkerSoftwareImageGraphs(data, 3, 1, [plan], 0);
    expect([...data]).toEqual(Array(3).fill([210, 190, 170, 150]).flat());
  });

  it('rejects conflicting glyph descriptors before mutating pixels', () => {
    const base = compileImageOperatorGraph(identityGraph), data = new Uint8ClampedArray([9, 8, 7, 6]);
    const plan: ImageOperatorPlan = { ...base, resourceInputs: ['atlas'], externalResources: [
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset: 'A', cellSize: 32 } },
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset: 'B', cellSize: 32 } },
    ] };
    expect(() => applyWorkerSoftwareImageGraphs(data, 1, 1, [plan], 0)).toThrow(/conflicting descriptors/);
    expect([...data]).toEqual([9, 8, 7, 6]);
    expect(rasterizeGlyphAtlas).not.toHaveBeenCalled();
  });
});
