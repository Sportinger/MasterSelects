import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '@napi-rs/canvas';
import type { ClipMask } from '../../src/types/masks';
import { maskFeatherAlpha, maskFeatherGuideAlpha } from '../../src/utils/maskFeatherProfile';
import { createMaskTextureRasterKey, generateMaskTexture } from '../../src/utils/maskRenderer';

function mask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'profile', name: 'Profile', closed: true, enabled: true, visible: true,
    expanded: true, opacity: 1, mode: 'add', inverted: false, feather: 0,
    featherQuality: 100, position: { x: 0, y: 0 },
    vertices: [[.3, .3], [.7, .3], [.7, .7], [.3, .7]].map(([x, y], i) => ({
      id: `v${i}`, x, y, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 },
    })), ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('mask feather profile', () => {
  it('draws the guide from a strong inner edge to a transparent outer edge in the same band', () => {
    for (const balance of [-100, 0, 100]) {
      expect(maskFeatherGuideAlpha(0, balance)).toBe(0);
      expect(maskFeatherGuideAlpha(1, balance)).toBe(0);
      let previous = 0;
      for (let i = 1; i < 256; i++) {
        const alpha = maskFeatherGuideAlpha(i / 256, balance);
        expect(alpha).toBeGreaterThan(previous);
        expect(alpha).toBeLessThanOrEqual(.5);
        previous = alpha;
      }
    }
    expect(maskFeatherGuideAlpha(255 / 256)).toBeGreaterThan(.49);
    expect(maskFeatherGuideAlpha(.5)).toBe(.25);
  });
  it('pans the midpoint both ways while keeping the ramp endpoints fixed', () => {
    for (const balance of [-100, -50, 0, 50, 100]) {
      expect(maskFeatherAlpha(0, balance)).toBe(0);
      expect(maskFeatherAlpha(1, balance)).toBe(1);
      expect(maskFeatherAlpha(.5 - .475 * balance / 100, balance)).toBeCloseTo(.5);
      expect(maskFeatherAlpha(.2, balance) + maskFeatherAlpha(.8, -balance)).toBeCloseTo(1);
      let previous = 0;
      for (let i = 0; i <= 100; i++) {
        const next = maskFeatherAlpha(i / 100, balance);
        expect(next).toBeGreaterThanOrEqual(previous);
        previous = next;
      }
    }
    expect(maskFeatherAlpha(.2, 0)).toBe(.2);
    expect(maskFeatherAlpha(.5, -50)).toBeLessThan(.5);
    expect(maskFeatherAlpha(.5, 50)).toBeGreaterThan(.5);
  });

  it('moves a sharp edge inward and outward without changing the path, including inversion', () => {
    vi.stubGlobal('OffscreenCanvas', Canvas);
    const base = mask();
    const vertices = structuredClone(base.vertices);
    for (const inverted of [false, true]) {
      for (const offset of [-10, 0, 10]) {
        const pixels = generateMaskTexture([mask({ featherOffset: offset, inverted })], 100, 100)!;
        const edge = 30 - offset;
        const sample = (x: number) => pixels.data[(50 * 100 + x) * 4];
        expect(sample(edge - 2)).toBe(inverted ? 255 : 0);
        expect(sample(edge + 2)).toBe(inverted ? 0 : 255);
      }
    }
    expect(base.vertices).toEqual(vertices);
  });

  it('pans the rendered transition without changing the solid interior or exterior', () => {
    vi.stubGlobal('OffscreenCanvas', Canvas);
    const soft = generateMaskTexture([mask({ feather: 5, featherOffset: 10 })], 100, 100)!;
    const sample = (pixels: ImageData, x: number) => pixels.data[(50 * 100 + x) * 4];
    for (const balance of [-80, 80]) {
      const panned = generateMaskTexture([mask({ feather: 5, featherOffset: 10, featherBalance: balance })], 100, 100)!;
      expect(Math.sign(sample(panned, 20) - sample(soft, 20))).toBe(Math.sign(balance));
      expect(sample(panned, 0)).toBe(sample(soft, 0));
      expect(sample(panned, 50)).toBe(sample(soft, 50));
    }
  });

  it('keeps legacy defaults equivalent and invalidates cached rasters for both controls', () => {
    const key = (values: Partial<ClipMask>) => createMaskTextureRasterKey([mask(values)], 100, 100);
    expect(key({})).toBe(key({ featherOffset: 0, featherBalance: 0 }));
    expect(new Set([key({}), key({ featherOffset: -20 }), key({ featherBalance: 3 })]).size).toBe(3);
  });
});
