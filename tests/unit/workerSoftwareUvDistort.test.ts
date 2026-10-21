// The worker CPU fallback renders built-in Wave, Twirl and Bulge & Pinch with a hand-written pass
// (the graph interpreter is far slower). It must match the graph pixel for pixel, including
// premultiplied filtering at cut-outs, every Frame Edges mode, both shapes and travelling waves.
import { describe, expect, it } from 'vitest';
import type { Effect, Layer } from '../../src/types';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';
import { getDefaultEffectParams } from '../../src/stores/timeline/utils';

const WIDTH = 32, HEIGHT = 18;

/** Colour ramps with an opaque disc, a soft alpha ramp and a fully transparent corner. */
function sourcePixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const offset = (y * WIDTH + x) * 4, disc = Math.hypot(x - 13, y - 9) < 6;
    data[offset] = x * 8; data[offset + 1] = y * 14; data[offset + 2] = (x * y * 5) % 256;
    data[offset + 3] = disc ? 255 : x > 26 && y < 5 ? 0 : Math.round(40 + x * 6);
  }
  return data;
}

function render(pixelEffects: object, time: number): Uint8ClampedArray {
  const data = sourcePixels(), imageData = { data };
  const context = { getImageData: () => imageData, putImageData: () => undefined } as unknown as OffscreenCanvasRenderingContext2D;
  applyWorkerSoftwarePixelEffects(context, WIDTH, HEIGHT, { pixelEffects } as never, time);
  return data;
}

const effectOf = (type: 'wave' | 'twirl' | 'bulge', params: Record<string, number | string>, operatorGraph?: Effect['operatorGraph']): Effect =>
  ({ id: `${type}-fx`, name: type, type, enabled: true, params: { ...getDefaultEffectParams(type), ...params }, ...(operatorGraph ? { operatorGraph } : {}) } as Effect);

const cases: Array<['wave' | 'twirl' | 'bulge', Record<string, number | string>, number]> = [
  ['bulge', {}, 0],
  ['bulge', { amount: 2.7, radius: .4, centerX: .35, edges: 'transparent' }, 0],
  ['bulge', { amount: .2, radius: .9, shape: 'frame', edges: 'clamp' }, 0],
  ['bulge', { amount: 0, radius: 1.3, edges: 'mirror' }, 0],
  ['twirl', {}, 0],
  ['twirl', { amount: -7, radius: .7, centerY: .4, edges: 'transparent' }, 0],
  ['twirl', { amount: 3, shape: 'frame', edges: 'clamp' }, 0],
  ['wave', {}, 0.37],
  ['wave', { amplitudeX: .08, amplitudeY: .05, frequencyX: 2, frequencyY: 3, phase: 40, speed: 1.5, edges: 'transparent' }, 1.2],
  ['wave', { amplitudeX: .2, amplitudeY: 0, edges: 'mirror' }, 0],
];

describe('worker software Wave, Twirl and Bulge & Pinch', () => {
  it.each(cases)('renders the built-in %s %j like its graph', (type, params, time) => {
    const effect = effectOf(type, params);
    const handWritten = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effect] } as unknown as Layer)!;
    expect(handWritten.pixelEffects.uvDistortAdjustments).toHaveLength(1);
    expect(handWritten.pixelEffects.imageOperatorPlans).toBeUndefined();
    const graphPlan = prepareImageEffect(effect).plan!;
    const viaGraph = render({ brightness: 0, mirrorHorizontal: false, mirrorVertical: false, pixelateSize: 0,
      imageOperatorPlans: [graphPlan], imageOperatorPlanOwners: [{ feedbackKey: 'k', reset: false, historyLoop: 'reset' }] }, time);
    const viaHandWritten = render(handWritten.pixelEffects, time);
    let largest = 0;
    for (let index = 0; index < viaGraph.length; index++) largest = Math.max(largest, Math.abs(viaGraph[index] - viaHandWritten[index]));
    expect(largest).toBeLessThanOrEqual(1);
    expect(viaHandWritten).not.toEqual(sourcePixels());
  });

  it('keeps the hand-written pass for a stored copy of the recipe and runs an edited graph as a graph', () => {
    const stored = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effectOf('twirl', {}, createDefaultUvDistortGraph('twirl'))] } as unknown as Layer)!;
    expect(stored.pixelEffects.uvDistortAdjustments).toHaveLength(1);
    const edited = createDefaultUvDistortGraph('twirl');
    edited.nodes.find(node => node.id === 'space-epsilon')!.constants = { value: .01 };
    const graph = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effectOf('twirl', {}, edited)] } as unknown as Layer)!;
    expect(graph.pixelEffects.uvDistortAdjustments).toBeUndefined();
    expect(graph.pixelEffects.imageOperatorPlans).toHaveLength(1);
  });

  it('costs nothing at neutral settings', () => {
    for (const [type, params] of [['bulge', { amount: 1 }], ['twirl', { amount: 0 }], ['wave', { amplitudeX: 0, amplitudeY: 0 }]] as const) {
      const plan = workerSoftwareEffectPlanForLayer({ id: 'layer', effects: [effectOf(type, params)] } as unknown as Layer)!;
      expect(plan.pixelEffects.uvDistortAdjustments).toBeUndefined();
      expect(render(plan.pixelEffects, 0)).toEqual(sourcePixels());
    }
  });
});
