import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultAsciiGraph } from '../../src/services/operators/asciiEffectGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sourceSample = ([u, v]: [number, number]): Rgba => [u, v, .25, .6];
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const compileContext = {
  parameterSchema: getEffect('ascii')!.params,
  resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }),
};

function reference(params: { amount: number; cellSize: number; invert: boolean; colorMode: 'source' | 'duotone' }, uv: [number, number],
  resolution: [number, number], colorA: number[], colorB: number[]) {
  const grid: [number, number] = [resolution[0] / Math.max(params.cellSize, 2), resolution[1] / Math.max(params.cellSize, 2)];
  const id: [number, number] = [Math.floor(uv[0] * grid[0]), Math.floor(uv[1] * grid[1])];
  const local: [number, number] = [uv[0] * grid[0] - id[0], uv[1] * grid[1] - id[1]];
  const sourceUv: [number, number] = [(id[0] + .5) / grid[0], (id[1] + .5) / grid[1]];
  const source = sourceSample(sourceUv), tone = source[0] * .2126 + source[1] * .7152 + source[2] * .0722;
  const mapped = params.invert ? 1 - tone : tone, index = Math.floor(Math.max(0, Math.min(.99999, mapped)) * 4);
  const atlasUv: [number, number] = [(index % 2 + Math.max(.001, Math.min(.999, local[0]))) / 2,
    (Math.floor(index / 2) + Math.max(.001, Math.min(.999, local[1]))) / 2];
  const alpha = atlasUv[0] * .4 + atlasUv[1] * .3;
  const duotone = source.slice(0, 3).map((_value, channel) => mix(colorA[channel], colorB[channel], tone));
  const ink = params.colorMode === 'source' ? source.slice(0, 3) : duotone;
  const background = params.colorMode === 'source' ? source.slice(0, 3).map(value => value * .08) : colorA.map(value => value * .15);
  const glyph = ink.map((value, channel) => mix(background[channel], value, alpha));
  return { atlasUv, output: [...source.slice(0, 3).map((value, channel) => mix(value, glyph[channel], params.amount)), source[3]] as Rgba };
}

describe('ASCII image graph', () => {
  it('is a bounded granular graph backed by the canonical glyph atlas producer', () => {
    const graph = createDefaultAsciiGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    expect(graph.nodes.filter(node => node.operator === 'glyph.atlas')).toHaveLength(1);
    expect(graph.nodes.some(node => node.operator.includes('ascii'))).toBe(false);
    expect(graph.nodes.find(node => node.id === 'atlas')?.bindings).toEqual({
      rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight',
    });
  });

  it.each([{ colorMode: 'source' as const, invert: false }, { colorMode: 'duotone' as const, invert: true }])
  ('matches legacy cell, ramp, atlas alpha and $colorMode ink with invert=$invert', scenario => {
    const params = { amount: .75, cellSize: 10, ...scenario, colorA: '#204060', colorB: '#e0c080',
      rampPreset: 'standard', customRamp: '', fontFamily: 'monospace', fontWeight: 600 };
    const uv: [number, number] = [.3, .7], resolution: [number, number] = [40, 20], colorA = [0x20 / 255, 0x40 / 255, 0x60 / 255], colorB = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const expected = reference(params, uv, resolution, colorA, colorB), atlasCalls: Array<[string, number, number]> = [];
    const plan = compileImageOperatorGraph(createDefaultAsciiGraph(), params, compileContext);
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, sampleImage: sourceSample,
      sampleResource: (id, coords) => { atlasCalls.push([id, ...coords]); return [0, 0, 0, coords[0] * .4 + coords[1] * .3]; } });
    expect(atlasCalls).toHaveLength(1);
    expect(atlasCalls[0][0]).toBe('glyph-atlas:atlas');
    expect(atlasCalls[0].slice(1)).toEqual(expected.atlasUv);
    expected.output.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 12));
    expect(actual[3]).toBe(.6);
  });
});
