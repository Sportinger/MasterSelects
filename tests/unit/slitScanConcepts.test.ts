import { describe, expect, it } from 'vitest';
import { decodeSpaceTime, encodeSpaceTime, spaceTimeSlice } from '../../src/effects/time/slit-scan/spaceTimeData';
import { solveShapeTimeField } from '../../src/effects/time/slit-scan/shapeTimeField';
import type { PlanarTrack, SurfaceQuad } from '../../src/types/planarTracking';
import { getDefaultParams } from '../../src/effects';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { evaluateMaterializedImage } from '../helpers/evaluateMaterializedImage';
import { withSlitScanTimeFields } from '../../src/services/operators/slitScanTimeFieldsGraph';

const quad = (x: number): SurfaceQuad => [{ x, y: .2 }, { x: x + .3, y: .2 }, { x: x + .3, y: .8 }, { x, y: .8 }];
const track = { fps: 10, samples: Array.from({ length: 11 }, (_, i) => ({ time: i / 10, duration: .101, confidence: 1, quad: quad(.1 + i * .02) })) } as PlanarTrack;
const candidates = Array.from({ length: 11 }, (_, i) => ({ delay: i / 10, time: 1 - i / 10 }));

describe('observed space-time slice', () => {
  it('keeps a normal temporal slice at zero degrees and exchanges space/time at ninety', () => {
    expect(spaceTimeSlice(.3, 2, 0, .5, 1, .01)).toEqual({ position: .3, time: 1, visible: true });
    const tilted = spaceTimeSlice(.3, 2, 90, .5, -.3, .01);
    expect(tilted.position).toBeCloseTo(1); expect(tilted.time).toBeCloseTo(-.3); expect(tilted.visible).toBe(true);
    expect(spaceTimeSlice(.5, 2, 90, .5, -.3, .01).visible).toBe(false);
  });
  it('preserves the space-time radius at intermediate angles and respects thickness', () => {
    const result = spaceTimeSlice(.4, 2, 37, .25, 0, .001);
    expect(result.position ** 2 + result.time ** 2).toBeCloseTo(.4 ** 2 + .5 ** 2);
    expect(result.visible).toBe(false);
  });
  it('round trips source provenance, moving geometry and colors without runtime objects', () => {
    const points = new Float32Array([.1, .2, .3, -.5, 1, 0, 0, 1, .4, .2, .8, .5, 0, 1, 0, 1]);
    const encoded = encodeSpaceTime({ sourceId: 'video', fingerprint: 'hash', from: 2, to: 3 }, points);
    const loaded = decodeSpaceTime(encoded);
    expect(loaded.points).toEqual(points); expect(loaded.metadata.count).toBe(2);
    expect(() => decodeSpaceTime(encoded.replace('"count":2', '"count":3'))).toThrow('Incomplete');
    expect(() => encodeSpaceTime({ sourceId: 'video', fingerprint: 'hash', from: 2, to: 3 }, new Float32Array(8).fill(NaN))).toThrow();
  });
});

describe('shape-directed source-time search', () => {
  it('is identity at stretch one, including repeated poses and coherence', () => {
    const result = solveShapeTimeField(track, 1, candidates, 64, 32, { x: .5, y: .5 }, 1, 1);
    expect(result.values.every(value => value === 0)).toBe(true); expect(result.maxError).toBeLessThan(1e-6);
  });
  it('finds recorded positions for inverse stretched material without changing output UV', () => {
    const result = solveShapeTimeField(track, 1, candidates, 100, 10, { x: .6, y: .5 }, 2, 0);
    // Output x=.405 corresponds to reference x=.5025. Translation -.0975 is near the .5s-old pose.
    expect(result.values[5 * 100 + 40]).toBeCloseTo(.5);
    expect(result.errors[5 * 100 + 40]).toBeLessThan(.011);
    expect(result.values[5 * 100 + 90]).toBe(0);
    expect(result.values[5 * 100 + 60]).toBe(0);
  });
  it('reports unreachable targets instead of manufacturing positions', () => {
    const result = solveShapeTimeField(track, 1, candidates, 64, 32, { x: .3, y: .5 }, 4, 0);
    expect(result.maxError).toBeGreaterThan(.1);
    expect(result.values.every(value => value >= 0 && value <= 1)).toBe(true);
  });
  it('rejects missing current tracking and does not extrapolate through gaps', () => {
    expect(() => solveShapeTimeField(track, 2, candidates, 32, 32, { x: .5, y: .5 }, 2, 0)).toThrow('no reliable tracking');
    const broken = { ...track, samples: track.samples.filter(sample => sample.time === 1 || sample.time === 0).map(sample => ({ ...sample, duration: .05 })) };
    const result = solveShapeTimeField(broken, 1, candidates, 32, 32, { x: .6, y: .5 }, 2, 0);
    expect([...new Set(result.values)].every(value => value === 0 || value === 1)).toBe(true);
  });
  it('feeds the existing temporal sampler and upgrades the graph idempotently', () => {
    const params = { ...getDefaultParams('slit-scan'), mapSource: 'shape', mapAmount: 1, delay: 2, scanSmoothing: 0 };
    const graph = effectOperatorGraph({ type: 'slit-scan', params });
    expect(withSlitScanTimeFields(graph)).toBe(graph);
    const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext({ type: 'slit-scan' }));
    const result = evaluateMaterializedImage(plan, [1, 1, 1, 1], { uv: [.4, .5], resolution: [100, 100],
      sampleResource: id => id === 'slit-scan:shape-time' ? [.75, .75, .75, 1] : [0, 0, 0, 0],
      sampleInputHistory: (uv, delay) => [delay, uv[0], uv[1], 1] });
    expect(result[0]).toBeCloseTo(1.5); expect(result[1]).toBeCloseTo(.4); expect(result[2]).toBeCloseTo(.5);
    expect(plan.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
  });
});
