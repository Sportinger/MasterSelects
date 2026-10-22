import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph, compileComputeImagePreview } from '../../src/services/operators/computeImageGraph';
import { createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';
import { quadtreeZoom, QUADTREE_ZOOM_PRESETS } from '../../src/effects/geometry';

type Rgba = [number, number, number, number];
const context = (pixel: [number, number], resolution: [number, number], loadImage: (pixel: [number, number]) => Rgba) => ({
  uv: [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]] as [number, number], resolution, pixelCoordinate: pixel,
  timelineTimeSeconds: 0, loadImage,
});

describe('Quadtree Zoom look', () => {
  it('counts Minimum Cell in 1080p pixels, so preview quality, 1080p and 4K split into the same cells', () => {
    // A negative threshold never stops the split, so every cell ends at Minimum Cell.
    const plan = compileComputeImagePreview(createDefaultQuadtreeGraph(), { scale: 8, threshold: -1, speed: 0, amount: 1 },
      { nodeId: 'partition', direction: 'output', portId: 'size' }).plan;
    const size = (resolution: [number, number]) => createImageOperatorEvaluator(plan)([0, 0, 0, 1],
      context([5, 5], resolution, () => [.5, .5, .5, 1]))[0];
    expect(size([960, 540])).toBe(4);
    expect(size([1920, 1080])).toBe(8);
    expect(size([3840, 2160])).toBe(16);
    // Portrait frames measure the shorter side too.
    expect(size([1080, 1920])).toBe(8);
  });

  it('splits a large block when a figure lies between its corners and centre (4 x 4 grid test)', () => {
    const plan = compileComputeImagePreview(createDefaultQuadtreeGraph(), { scale: 8, threshold: .025, speed: 0, amount: 1 },
      { nodeId: 'partition', direction: 'output', portId: 'size' }).plan;
    // A bright figure inside the first 256 px block, away from its corners and centre: the five legacy
    // test pixels all read the dark stage and kept one 256 px block over it.
    const figure = (pixel: [number, number]): Rgba => pixel[0] >= 80 && pixel[0] <= 112 && pixel[1] >= 144 && pixel[1] <= 176
      ? [.9, .85, .8, 1] : [.04, .03, .03, 1];
    expect(createImageOperatorEvaluator(plan)([0, 0, 0, 1], context([96, 160], [1920, 1080], figure))[0]).toBeLessThan(256);
    // A flat block stays whole, and the grid only refines: it never merges what the five pixels split.
    expect(createImageOperatorEvaluator(plan)([0, 0, 0, 1], context([600, 600], [1920, 1080], () => [.04, .03, .03, 1]))[0]).toBe(256);
  });

  it('keeps the pixel colour where the cell centre is transparent instead of painting the tile black', () => {
    const program = compileComputeImageGraph(createDefaultQuadtreeGraph(), { scale: 8, threshold: -1, speed: 0, amount: 1 }).imageProgram!;
    const red: Rgba = [.8, .1, .1, 1];
    // 8 px cells at 1080p: the cell of pixel (1, 1) has its centre at (4, 4), which is transparent.
    const load = (pixel: [number, number]): Rgba => pixel[0] === 4 && pixel[1] === 4 ? [0, 0, 0, 0] : red;
    const result = createImageOperatorEvaluator(program)(red, context([1, 1], [1920, 1080], load));
    expect(result[0]).toBeCloseTo(.8 * .82, 5);
    expect(result[3]).toBe(1);
    // An opaque centre still gives the whole tile its colour (the saved look of opaque footage).
    const blue: Rgba = [.1, .2, .9, 1];
    const opaque = createImageOperatorEvaluator(program)(red, context([1, 1], [1920, 1080], pixel => pixel[0] === 4 && pixel[1] === 4 ? blue : red));
    expect(opaque.slice(0, 3).map(value => Number(value.toFixed(5)))).toEqual(blue.slice(0, 3).map(value => Number((value * .82).toFixed(5))));
  });

  it('shows the original at Amount 0 and clamps Amount outside 0 to 1 with a note', () => {
    const pixel: Rgba = [.3, .6, .2, .7];
    const load = (at: [number, number]): Rgba => [at[0] / 32, at[1] / 32, .5, .7];
    const evaluate = (amount: number) => createImageOperatorEvaluator(compileComputeImageGraph(createDefaultQuadtreeGraph(),
      { scale: 8, threshold: -1, speed: 0, amount }).imageProgram!)(pixel, context([3, 2], [1920, 1080], at => at[0] === 3 && at[1] === 2 ? pixel : load(at)));
    expect(evaluate(0)).toEqual(pixel);
    expect(evaluate(1.5)).toEqual(evaluate(1));
    expect(quadtreeZoom.paramWarnings?.({ amount: 1.5 })).toEqual(['amount: 1.5 is outside 0–1; the effect uses 1.']);
  });

  it('reports cells below 2 rendered pixels and declares four presets inside the slider ranges', () => {
    expect(quadtreeZoom.paramWarnings?.({ scale: 2 }, 960, 540)).toEqual([
      'scale: 2 is below 2 rendered pixels at 960×540; Quadtree Zoom uses cells of 2 pixels.']);
    expect(quadtreeZoom.paramWarnings?.({ scale: 8 }, 1920, 1080)).toEqual([]);
    expect(quadtreeZoom.requiresContinuousRender).toBe(false);
    expect(quadtreeZoom.timelineAnimated).toBe(true);
    expect(QUADTREE_ZOOM_PRESETS.map(preset => preset.name)).toEqual(['Fine Print', 'Big Tiles', 'Tile Veil', 'Breathing Grid']);
    for (const preset of QUADTREE_ZOOM_PRESETS) {
      for (const [key, value] of Object.entries(preset.params)) {
        const param = quadtreeZoom.params[key];
        expect(param, `${preset.name}.${key}`).toBeDefined();
        if (param.type !== 'number') continue;
        expect(value as number).toBeGreaterThanOrEqual(param.min!);
        expect(value as number).toBeLessThanOrEqual(param.max!);
      }
    }
  });
});
