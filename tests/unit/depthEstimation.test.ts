import { describe, expect, it } from 'vitest';
import { depthInputSize, normalizeDepth } from '../../src/services/depthEstimation/depthMath';
import { DEPTH_MODEL, DEPTH_MODEL_URL, verifyDepthModel } from '../../src/services/depthEstimation/depthModel';

describe('relative depth maps', () => {
  it('bounds portrait, landscape and panorama inputs to model patch dimensions', () => {
    for (const [w, h] of [[2160, 3840], [1920, 1080], [20000, 500]]) {
      for (const edge of [280, 518]) {
        const size = depthInputSize(w, h, edge);
        expect(Math.max(size.width, size.height)).toBe(edge);
        expect(size.width % 14).toBe(0); expect(size.height % 14).toBe(0);
      }
    }
    expect(() => depthInputSize(0, 200, 280)).toThrow();
  });
  it('keeps larger inverse depth brighter and is invariant to scale and offset', () => {
    const values = Float32Array.from({ length: 100 }, (_, i) => i);
    const a = normalizeDepth(values), b = normalizeDepth(values.map(v => v * 4 + 10));
    expect(a.pixels).toEqual(b.pixels);
    expect(a.pixels[0]).toBe(0); expect(a.pixels[99]).toBe(255);
    expect(a.pixels[50]).toBeGreaterThan(a.pixels[25]);
  });
  it('handles flat images and rejects corrupt output', () => {
    expect(normalizeDepth(new Float32Array([5, 5])).pixels).toEqual(new Uint8Array([128, 128]));
    expect(() => normalizeDepth(new Float32Array([NaN]))).toThrow();
    expect(() => normalizeDepth(new Float32Array())).toThrow();
  });
  it('smooths range without mixing geometry and resets for a large cut', () => {
    const values = Float32Array.from({ length: 100 }, (_, i) => i);
    const original = normalizeDepth(values), smooth = normalizeDepth(values.map(v => v + 2), original.range, 0.75);
    expect(smooth.range.low).toBeCloseTo(original.range.low + 0.5);
    const cut = values.map(v => v + 1000);
    expect(normalizeDepth(cut, original.range, 0.75)).toEqual(normalizeDepth(cut));
  });
  it('pins the external model and rejects a truncated file before inference', async () => {
    expect(DEPTH_MODEL_URL).toContain(DEPTH_MODEL.revision);
    expect(DEPTH_MODEL_URL).not.toContain('/main/');
    expect(DEPTH_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyDepthModel(new ArrayBuffer(4))).toBe(false);
  });
});
