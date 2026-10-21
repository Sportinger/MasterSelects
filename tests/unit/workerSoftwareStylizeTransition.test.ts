import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types/layers';
import type { Effect } from '../../src/types/effects';
import { vignetteBloom } from '../../src/transitions/vignetteBloom';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';
import { applyWorkerSoftwareBloom, prepareWorkerSoftwareBloom } from '../../src/services/render/workerSoftwareBloom';
import { createDefaultGlowGraph } from '../../src/services/operators/glowBloomEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { getDefaultParams } from '../../src/effects';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import type { WorkerRenderSoftwareFrame } from '../../src/services/render/workerRenderHostRuntimeCommands';

type Values = Record<string, number | { from: number; to: number }>;
/** The params a Vignette Bloom effect step has at `share` (0 = start, 1 = end) of its own range. */
function stepParams(effectType: string, target: string, share: number): Record<string, number> {
  const step = vignetteBloom.recipe.find(item => item.kind === 'effect' && item.effectType === effectType && item.target === target);
  const values = (step as { params: Values }).params;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'number' ? value : value.from + (value.to - value.from) * share]));
}

/** A layer whose effects carry no graph, as the transition builds them at render time. */
function transitionLayer(params: { glow: Record<string, number>; vignette: Record<string, number> }): Layer {
  const effect = (type: string, values: Record<string, number>): Effect => ({ id: `${type}-a`, name: type, type, enabled: true, params: values } as Effect);
  return { id: 'outgoing', name: 'Outgoing', visible: true, opacity: 1, blendMode: 'normal', source: { type: 'solid', color: '#808080' },
    effects: [effect('glow', params.glow), effect('vignette', params.vignette)], position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0 } as Layer;
}

/** Runs the worker pixel pass on an RGBA8 raster through a minimal 2D context. */
function paint(pixels: Uint8ClampedArray, width: number, height: number, pixelEffects: WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']) {
  let output = pixels;
  const context = { getImageData: () => ({ data: new Uint8ClampedArray(pixels) }), putImageData: (image: ImageData) => { output = new Uint8ClampedArray(image.data); } };
  applyWorkerSoftwarePixelEffects(context as unknown as OffscreenCanvasRenderingContext2D, width, height, { pixelEffects } as WorkerRenderSoftwareFrame['layers'][number], 0);
  return output;
}

describe('worker software preview of graphless (transition) stylize effects', () => {
  it('reads Vignette Bloom Glow values as the current bloom: its halo reach follows Radius and stays inside the frame', () => {
    const width = 192, height = 108;
    const disc = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      disc.set(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) < 4 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * width + x) * 4);
    }
    const reach = (glow: Record<string, number>) => {
      const plan = workerSoftwareEffectPlanForLayer(transitionLayer({ glow, vignette: { amount: 0 } }));
      const adjustment = plan!.pixelEffects.glowAdjustments![0];
      expect(adjustment).toMatchObject({ recipe: 'bloom', radius: glow.radius });
      expect(adjustment.rings).toBeUndefined();
      const bloom = prepareWorkerSoftwareBloom(disc, width, height, adjustment);
      const ray = Array.from({ length: width / 2 }, (_, step) => applyWorkerSoftwareBloom(bloom, disc, width / 2 + step, height / 2)[0]);
      // The frame corner stays dark: the glow never washes the whole frame with edge colour.
      expect(applyWorkerSoftwareBloom(bloom, disc, 0, 0)[0]).toBeLessThan(2 / 255);
      return ray.findIndex(value => value < 2 / 255);
    };
    const start = reach(stepParams('glow', 'outgoing', 0)), peak = reach(stepParams('glow', 'outgoing', 1));
    expect(start).toBeGreaterThan(4);
    expect(peak).toBeGreaterThan(start);
    // Radius 240 of a 1080p frame is 24 px on this 108 px frame; the halo fades out near there.
    expect(peak).toBeLessThan(4 + 2 * 240 * height / 1080);
  });

  it('darkens the top and bottom edges like the left and right ones at Roundness 0 (frame-shaped falloff)', () => {
    const width = 96, height = 54, grey = new Uint8ClampedArray(width * height * 4).fill(200);
    const vignette = stepParams('vignette', 'outgoing', 1);
    expect(vignette.roundness).toBe(0);
    const plan = workerSoftwareEffectPlanForLayer(transitionLayer({ glow: { amount: 0 }, vignette }));
    const out = paint(grey, width, height, { brightness: 0, vignetteAdjustments: plan!.pixelEffects.vignetteAdjustments });
    const at = (x: number, y: number) => out[(y * width + x) * 4];
    const top = at(width / 2, 0), left = at(0, height / 2), centre = at(width / 2, height / 2), corner = at(0, 0);
    expect(centre).toBe(200);
    expect(top).toBeLessThan(170);
    expect(Math.abs(top - left)).toBeLessThanOrEqual(3);
    expect(corner).toBeLessThan(top);
  });

  it('follows the bloom graph: a light glows into its surroundings as the GPU recipe does', () => {
    const width = 192, height = 108, params = { ...getDefaultParams('glow'), amount: 2, threshold: 0.6, radius: 160 } as Record<string, number>;
    const disc = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const inside = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) < 4, offset = (y * width + x) * 4;
      disc.set(inside ? [255, 255, 255, 255] : [20, 20, 20, 255], offset);
    }
    const graph = new Uint8ClampedArray(disc);
    applyWorkerSoftwareImageGraphs(graph, width, height, [compileImageOperatorGraph(createDefaultGlowGraph(), params)], 0);
    const bloom = prepareWorkerSoftwareBloom(disc, width, height, { recipe: 'bloom', amount: 2, threshold: 0.6, radius: params.radius, softness: params.softness });
    for (const distance of [0, 5, 7, 10, 14, 20]) {
      const expected = graph[(height / 2 * width + width / 2 + distance) * 4] / 255;
      expect(Math.abs(applyWorkerSoftwareBloom(bloom, disc, width / 2 + distance, height / 2)[0] - expected)).toBeLessThan(6 / 255);
    }
    // Far outside the reach the frame keeps its colour.
    expect(applyWorkerSoftwareBloom(bloom, disc, 2, 2)[0]).toBeCloseTo(20 / 255, 2);
  });
});
