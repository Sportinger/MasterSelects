import { describe, expect, it } from 'vitest';
import { hybridTemporalBatches, hybridTemporalMemory, hybridTemporalWindow } from '../../src/effects/time/hybridTemporalWindow';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';
import { temporalCurrentGraph } from '../../src/services/operators/temporalDemandGraph';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';

const request = { source: { mediaId: 'video', localTime: 3, duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] },
  horizon: 2, samples: 256, nearest: false } as SourceTemporalRequest;
const frames = Array.from({ length: 241 }, (_, i) => ({ time: i / 24, duration: 1 / 24 }));
describe('hybrid source windows', () => {
  it('keeps all 256 temporal positions while sharing identical decoded frames', () => {
    const result = hybridTemporalWindow(request, frames);
    expect(result.samples).toHaveLength(256);
    expect(result.times.length).toBeLessThanOrEqual(50);
    expect(new Set(result.times).size).toBe(result.times.length);
    expect(result.metadata[1024]).toBe(256);
  });
  it('holds clip boundaries and supports reverse source order', () => {
    const held = hybridTemporalWindow({ ...request, source: { ...request.source, localTime: 0 } }, frames);
    expect(held.times).toEqual([0]);
    const reverse = hybridTemporalWindow({ ...request, source: { ...request.source, speed: -1 } }, frames);
    expect(reverse.times[0]).toBeLessThan(reverse.times.at(-1)!);
  });
  it('supports source-resolution sample counts without allocating a frame per position', () => {
    const result = hybridTemporalWindow({ ...request, samples: 1920 }, frames);
    expect(result.samples).toHaveLength(1920); expect(result.metadata.length).toBe(1921 * 4);
    expect(result.times.length).toBeLessThanOrEqual(50);
    expect(result.metadata[1920 * 4]).toBe(1920);
  });
  it('uses only the current image at zero delay', () => {
    expect(hybridTemporalWindow({ ...request, horizon: 0 }, frames).times).toEqual([]);
  });
  it('expands source lookback at 10x while keeping graph coordinates and current time unchanged', () => {
    const source = { ...request.source, localTime: 50, duration: 60, outPoint: 60 };
    const stamps = Array.from({ length: 1441 }, (_, i) => ({ time: i / 24, duration: 1 / 24 }));
    const result = hybridTemporalWindow({ ...request, source, horizon: 40, timeFactor: 10 }, stamps);
    expect(Math.min(...result.times)).toBeLessThan(10.1);
    expect(result.metadata[(result.samples.length - 1) * 4]).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < result.samples.length; i++) expect(result.metadata[i * 4]).toBeCloseTo(result.samples[i].age / 10, 5);
    expect(result.metadata[0]).toBe(0); expect(source.localTime).toBe(50); expect(source.speed).toBe(1);
  });
  it('blends across the full source-frame interval instead of shrinking crossfades at high sample counts', () => {
    for (const count of [64, 625, 1080, 1920]) {
      const result = hybridTemporalWindow({ ...request, samples: count }, frames);
      for (const sample of result.samples.slice(1)) {
        const a = result.times[sample.group - 1], b = result.times[sample.nextGroup - 1];
        expect(a * (1 - sample.blend) + b * sample.blend).toBeCloseTo(request.source.localTime - sample.age, 6);
      }
    }
  });
  it('consumes resident frames before reusing their slots, and decodes missing frames in order', () => {
    expect(hybridTemporalBatches([4, 3, 2, 1], [0, 1, 2, 3, 4], new Map([[3, 0]]), 2)).toEqual([[2], [4, 3], [1]]);
  });
  it('bounds native 1080p and 4K allocations without reducing sample positions', () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
      const memory = hybridTemporalMemory(w, h, w, h, 256, 256);
      expect(memory.bytes).toBeLessThanOrEqual(640 * 1024 * 1024);
      expect(memory.capacity).toBeGreaterThan(0); expect(memory.capacity).toBeLessThan(256);
    }
    expect(() => hybridTemporalMemory(7680, 4320, 7680, 4320, 256, 256)).toThrow(/budget/);
  });
  it('extracts the authored current branch without a recursive history dependency', () => {
    const graph = temporalCurrentGraph(createDefaultSlitScanGraph());
    const plan = prepareImageEffect({ type: 'slit-scan', params: {}, operatorGraph: graph }).plan!;
    expect(plan.externalResources?.some(r => r.kind === 'input-history')).toBeFalsy();
  });
});
