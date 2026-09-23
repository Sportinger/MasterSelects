import { describe, expect, it } from 'vitest';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { linearTemporalAxis, linearTemporalBlockMemory, linearTemporalBlockPlan, linearTemporalStrip } from '../../src/effects/time/linearTemporalBlockPlan';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';

const request = {
  key: 'clip', effectId: 'effect', media: {}, encoder: {}, horizon: 4, timeFactor: 1, samples: 1920, nearest: false,
  source: { mediaId: 'media', localTime: 8, duration: 20, inPoint: 0, outPoint: 20, speed: 1, speedKeyframes: [] },
} as SourceTemporalRequest;
const frames = Array.from({ length: 501 }, (_, i) => ({ time: i / 25, duration: 1 / 25 }));

describe('linear temporal output blocks', () => {
  it('shares one unique PTS request across eight outputs at exact fractional export spacing', () => {
    const plan = linearTemporalBlockPlan(request, frames, 1 / 24, 8);
    expect(plan).toHaveLength(8);
    expect(plan[7].localTime).toBeCloseTo(8 + 7 / 24, 12);
    const unique = new Set(plan.flatMap(frame => frame.times));
    expect(unique.size).toBeLessThan(plan.reduce((sum, frame) => sum + frame.times.length, 0) / 4);
    expect(linearTemporalBlockPlan({ ...request, source: { ...request.source, localTime: 19.99 } }, frames, 1 / 24, 8)).toHaveLength(1);
  });
  it('only opts in for native export with the unmodified linear graph', () => {
    const graph = effectOperatorGraph({ type: 'slit-scan', params: {} });
    const params = { temporalBatch: 'block', angle: 17 };
    expect(linearTemporalAxis(request, graph, params, 1 / 24)).toBe(17);
    expect(linearTemporalAxis(request, graph, params)).toBeUndefined();
    expect(linearTemporalAxis({ ...request, maxEdge: 160 }, graph, params, 1 / 24)).toBeUndefined();
    for (const extra of [{ profile: 'radial' }, { mapAmount: .1 }, { protectionMask: 'mask' }, { protect: .2 }, { temporalBatch: 'single' }]) {
      expect(linearTemporalAxis(request, graph, { ...params, ...extra }, 1 / 24)).toBeUndefined();
    }
    const custom = structuredClone(graph); custom.nodes[0].bypassed = true;
    expect(linearTemporalAxis(request, custom, params, 1 / 24)).toBeUndefined();
  });
  it('bounds output tile memory independently of temporal sample count', () => {
    const memory = linearTemporalBlockMemory(1920, 1080);
    expect(memory.count).toBe(8);
    expect(memory.bytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect(linearTemporalBlockMemory(7680, 4320).count).toBe(0);
  });
  it('keeps every potentially contributing pixel inside its strip for arbitrary angles', () => {
    const plan = linearTemporalBlockPlan({ ...request, samples: 12 }, frames, 1 / 25, 1)[0];
    const width = 73, height = 41, data = plan.metadata, count = data[data.length - 4];
    for (const angle of [0, 1, 45, 90, 135, 180, 270, 359]) {
      const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const delay = (((x + .5) / width - .5) * c + ((y + .5) / height - .5) * s) / (Math.abs(c) + Math.abs(s)) * 4 + 2;
        let upper = 1;
        while (upper < count - 1 && data[upper * 4] < delay) upper++;
        for (const i of [upper - 1, upper]) for (const group of [data[i * 4 + 1], data[i * 4 + 2]]) {
          if (!group) continue;
          const rect = linearTemporalStrip(data, group, 4, angle, width, height);
          expect(rect).toBeDefined();
          expect(x).toBeGreaterThanOrEqual(rect![0]); expect(x).toBeLessThan(rect![0] + rect![2]);
          expect(y).toBeGreaterThanOrEqual(rect![1]); expect(y).toBeLessThan(rect![1] + rect![3]);
        }
      }
    }
  });
});
