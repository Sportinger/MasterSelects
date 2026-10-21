// Worker CPU fallback (software preview, worker-first export): pointwise effects in front of the
// built-in Kaleidoscope, Mirror, RGB Split and Pixelate run as whole-frame steps in stack order
// (fast and exact), instead of after them or through the slow graph interpreter
// (docs/Features/Effects.md#editable-mirror-split-and-pixel-graphs).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRenderSoftwareFrame } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';
import { applyWorkerSoftwareMirrorPixelEffects, workerSoftwareMirrorPixelScratchBytes } from '../../src/services/render/workerSoftwareMirrorPixelEffects';
import type { Layer } from '../../src/types/layers';

type StackEffect = { type: string; params: Record<string, number | string | boolean> };
type PixelEffects = WorkerRenderSoftwareFrame['layers'][number]['pixelEffects'];

const layerOf = (effects: StackEffect[]) => ({ id: 'stack-layer', effects: effects.map((effect, index) => ({ id: `fx-${index}-${effect.type}`,
  name: effect.type, enabled: true, ...effect })) } as unknown as Layer);
const plan = (effects: StackEffect[]) => workerSoftwareEffectPlanForLayer(layerOf(effects))!;

/** Runs a layer's worker CPU pixel effects on straight RGBA bytes (no canvas filter). */
function run(pixels: Uint8ClampedArray, width: number, height: number, pixelEffects: PixelEffects): Uint8ClampedArray {
  let out = new Uint8ClampedArray(pixels);
  const context = { getImageData: () => ({ data: new Uint8ClampedArray(pixels) }),
    putImageData: (image: ImageData) => { out = new Uint8ClampedArray(image.data); } };
  applyWorkerSoftwarePixelEffects(context as unknown as OffscreenCanvasRenderingContext2D, width, height,
    { pixelEffects } as WorkerRenderSoftwareFrame['layers'][number], 0);
  return out;
}
const draw = (effects: StackEffect[], pixels: Uint8ClampedArray, width: number, height: number) => {
  const stackPlan = plan(effects);
  expect(stackPlan.filter).toBe('none');
  return run(pixels, width, height, stackPlan.pixelEffects);
};

/** A picture with colour detail and a green-screen band. */
function picture(width: number, height: number, alpha = (_x: number, _y: number) => 255): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).map((_, index) => {
    const pixel = index >> 2, x = pixel % width, y = Math.floor(pixel / width);
    const green = x > width * .55 && x < width * .8;
    return (green ? [20, 230, 30, 255] : [(x * 37 + y * 11) % 256, (y * 23 + (x % 7) * 19) % 256, (x * y * 5 + 40) % 256, alpha(x, y)])[index & 3];
  });
}

/** Largest premultiplied difference (0–255 scale) between two straight RGBA images. */
function premultipliedDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let worst = 0;
  for (let index = 0; index < a.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      worst = Math.max(worst, Math.abs(a[index + channel] * a[index + 3] - b[index + channel] * b[index + 3]) / 255);
    }
    worst = Math.max(worst, Math.abs(a[index + 3] - b[index + 3]));
  }
  return worst;
}

afterEach(() => { vi.useRealTimers(); });

describe('worker CPU mirror and pixel pass with pointwise effects in front', () => {
  const exposure: StackEffect = { type: 'exposure', params: { exposure: .6, gamma: 1.3 } };
  const pixelate: StackEffect = { type: 'pixelate', params: { size: 54 } };

  it('keeps a grade before Pixelate on the hand-written pass, in stack order and exact', () => {
    const width = 320, height = 180, input = picture(width, height);
    const stacked = plan([exposure, pixelate]).pixelEffects;
    // Hand-written: no graph interpreter (100× slower), the grade as the first whole-frame step.
    expect(stacked.imageOperatorPlans).toBeUndefined();
    expect(stacked.exposureAdjustments).toBeUndefined();
    expect(stacked.mirrorPixelAdjustments?.map(step => step.type)).toEqual(['pointwise', 'pixelate']);
    // Independent reference: each effect alone, applied in stack order.
    const reference = draw([pixelate], draw([exposure], input, width, height), width, height);
    expect(premultipliedDifference(run(input, width, height, stacked), reference)).toBeLessThanOrEqual(3);
    // And the other order really is different: Pixelate averages first, then the gamma curve.
    expect(premultipliedDifference(draw([pixelate, exposure], input, width, height), reference)).toBeGreaterThan(8);
  });

  it('keys before a zoomed Kaleidoscope or an angled Mirror exactly as the effects one after the other', () => {
    const width = 96, height = 54, input = picture(width, height);
    const key: StackEffect = { type: 'chroma-key', params: { keyColor: 'green', tolerance: .2, softness: .1 } };
    for (const resampling of [{ type: 'kaleidoscope', params: { segments: 6, zoom: 3 } }, { type: 'mirror', params: { angle: .37 } },
      { type: 'rgb-split', params: { amount: .02, angle: .4 } }] as StackEffect[]) {
      const stacked = draw([key, resampling], input, width, height);
      const reference = draw([resampling], draw([key], input, width, height), width, height);
      expect(premultipliedDifference(stacked, reference)).toBeLessThanOrEqual(3);
    }
    // Threshold and Posterize (not linear) before Kaleidoscope as well.
    for (const colour of [{ type: 'threshold', params: { level: .45 } }, { type: 'posterize', params: { levels: 3 } }] as StackEffect[]) {
      const kaleidoscope: StackEffect = { type: 'kaleidoscope', params: { segments: 5, zoom: 3 } };
      expect(premultipliedDifference(draw([colour, kaleidoscope], input, width, height),
        draw([kaleidoscope], draw([colour], input, width, height), width, height))).toBeLessThanOrEqual(3);
    }
  });

  it('applies a Contrast in front as its GPU formula instead of a late canvas filter', () => {
    const width = 40, height = 24, input = picture(width, height);
    const contrast = plan([{ type: 'contrast', params: { amount: 1.8 } }, { type: 'mirror', params: { angle: .3 } }]);
    expect(contrast.filter).toBe('none');
    expect(contrast.pixelEffects.mirrorPixelAdjustments?.[0]).toEqual({ type: 'pointwise', step: { kind: 'contrast', amount: 1.8 } });
    // Reference: clamp((c − 0.5) × amount + 0.5) on the bytes, then the Mirror alone.
    const graded = input.map((value, index) => (index & 3) === 3 ? value : Math.round(Math.min(1, Math.max(0, (value / 255 - .5) * 1.8 + .5)) * 255));
    expect(premultipliedDifference(run(input, width, height, contrast.pixelEffects),
      draw([{ type: 'mirror', params: { angle: .3 } }], graded, width, height))).toBeLessThanOrEqual(2);
    // Behind the mirror/pixel effects they stay canvas filters.
    expect(plan([{ type: 'mirror', params: {} }, { type: 'invert', params: {} }]).filter).toBe('invert(1)');
  });

  it('sends layers with a neighbourhood or resampling effect in front to ordered graph plans', () => {
    for (const earlier of [{ type: 'gaussian-blur', params: { radius: 4 } }, { type: 'twirl', params: { amount: 2 } }] as StackEffect[]) {
      const stacked = plan([earlier, exposure, pixelate]).pixelEffects;
      expect(stacked.mirrorPixelAdjustments).toBeUndefined();
      expect(stacked.imageOperatorPlans).toHaveLength(3);
    }
    // A Twirl that changes nothing does not count.
    expect(plan([{ type: 'twirl', params: { amount: 0 } }, pixelate]).pixelEffects.mirrorPixelAdjustments).toHaveLength(1);
  });

  it('holds one frame buffer for a single resampling effect, grows without shrinking and frees it when idle', () => {
    vi.useFakeTimers();
    const mirror = { type: 'mirror', horizontal: true, vertical: false, keepEnd: false, angle: .2, centerX: .5, centerY: .5, edges: 'mirror' } as const;
    // Start from released buffers (earlier tests in this worker may still hold theirs).
    applyWorkerSoftwareMirrorPixelEffects(picture(4, 4), 4, 4, [mirror]);
    vi.advanceTimersByTime(2500);
    expect(workerSoftwareMirrorPixelScratchBytes()).toBe(0);
    applyWorkerSoftwareMirrorPixelEffects(picture(64, 36), 64, 36, [{ type: 'pointwise', step: { kind: 'invert' } }, mirror]);
    // The last resampling step writes straight back into the bytes: one float copy of the frame.
    expect(workerSoftwareMirrorPixelScratchBytes()).toBe(64 * 36 * 16);
    // A smaller layer reuses it; a chain of two resampling effects adds the second buffer.
    applyWorkerSoftwareMirrorPixelEffects(picture(32, 18), 32, 18, [{ type: 'pixelate', size: 120 },
      { type: 'rgb-split', amount: .05, angle: 0, lens: false, edges: 'clamp' }]);
    expect(workerSoftwareMirrorPixelScratchBytes()).toBe(64 * 36 * 16 + 32 * 18 * 16);
    vi.advanceTimersByTime(1500);
    expect(workerSoftwareMirrorPixelScratchBytes()).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    expect(workerSoftwareMirrorPixelScratchBytes()).toBe(0);
  });

  it('still applies pointwise steps that follow a last effect skipped at this size', () => {
    const width = 20, height = 12, input = picture(width, height, x => x < 5 ? 0 : 200);
    const kaleidoscope = { type: 'kaleidoscope', segments: 4, rotation: 0, sourceAngle: 0, zoom: 1, centerX: .5, centerY: .5,
      stretch: false, edges: 'transparent' } as const;
    // Pixelate below one rendered pixel is skipped; the Invert in front of it still runs after the Kaleidoscope.
    const stacked = new Uint8ClampedArray(input);
    applyWorkerSoftwareMirrorPixelEffects(stacked, width, height, [kaleidoscope, { type: 'pointwise', step: { kind: 'invert' } }, { type: 'pixelate', size: .1 }]);
    const reference = new Uint8ClampedArray(input);
    applyWorkerSoftwareMirrorPixelEffects(reference, width, height, [kaleidoscope]);
    applyWorkerSoftwareMirrorPixelEffects(reference, width, height, [{ type: 'pointwise', step: { kind: 'invert' } }]);
    expect(premultipliedDifference(stacked, reference)).toBeLessThanOrEqual(1);
  });
});
