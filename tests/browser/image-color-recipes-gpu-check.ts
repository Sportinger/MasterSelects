import { getDefaultParams, getEffect } from '../../src/effects';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { renderDefinition } from './image-color-effects-gpu-check';

/**
 * The 2026-10 color recipes on the GPU against the CPU evaluator (the worker software and test
 * reference path): the hand-written WGSL helpers (sRGB transfer, OkLCh, HSV) and the emitted
 * curve math must agree within one 8-bit step on every texel, including extreme parameters.
 */
const cases: Array<[EditableColorEffectType, Record<string, number>]> = [
  ['brightness', { amount: 0.6 }], ['brightness', { amount: -1 }], ['brightness', { amount: 4 }],
  ['contrast', { amount: 2.5 }], ['contrast', { amount: 0.2 }], ['saturation', { amount: 3 }], ['saturation', { amount: 0 }],
  ['vibrance', { amount: 1 }], ['vibrance', { amount: -1 }],
  ['exposure', { exposure: 1.5, offset: 0.02, gamma: 1.3 }], ['exposure', { exposure: -2.2 }], ['exposure', { gamma: 0 }],
  ['levels', { inputBlack: 0.1, inputWhite: 0.85, gamma: 1.6, outputBlack: 0.05 }], ['levels', { inputBlack: 0.5, inputWhite: 0.5 }],
  ['hue-shift', { shift: 0.25 }], ['hue-shift', { shift: 0.61 }], ['hue-shift', { shift: -0.4 }],
  ['temperature', { temperature: 0.8, tint: -0.4 }], ['temperature', { temperature: -0.6 }],
];

/** Lab-image colours (skin, stage, haze, sky, neon), saturated primaries and a grey ramp; opaque so 8-bit RGB is exact. */
function fixture(size: number): Uint8Array<ArrayBuffer> {
  const named = [[224, 172, 151], [167, 151, 135], [68, 42, 25], [32, 59, 76], [86, 140, 200], [8, 7, 25], [237, 64, 199],
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [0, 0, 0], [255, 255, 255], [250, 120, 20]];
  const pixels = new Uint8Array(size * 4);
  for (let x = 0; x < size; x++) {
    const colour = x < named.length ? named[x] : [(x * 37) % 256, (x * 91 + 17) % 256, (x * 53 + 101) % 256];
    pixels.set([...colour, 255], x * 4);
  }
  return pixels;
}

export async function checkColorRecipesGpu(device: GPUDevice): Promise<number> {
  const size = 64, pixels = fixture(size); // 64 × 4 bytes: copyTextureToBuffer rows must be 256-byte aligned
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const source = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, 1]);
  let comparisons = 0;
  try {
    for (const [type, overrides] of cases) {
      const params = { ...getDefaultParams(type), ...overrides } as Record<string, number>;
      const graph = createDefaultColorEffectGraph(type);
      const definition = imageGraphDefinition({ type, params, operatorGraph: graph }, getEffect(type) as FullscreenEffectDefinition);
      const gpu = await renderDefinition(device, sampler, source.createView(), target, readback, definition, params, size);
      const plan = compileImageOperatorGraph(graph, params);
      for (let x = 0; x < size; x++) {
        const cpu = evaluateImageOperatorPlan(plan, [...pixels.subarray(x * 4, x * 4 + 4)].map(value => value / 255) as [number, number, number, number]);
        for (let channel = 0; channel < 4; channel++) {
          const expected = Math.round(Math.min(1, Math.max(0, cpu[channel])) * 255), actual = gpu[x * 4 + channel];
          if (Math.abs(actual - expected) > 1) {
            throw new Error(`${type} ${JSON.stringify(overrides)} texel ${x} channel ${channel}: GPU ${actual}, CPU ${expected} (input ${[...pixels.subarray(x * 4, x * 4 + 4)]})`);
          }
        }
      }
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
