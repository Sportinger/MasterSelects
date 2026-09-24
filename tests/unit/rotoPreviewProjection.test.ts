import { describe, expect, it } from 'vitest';
import { rotoPreviewProjection, sampleRotoMask } from '../../src/services/roto/rotoPreviewProjection';
import type { ClipTransform } from '../../src/types/timelineCore';
const transform = { position: { x: .2, y: -.1, z: 0 }, scale: { x: .7, y: .9 }, rotation: { x: 0, y: 0, z: 25 }, anchor: { x: .1, y: -.05 } } as ClipTransform;
const size = { width: 1920, height: 1080 }, display = { width: 960, height: 540 };
describe('Main Preview Roto mapping', () => {
  it('round-trips source clicks through aspect ratio, scale, anchor, position and rotation', () => {
    const mapping = rotoPreviewProjection(transform, { width: 720, height: 1280 }, size, display);
    for (const p of [{ x: .3, y: .2 }, { x: .8, y: .7 }]) {
      const q = mapping.toSource(mapping.toDisplay(p));
      expect(q?.x).toBeCloseTo(p.x, 5); expect(q?.y).toBeCloseTo(p.y, 5);
    }
  });
  it('maps a crop back into full-source mask coordinates and rejects outside clicks', () => {
    const mapping = rotoPreviewProjection(transform, size, size, display, { x: .2, y: .1, width: .5, height: .6 });
    const p = { x: .4, y: .3 }, q = mapping.toSource(mapping.toDisplay(p));
    expect(q?.x).toBeCloseTo(p.x, 5); expect(q?.y).toBeCloseTo(p.y, 5);
    expect(mapping.toSource(mapping.toDisplay({ x: .1, y: .3 }))).toBeNull();
  });
  it('uses the same projective mapping for bitmap rendering and source point handles', () => {
    const mapping = rotoPreviewProjection({ ...transform, rotation: { x: 15, y: -10, z: 25 } }, size, size, display);
    const h = mapping.cssMatrix;
    for (const p of [{ x: 0, y: 0 }, { x: .4, y: .6 }, { x: 1, y: 1 }]) {
      const divisor = h[3] * p.x + h[7] * p.y + h[15];
      const actual = { x: (h[0] * p.x + h[4] * p.y + h[12]) / divisor, y: (h[1] * p.x + h[5] * p.y + h[13]) / divisor };
      const expected = mapping.toDisplay(p);
      expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5);
    }
  });
  it('shows only a mask covering the requested source frame, including backward pass insertion order', () => {
    const mask = (time: number, duration: number) => ({ time, duration, width: 1, height: 1, data: Uint8Array.of(255) });
    const masks = [mask(2.04, .06), mask(2, .04)];
    expect(sampleRotoMask(masks, 2.02)).toBe(masks[1]);
    expect(sampleRotoMask(masks, 2.04)).toBe(masks[0]);
    expect(sampleRotoMask(masks, 1.99)).toBeUndefined();
    expect(sampleRotoMask(masks, 2.15)).toBeUndefined();
  });
});
