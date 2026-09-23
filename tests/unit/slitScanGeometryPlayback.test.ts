import { expect, it } from 'vitest';
import { GeometrySourceClock } from '../../src/effects/time/slit-scan/GeometrySourceClock';
import { slitScanGeometryGrid } from '../../src/effects/time/slit-scan/geometryParameters';
import { slitScanGeometryAge } from '../../src/effects/time/slit-scan/geometryContract';
import type { TemporalClipSource } from '../../src/effects/time/temporalClipSource';

const source: TemporalClipSource = { mediaId: 'video', localTime: 2, duration: 10,
  inPoint: 1_000_000, outPoint: 1_000_020, speed: 1, speedKeyframes: [] };

it('reuses the source mapping across playback, seeks and time factors, invalidating mapping edits', () => {
  const clock = new GeometrySourceClock();
  expect(clock.sample(source, 1).changed).toBe(true);
  for (const localTime of [3, 4, 2, 8]) {
    expect(clock.sample({ ...source, localTime }, 4).changed).toBe(false);
  }
  expect(clock.sample({ ...source, speed: -1 }, 1).changed).toBe(true);
  expect(clock.sample({ ...source, sourceOverride: 1_000_003 }, 1).changed).toBe(true);
  expect(() => clock.sample(source, 0)).toThrow(/time factor/);
});

it('matches signed source ages through reverse, hold, trim and speed ramps at long timestamps', () => {
  const ramp = [{ id: 'a', clipId: 'video', property: 'speed' as const, time: 0, value: .5, easing: 'linear' as const },
    { id: 'b', clipId: 'video', property: 'speed' as const, time: 10, value: 2, easing: 'linear' as const }];
  for (const mapping of [source, { ...source, speed: -1 }, { ...source, sourceOverride: 1_000_003 }, { ...source, speedKeyframes: ramp }]) {
    const clock = new GeometrySourceClock();
    for (const localTime of [1, 5, 9]) for (const factor of [.5, 1, 4]) {
      const current = { ...mapping, localTime };
      const { range, table } = clock.sample(current, factor);
      for (const delay of [-30, -.25, 0, .1, 1, 30]) {
        const position = Math.max(0, Math.min(1, (delay - range[0]) / range[1])) * range[2];
        const lo = Math.floor(position), hi = Math.min(lo + 1, 8192);
        const age = range[3] - (table[lo] + (table[hi] - table[lo]) * (position - lo));
        expect(age).toBeCloseTo(slitScanGeometryAge(current, delay, factor), 4);
      }
    }
  }
});

it('caps adaptive playback meshes while preserving authored paused, full-quality and export meshes', () => {
  const params = { geometryQuality: '2048', temporalPreview: 'adaptive' };
  expect(slitScanGeometryGrid(params, 1920, 1080, true)).toEqual({ columns: 128, rows: 72, adaptive: true });
  expect(slitScanGeometryGrid(params, 1920, 1080, false)).toEqual({ columns: 2048, rows: 512, adaptive: false });
  expect(slitScanGeometryGrid(params, 1920, 1080, true, true).columns).toBe(2048);
  expect(slitScanGeometryGrid({ ...params, temporalPreview: 'full' }, 1920, 1080, true).columns).toBe(2048);
  expect(slitScanGeometryGrid(params, 720, 1280, true).rows).toBe(228);
  expect(params.geometryQuality).toBe('2048');
});
