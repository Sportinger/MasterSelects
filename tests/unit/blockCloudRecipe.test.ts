import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultBlockCloudGraph } from '../../src/services/operators/blockCloudRecipe';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isMixedOut } from '../../src/engine/render/layerEffectStack';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const size: [number, number] = [96, 54];
const grey = (): Pixel => [.4, .4, .4, 1];
const PALETTE = [[0xef, 0x48, 0x9d], [0x80, 0xe9, 0xeb], [0xa8, 0xe7, 0x83]].map(rgb => rgb.map(value => value / 255));

function render(overrides: Params, image: (x: number, y: number) => Pixel = grey, time = 0.5) {
  const params = { ...getDefaultParams('block-cloud'), cellSize: 120, ...overrides };
  const plan = compileImageOperatorGraph(createDefaultBlockCloudGraph(), params, { parameterSchema: getEffect('block-cloud')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { timelineTimeSeconds: time });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]]);
}
function frame(output: (x: number, y: number) => Pixel) {
  const pixels: Pixel[] = [];
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) pixels.push(output(x, y));
  return pixels;
}
const covered = (pixels: Pixel[]) => pixels.filter(([r, g, b]) => Math.abs(r - .4) > 1e-3 || Math.abs(g - .4) > 1e-3 || Math.abs(b - .4) > 1e-3).length / pixels.length;

describe('Block Cloud recipe', () => {
  it('is a graph-owned image effect whose default graph compiles', () => {
    expect(isImageGraphEffectType('block-cloud')).toBe(true);
    const graph = effectOperatorGraph({ id: 'fx', name: 'Block Cloud', type: 'block-cloud', enabled: true, params: getDefaultParams('block-cloud') });
    expect(graph.nodes.filter(node => node.operator === 'noise.fractal2d.vec2').length).toBeGreaterThan(0);
  });

  it('returns the input exactly at Progress 0 (both Clear By modes) and is skipped there', () => {
    for (const clearBy of ['thin', 'wave']) {
      const pixels = frame(render({ progress: 0, clearBy, coverage: 3 }, (x, y) => [x / 96, y / 54, .3, 1]));
      pixels.forEach((pixel, index) => [(index % 96) / 96, Math.floor(index / 96) / 54, .3, 1].forEach((value, channel) => expect(pixel[channel]).toBeCloseTo(value, 12)));
    }
    expect(isMixedOut({ type: 'block-cloud', params: { progress: 0, amount: 1 } })).toBe(true);
  });

  it('covers a predictable share that falls with Progress', () => {
    // Many small clouds over many cells, so the frame shows the expected share (one big cloud may fill a frame).
    const many = { cellSize: 60, cloudSize: 1.5 };
    const full = covered(frame(render({ ...many, progress: 1 })));
    const half = covered(frame(render({ ...many, progress: 0.5 })));
    const late = covered(frame(render({ ...many, progress: 0.25 })));
    // Three levels of 0.22, 0.42 and 0.30 overlap to about 1 − 0.78 · 0.58 · 0.70 ≈ 0.68.
    expect(full).toBeGreaterThan(0.5); expect(full).toBeLessThan(0.85);
    expect(half).toBeLessThan(full); expect(late).toBeLessThan(half); expect(late).toBeGreaterThan(0);
  });

  it('draws only palette colours, at most Colour Count of them', () => {
    const pixels = frame(render({ progress: 1, recolor: 0 })).filter(([r]) => Math.abs(r - .4) > 1e-3);
    for (const [r, g, b] of pixels) expect(PALETTE.some(colour => Math.abs(colour[0] - r) < 1e-3 && Math.abs(colour[1] - g) < 1e-3 && Math.abs(colour[2] - b) < 1e-3)).toBe(true);
    const single = frame(render({ progress: 1, colorCount: 1 })).filter(([r]) => Math.abs(r - .4) > 1e-3);
    for (const [r] of single) expect(r).toBeCloseTo(PALETTE[0][0], 3);
  });

  it('keeps blocks inside the layer with Clip To Layer and draws over transparency with Whole Frame', () => {
    const cut = (x: number): Pixel => x < 48 ? [0, 0, 0, 0] : [.4, .4, .4, 1];
    const clipped = frame(render({ progress: 1 }, cut));
    clipped.forEach((pixel, index) => { if (index % 96 < 48) expect(pixel[3]).toBe(0); });
    const whole = frame(render({ progress: 1, clipTo: 'frame' }, cut));
    expect(whole.filter((pixel, index) => index % 96 < 48 && pixel[3] > .99).length).toBeGreaterThan(100);
  });

  it('clears behind a Wave Front: early Progress keeps the far side', () => {
    // Front Angle 0: the front sweeps left to right as Progress falls.
    const output = render({ progress: 0.4, clearBy: 'wave', frontAngle: 0, frontRoughness: 0 });
    const pixels = frame(output);
    const left = covered(pixels.filter((_, index) => index % 96 < 24)), right = covered(pixels.filter((_, index) => index % 96 >= 72));
    expect(left).toBe(0); expect(right).toBeGreaterThan(0.3);
  });

  it('moves with time and reports values outside the rendered range', () => {
    const a = frame(render({ progress: 1 }, grey, 0)), b = frame(render({ progress: 1 }, grey, 3));
    expect(a.some((pixel, index) => pixel[0] !== b[index][0])).toBe(true);
    const warnings = getEffect('block-cloud')!.paramWarnings!({ ...getDefaultParams('block-cloud'), coverage: 5, colorCount: 2.5, drift: -1 }).join(' ');
    expect(warnings).toMatch(/Coverage 5/); expect(warnings).toMatch(/Colour Count 2.5/); expect(warnings).toMatch(/Drift -1/);
  });
});
