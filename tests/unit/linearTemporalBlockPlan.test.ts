import { describe, expect, it } from 'vitest';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createInitialSlitScanGraph } from '../../src/services/operators/slitScanGraphUpgrade';
import { linearTemporalAxis, linearTemporalBlockMemory, linearTemporalBlockPlan, linearTemporalStrips } from '../../src/effects/time/linearTemporalBlockPlan';
import { hybridTemporalMemory } from '../../src/effects/time/hybridTemporalWindow';
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
    const accelerated = linearTemporalBlockPlan({ ...request, source: { ...request.source, clockRate: 3 } }, frames, 1 / 24, 8);
    expect(accelerated[7].localTime).toBeCloseTo(8 + 7 * 3 / 24, 12);
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
    const memory = linearTemporalBlockMemory(1920, 1080, 256 * 1024 * 1024);
    expect(memory.count).toBe(16);
    expect(memory.bytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect(linearTemporalBlockMemory(7680, 4320, 256 * 1024 * 1024).count).toBe(0);
    for (const budget of [640, 1024, 2048, 4096].map(mib => mib * 1024 * 1024)) {
      for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
        const base = hybridTemporalMemory(width, height, width, height, 2, 256, budget);
        const block = linearTemporalBlockMemory(width, height, budget - base.bytes);
        expect(base.bytes + block.bytes).toBeLessThanOrEqual(budget);
        expect(block.count).toBeGreaterThanOrEqual(2);
        expect(block.count).toBeLessThanOrEqual(100);
        if (budget === 4096 * 1024 * 1024 && width === 1920) expect(block.count).toBe(100);
      }
    }
  });
  it('accepts the saved initial graph with muted optional groups and rearranged presentation', () => {
    const graph = effectOperatorGraph({ type: 'slit-scan', params: {}, operatorGraph: createInitialSlitScanGraph() });
    graph.nodes.reverse(); graph.edges.reverse(); graph.groups?.reverse();
    graph.layout = {};
    graph.edges.forEach((edge, index) => { edge.id = `saved-edge-${index}`; });
    graph.groups?.forEach(group => {
      group.label = 'Moved section'; group.color = '#ffffff'; group.nodeIds.reverse();
      if (group.composition) group.composition.instance.composition!.layout = {};
    });
    expect(linearTemporalAxis(request, graph, { temporalBatch: 'block', angle: -45 }, 1 / 30)).toBe(315);
  });
  it('accepts each neutral bypass independently but rejects altered routes, membership and core bypasses', () => {
    const original = effectOperatorGraph({ type: 'slit-scan', params: {} });
    const params = { temporalBatch: 'block' };
    for (const id of ['scan-protection', 'subject-protection', 'time-map', 'rgb-time',
      'field-shaping', 'field-combination', 'field-noise', 'field-motion']) {
      const graph = structuredClone(original);
      graph.groups!.find(group => group.id === id)!.bypassed = true;
      expect(linearTemporalAxis(request, graph, params, 1 / 30)).toBe(0);
    }
    const route = structuredClone(original);
    const group = route.groups!.find(group => group.id === 'scan-protection')!;
    group.bypassed = true;
    group.bypassOutputs!['protection-mask:value'] = { nodeId: 'zero', portId: 'value' };
    expect(linearTemporalAxis(request, route, params, 1 / 30)).toBeUndefined();
    const membership = structuredClone(original);
    membership.groups!.find(group => group.id === 'time-map')!.nodeIds.push('history');
    expect(linearTemporalAxis(request, membership, params, 1 / 30)).toBeUndefined();
    const core = structuredClone(original);
    core.groups!.find(group => group.id !== 'time-map' && group.id.startsWith('compound-'))!.bypassed = true;
    expect(linearTemporalAxis(request, core, params, 1 / 30)).toBeUndefined();
    const wired = structuredClone(original);
    wired.edges.find(edge => edge.to === 'history' && edge.input === 'delay')!.from = 'zero';
    expect(linearTemporalAxis(request, wired, params, 1 / 30)).toBeUndefined();
    const literal = structuredClone(original);
    literal.nodes.find(node => node.id === 'zero')!.constants = { value: .25 };
    expect(linearTemporalAxis(request, literal, params, 1 / 30)).toBeUndefined();
  });
  it('keeps every potentially contributing pixel inside its strip for arbitrary angles', () => {
    const plan = linearTemporalBlockPlan({ ...request, samples: 12 }, frames, 1 / 25, 1)[0];
    const width = 73, height = 41, data = plan.metadata, count = data[data.length - 4];
    for (const angle of [0, 1, 45, 90, 135, 180, 270, 359]) {
      const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
      const strips = linearTemporalStrips(data, 4, angle, width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const delay = (((x + .5) / width - .5) * c + ((y + .5) / height - .5) * s) / (Math.abs(c) + Math.abs(s)) * 4 + 2;
        let upper = 1;
        while (upper < count - 1 && data[upper * 4] < delay) upper++;
        for (const i of [upper - 1, upper]) for (const group of [data[i * 4 + 1], data[i * 4 + 2]]) {
          if (!group) continue;
          const rect = strips.get(group);
          expect(rect).toBeDefined();
          expect(x).toBeGreaterThanOrEqual(rect![0]); expect(x).toBeLessThan(rect![0] + rect![2]);
          expect(y).toBeGreaterThanOrEqual(rect![1]); expect(y).toBeLessThan(rect![1] + rect![3]);
        }
      }
    }
  });
});
