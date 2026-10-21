// The worker GPU adjustment host renders Gaussian Blur with the editor's kernel (blurSampling.ts).
import { describe, expect, it } from 'vitest';
import { separableBlurTaps } from '../../src/effects/blur/blurSampling';
import { workerAdjustmentBlurPassData } from '../../src/services/render/workerGpuAdjustmentBlur';

describe('worker GPU adjustment Gaussian Blur', () => {
  it.each([[10, 1920, 1080], [10, 3840, 2160], [3, 1280, 720], [50, 1920, 1080], [0, 1920, 1080]] as const)(
    'uses the separable graph taps for radius %s at %sx%s', (radius, width, height) => {
      const expected = separableBlurTaps('gaussian', radius, width, height).taps;
      for (const direction of ['horizontal', 'vertical'] as const) {
        const { uniforms, taps } = workerAdjustmentBlurPassData(direction, radius, width, height);
        expect(uniforms[4]).toBe(expected.length);
        expected.forEach((tap, index) => {
          expect(taps[index * 2]).toBeCloseTo(tap.offset, 4);
          expect(taps[index * 2 + 1]).toBeCloseTo(tap.weight, 6);
        });
      }
    });

  it('scales the radius with the frame and restores straight alpha only after the vertical pass', () => {
    const hd = workerAdjustmentBlurPassData('horizontal', 10, 1920, 1080), uhd = workerAdjustmentBlurPassData('horizontal', 10, 3840, 2160);
    const reach = (taps: Float32Array) => Math.max(...taps.filter((_value, index) => index % 2 === 0).map(Math.abs));
    // The kernel scales with the frame (the outermost merged tap moves with the pair centres).
    expect(reach(uhd.taps) / reach(hd.taps)).toBeGreaterThan(1.8);
    expect(reach(uhd.taps) / reach(hd.taps)).toBeLessThan(2.2);
    expect([...hd.uniforms.slice(0, 2)]).toEqual([1, 0]);
    expect(hd.uniforms[5]).toBe(0);
    const vertical = workerAdjustmentBlurPassData('vertical', 10, 1920, 1080);
    expect([...vertical.uniforms.slice(0, 2)]).toEqual([0, 1]);
    expect(vertical.uniforms[5]).toBe(1);
  });
});
