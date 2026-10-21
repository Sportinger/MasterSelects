// The worker CPU's hand-written Threshold, Posterize, Vignette and Scanlines (graphless effects:
// the per-pixel loop and the whole-frame steps in front of a mirror/pixel effect) follow the
// current stylize recipes (2026-10-21) within one 8-bit step of the graphs.
import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { Layer } from '../../src/types/layers';
import type { WorkerRenderSoftwareFrame } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { getDefaultParams } from '../../src/effects';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { createStylizeRecipeGraph } from '../../src/services/operators/stylizeRecipes';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';
import { applyWorkerSoftwarePointwiseFrame, isWorkerSoftwarePointwiseEffect, workerSoftwarePointwiseStep } from '../../src/services/render/workerSoftwarePointwiseEffects';

type Params = Record<string, number | boolean>;
const effectOf = (type: string, params: Params): Effect => ({ id: `${type}-a`, name: type, type, enabled: true,
  params: { ...getDefaultParams(type), ...params } } as Effect);

/** Colour gradients over the frame, opaque, so every step sees many values. */
function picture(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).map((_, index) => {
    const pixel = index >> 2, x = pixel % width, y = Math.floor(pixel / width);
    return [Math.round(x / (width - 1) * 255), Math.round(y / (height - 1) * 255), (x * 7 + y * 13) % 256, 255][index & 3];
  });
}

/** The current recipe graph on the CPU (the GPU path's math). */
function graph(type: string, params: Params, pixels: Uint8ClampedArray, width: number, height: number, time: number) {
  const data = pixels.slice();
  const effect = { ...effectOf(type, params), operatorGraph: createStylizeRecipeGraph(type)! };
  applyWorkerSoftwareImageGraphs(data, width, height, [prepareImageEffect(effect).plan!], time);
  return data;
}

/** The graphless effect through the worker plan's per-pixel loop. */
function loop(type: string, params: Params, pixels: Uint8ClampedArray, width: number, height: number, time: number) {
  const plan = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effectOf(type, params)] } as unknown as Layer)!;
  expect(plan.pixelEffects.imageOperatorPlans).toBeUndefined();
  let output = pixels;
  const context = { getImageData: () => ({ data: new Uint8ClampedArray(pixels) }), putImageData: (image: ImageData) => { output = new Uint8ClampedArray(image.data); } };
  applyWorkerSoftwarePixelEffects(context as unknown as OffscreenCanvasRenderingContext2D, width, height,
    { pixelEffects: plan.pixelEffects } as WorkerRenderSoftwareFrame['layers'][number], time);
  return output;
}

/** The same effect as a whole-frame step (in front of a mirror/pixel effect). */
function step(type: string, params: Params, pixels: Uint8ClampedArray, width: number, height: number, time: number) {
  const frame = Float32Array.from(pixels, value => value / 255);
  applyWorkerSoftwarePointwiseFrame(frame, width, height, workerSoftwarePointwiseStep(type, effectOf(type, params).params)!, time);
  return Uint8ClampedArray.from(frame, value => Math.round(value * 255));
}

const largestDifference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((worst, value, index) => Math.max(worst, Math.abs(value - b[index])), 0);

describe('worker CPU stylize steps follow the current recipes', () => {
  const cases: Array<[string, Params, number?]> = [
    ['threshold', { level: 0.45 }], ['threshold', { level: 0.5, softness: 0.3 }],
    ['posterize', { levels: 4 }], ['posterize', { levels: 5, softness: 0.4 }],
    ['posterize', { levels: 4, brightnessOnly: true }], ['posterize', { levels: 3, softness: 0.5, brightnessOnly: true }],
    ['vignette', { amount: 0.8, size: 0.3, softness: 0.4, roundness: 1 }], ['vignette', { amount: 0.6, size: 0.2, softness: 0, roundness: 0 }],
    ['vignette', { amount: -0.5, size: 0.4, softness: 0.3, roundness: 0.5 }],
    // 0.5 is about 8 lines on 90 px (visible); 5 is about 1 px apart: faded into an even darkening.
    ['scanlines', { density: 0.5, opacity: 0.6, speed: 1 }, 0.7], ['scanlines', { density: 5, opacity: 1.4, speed: 0 }],
  ];
  for (const [width, height] of [[160, 90], [90, 160]]) {
    for (const [type, params, time = 0] of cases) {
      it(`${type} ${JSON.stringify(params)} at ${width}x${height}`, () => {
        const input = picture(width, height), reference = graph(type, params, input, width, height, time);
        expect(largestDifference(reference, input), 'the effect changes the picture').toBeGreaterThan(20);
        expect(largestDifference(loop(type, params, input, width, height, time), reference)).toBeLessThanOrEqual(1);
        expect(largestDifference(step(type, params, input, width, height, time), reference)).toBeLessThanOrEqual(1);
      });
    }
  }

  it('leaves Film Grain to its graph: it has no hand-written step', () => {
    expect(isWorkerSoftwarePointwiseEffect('grain')).toBe(false);
    const plan = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effectOf('grain', {})] } as unknown as Layer)!;
    expect(plan.pixelEffects.grainAdjustments).toBeUndefined();
    expect(plan.pixelEffects.imageOperatorPlans).toHaveLength(1);
  });
});
