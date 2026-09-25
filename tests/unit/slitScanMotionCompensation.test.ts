import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { hybridTemporalWindow } from '../../src/effects/time/hybridTemporalWindow';
import { residentTemporalMetadata } from '../../src/effects/time/residentTemporalLayout';
import { linearTemporalAxis } from '../../src/effects/time/linearTemporalBlockPlan';
import { isLinearTemporalGraph } from '../../src/effects/time/linearTemporalGraph';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';
import { temporalSourceTime } from '../../src/effects/time/temporalClipSource';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imagePlanResourceSignature } from '../../src/services/operators/imageEffectRuntimePlan';

const source = { mediaId: 'video', localTime: 5, duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] };
const frames = Array.from({ length: 301 }, (_, i) => ({ time: i / 30, duration: 1 / 30 }));
const wgsl = (plan: ImageOperatorPlan): string => [plan.wgsl, ...(plan.passes ?? []).map(pass => wgsl(pass.program))].join('\n');

function compile(params: Record<string, unknown>) {
  const values = { ...getDefaultParams('slit-scan'), scanSmoothing: 0, scanSmoothingPreview: false, ...params };
  const graph = effectOperatorGraph({ type: 'slit-scan', params: values });
  return { graph, values, plan: compileImageOperatorGraph(graph, values, effectOperatorCompileContext({ type: 'slit-scan' })) };
}

describe('Slit Scan motion-compensated sampling', () => {
  it('records the graph-delay distance from every grid position to its decoded frame', () => {
    for (const [speed, timeFactor] of [[1, 1], [1, 4], [-1, 1], [2, 1]]) {
      const clip = { ...source, speed };
      const request = { source: clip, horizon: timeFactor * .8, timeFactor, samples: 64, nearest: true } as SourceTemporalRequest;
      const window = hybridTemporalWindow(request, frames);
      expect(window.offsets).toHaveLength(window.samples.length);
      window.samples.forEach((sample, i) => {
        if (!sample.group) return;
        const frameDelay = sample.age / timeFactor + window.offsets[i][0];
        expect(temporalSourceTime(clip, clip.localTime - frameDelay * timeFactor), `${speed}/${timeFactor}/${i}`)
          .toBeCloseTo(window.times[sample.group - 1], 5);
      });
    }
  });

  it('stores lower/upper offsets in metadata row 1 without moving the tile grid', () => {
    const metadata = new Float32Array([0, 0, 0, 0, .5, 1, 2, .25, 2, 1, 0, 4]);
    const data = residentTemporalMetadata(metadata, [1, 2], new Map([[1, 7], [2, 8]]), 3, 2, [[0, 0], [.01, -.02]]);
    expect([...data.slice(12, 20)]).toEqual([0, 0, 0, 0, expect.closeTo(.01), expect.closeTo(-.02), 0, 0]);
    expect([...data.slice(20, 24)]).toEqual([3, 2, 0, 0]);
    expect(data[5]).toBe(7); expect(data[6]).toBe(8);
  });

  it('wires DIS to the base sampler but compiles it only when enabled', () => {
    const off = compile({});
    expect(off.graph.edges.some(edge => edge.to === 'history' && edge.input === 'motion' && edge.from === 'motion-comp-image')).toBe(true);
    expect(off.graph.nodes.find(node => node.id === 'motion-comp-strength')?.bindings).toEqual({ value: 'temporalMotionStrength' });
    expect(off.graph.edges.some(edge => edge.to === 'motion-comp-field' && edge.from === 'motion-scan-dis-source')).toBe(true);
    expect(off.plan.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
    expect(wgsl(off.plan)).not.toContain('sampleInputHistoryMotion(imageGraphResource');
    const on = compile({ temporalMotion: 'motion' });
    expect(on.plan.externalResources?.some(resource => resource.kind === 'source-motion' && resource.denseInverseSearch)).toBe(true);
    expect(wgsl(on.plan)).toContain('sampleInputHistoryMotion(imageGraphResource');
    const effect = { type: 'slit-scan', params: off.values };
    expect(imagePlanResourceSignature(off.graph, off.values, effect))
      .not.toBe(imagePlanResourceSignature(on.graph, on.values, { type: 'slit-scan', params: on.values }));
  });

  it('keeps the default graph linear but routes compensated export through per-frame sampling', () => {
    const { graph, values } = compile({ temporalBatch: 'block' });
    expect(isLinearTemporalGraph(graph)).toBe(true);
    const request = { source, horizon: 1, timeFactor: 1, samples: 64, nearest: true } as SourceTemporalRequest;
    expect(linearTemporalAxis(request, graph, values, 1 / 30)).toBe(0);
    expect(linearTemporalAxis(request, graph, { ...values, temporalMotion: 'motion' }, 1 / 30)).toBeUndefined();
  });
});
