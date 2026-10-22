import { describe, expect, it } from 'vitest';
import computeShader from '../../src/effects/geometry/compute.wgsl?raw';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';
import { voronoi, VORONOI_PRESETS } from '../../src/effects/geometry';

type Rgba = [number, number, number, number];
const SEED: [number, number] = [10, 10];
/** Every pixel's nearest seed is SEED (one cell over the whole test area). */
const context = (pixel: [number, number], loadImage: (pixel: [number, number]) => Rgba) => ({
  uv: [(pixel[0] + .5) / 1920, (pixel[1] + .5) / 1080] as [number, number], resolution: [1920, 1080] as [number, number],
  pixelCoordinate: pixel, timelineTimeSeconds: 0, loadImage,
  loadResource: (): Rgba => [SEED[0], SEED[1], 1, 0],
});
const evaluate = (amount: number, pixel: Rgba, load: (at: [number, number]) => Rgba, at: [number, number] = [3, 2]) =>
  createImageOperatorEvaluator(compileComputeImageGraph(createDefaultVoronoiGraph(), { scale: 24, speed: 0, amount }).imageProgram!)(
    pixel, context(at, position => position[0] === at[0] && position[1] === at[1] ? pixel : load(position)));

describe('Voronoi look', () => {
  it('keeps the pixel colour where the seed is transparent instead of painting the cell black', () => {
    const red: Rgba = [.8, .1, .1, 1];
    const transparentSeed = evaluate(1, red, at => at[0] === SEED[0] && at[1] === SEED[1] ? [0, 0, 0, 0] : red);
    expect(transparentSeed[0]).toBeCloseTo(.8 * .82, 5);
    expect(transparentSeed[3]).toBe(1);
    // An opaque seed still gives the whole cell its colour (the saved look of opaque footage).
    const blue: Rgba = [.1, .2, .9, 1];
    const opaqueSeed = evaluate(1, red, at => at[0] === SEED[0] && at[1] === SEED[1] ? blue : red);
    expect(opaqueSeed.slice(0, 3).map(value => Number(value.toFixed(5)))).toEqual(blue.slice(0, 3).map(value => Number((value * .82).toFixed(5))));
  });

  it('shows the original at Amount 0 and clamps Amount outside 0 to 1 with a note', () => {
    const pixel: Rgba = [.3, .6, .2, .7];
    const load = (at: [number, number]): Rgba => [at[0] / 32, at[1] / 32, .5, .7];
    expect(evaluate(0, pixel, load)).toEqual(pixel);
    expect(evaluate(1.5, pixel, load)).toEqual(evaluate(1, pixel, load));
    expect(evaluate(-1, pixel, load)).toEqual(pixel);
    expect(voronoi.paramWarnings?.({ amount: 1.5 })).toEqual(['amount: 1.5 is outside 0–1; the effect uses 1.']);
  });

  it('counts Cell Size in 1080p pixels and keeps every seed inside its own cell', () => {
    // The seed pass is a fixed WGSL stage (no CPU path): its cell size scales by the shorter side over 1080
    // and the seed is clamped to the pixels of its own cell, so a fractional cell size cannot drop a cell.
    expect(computeShader).toContain('max(2.0, max(4.0, params.scale) * min(params.resolution.x, params.resolution.y) / 1080.0)');
    expect(computeShader).toContain('clamp(seedRaw, cellFirst, cellLast)');
    expect(voronoi.params.scale).toMatchObject({ label: 'Cell Size', unit: ' px', default: 24, min: 4, max: 96 });
    expect(voronoi.paramWarnings?.({ scale: 2 })).toEqual(['scale: 2 is below 4 px; Voronoi uses cells of 4 px (of a 1080p frame).']);
    expect(voronoi.paramWarnings?.({ scale: 24, amount: .8 })).toEqual([]);
  });

  it('retires the unused Threshold, follows the timeline clock and declares four presets inside the slider ranges', () => {
    expect(voronoi.params.threshold.deprecated).toBe('Voronoi has no Threshold; the value is ignored.');
    expect(voronoi.params.threshold.hidden).toBe(true);
    expect(createDefaultVoronoiGraph().nodes.some(node => Object.values(node.bindings).includes('threshold'))).toBe(false);
    expect(voronoi.requiresContinuousRender).toBe(false);
    expect(voronoi.timelineAnimated).toBe(true);
    expect(VORONOI_PRESETS.map(preset => preset.name)).toEqual(['Stained Glass', 'Fine Crackle', 'Glass Veil', 'Drifting Shards']);
    for (const preset of VORONOI_PRESETS) {
      for (const [key, value] of Object.entries(preset.params)) {
        const param = voronoi.params[key];
        expect(param, `${preset.name}.${key}`).toBeDefined();
        expect(param.deprecated, `${preset.name}.${key}`).toBeUndefined();
        if (param.type !== 'number') continue;
        expect(value as number).toBeGreaterThanOrEqual(param.min!);
        expect(value as number).toBeLessThanOrEqual(param.max!);
      }
    }
  });
});
