import { expect, it } from 'vitest';
import { seamSampleData } from '../../src/effects/time/slit-scan/SlitScanSeamSmoothing';
import { slitScanGeometryBytes } from '../../src/effects/time/slit-scan/geometryParameters';
import type { TemporalSampleMetadata } from '../../src/effects/time/TemporalSampleMetadata';

it('uses resolved variable-rate source times, ignoring held frames when choosing the seam scale', () => {
  const now = 1_000_000;
  const metadata: TemporalSampleMetadata = { interpolation: 'nearest', samples: [
    { delay: 0, currentInput: true, contributions: [] },
    ...[.125, .125, .5].map((age, i) => ({ delay: i + 1, currentInput: false,
      contributions: [{ sourceTime: now - age, weight: 1 }] })),
  ] };
  const { values, step } = seamSampleData(metadata, now);
  expect(step).toBe(.125);
  expect([values[1], values[5], values[9], values[13]]).toEqual([0, .125, .125, .5]);
  metadata.samples[1].contributions = [{ sourceTime: now + .25, weight: .5 }, { sourceTime: now + .5, weight: .5 }];
  expect(seamSampleData(metadata, now).values[5]).toBe(-.375);
});

it('keeps fully held samples finite and rejects missing provenance', () => {
  expect(seamSampleData({ interpolation: 'linear', samples: [{ delay: 0, currentInput: true, contributions: [] }] }, 10).step).toBe(1);
  expect(() => seamSampleData({ interpolation: 'nearest', samples: [{ delay: 1, currentInput: false, contributions: [] }] }, 10)).toThrow();
});

it('reserves the optional filter in 2D and every mip even for narrow textures', () => {
  expect(slitScanGeometryBytes({ geometryMode: '2d' }, 1920, 1080)).toBe(0);
  expect(slitScanGeometryBytes({ geometryMode: '2d', seamSmoothing: 2 }, 1920, 1080)).toBe(1920 * 1080 * 20);
  const base = { geometryMode: 'time-surface' };
  const single = slitScanGeometryBytes(base, 1, 1);
  // 1x8: 8+4+2+1 mip pixels, versus a single pixel; two rgba32f fields.
  expect(slitScanGeometryBytes(base, 1, 8) - single).toBe(7 * 32 + 14 * 4);
});
