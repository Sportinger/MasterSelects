import { describe, expect, it } from 'vitest';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultUvDistortGraph, type EditableUvDistortEffectType } from '../../src/services/operators/uvDistortEffectGraphs';

type UV = [number, number];
type Pixel = [number, number, number, number];
const source = ([u, v]: UV): Pixel => [u, v, u * .25 + v * .5, .13 + u * .7];
const defaults: Record<EditableUvDistortEffectType, Record<string, number>> = {
  wave: { amplitudeX: .02, amplitudeY: .02, frequencyX: 5, frequencyY: 5 },
  twirl: { amount: 1, radius: .5, centerX: .5, centerY: .5 },
  bulge: { amount: .5, radius: .5, centerX: .5, centerY: .5 },
  kaleidoscope: { segments: 6, rotation: 0 },
};
const fract = (value: number) => value - Math.floor(value);

function reference(type: EditableUvDistortEffectType, uv: UV, params: Record<string, number>): UV {
  if (type === 'wave') {
    const y = uv[1] + Math.sin((uv[0] * params.frequencyX) * (Math.PI * 2)) * params.amplitudeX;
    return [uv[0] + Math.sin((y * params.frequencyY) * (Math.PI * 2)) * params.amplitudeY, y];
  }
  const center: UV = type === 'kaleidoscope' ? [.5, .5] : [params.centerX, params.centerY];
  const delta: UV = [uv[0] - center[0], uv[1] - center[1]], distance = Math.hypot(...delta);
  if (type === 'twirl') {
    const safeRadius = Math.max(params.radius, .0001), factor = 1 - Math.min(distance / safeRadius, 1), angle = (params.amount * factor) * factor;
    const rotated: UV = [delta[0] * Math.cos(angle) - delta[1] * Math.sin(angle), delta[0] * Math.sin(angle) + delta[1] * Math.cos(angle)];
    return distance < params.radius ? [center[0] + rotated[0], center[1] + rotated[1]] : uv;
  }
  if (type === 'bulge') {
    const safeDistance = Math.max(distance, .0001), normalized = safeDistance / params.radius;
    const newDistance = Math.pow(normalized, params.amount) * params.radius;
    const changed: UV = [center[0] + (delta[0] / safeDistance) * newDistance, center[1] + (delta[1] / safeDistance) * newDistance];
    return distance < params.radius && distance > 0 ? changed : uv;
  }
  const angle = Math.atan2(delta[1], delta[0]) + params.rotation, segmentAngle = (Math.PI * 2) / params.segments;
  let folded = fract(angle / segmentAngle) * segmentAngle;
  if (folded > segmentAngle * .5) folded = segmentAngle - folded;
  return [Math.cos(folded) * distance + .5, Math.sin(folded) * distance + .5];
}

describe('UV distortion image graphs', () => {
  it.each(Object.keys(defaults) as EditableUvDistortEffectType[])('%s matches an independent UV reference and samples complete RGBA once', type => {
    const uv: UV = type === 'kaleidoscope' ? [.17, .73] : [.61, .42];
    const params = type === 'wave' ? { amplitudeX: .071, amplitudeY: .043, frequencyX: 3.5, frequencyY: 7.25 }
      : type === 'twirl' ? { amount: -2.7, radius: .8, centerX: .44, centerY: .57 }
      : type === 'bulge' ? { amount: 1.7, radius: .9, centerX: .48, centerY: .52 }
      : { segments: 5.5, rotation: 1.2 };
    const sampled: UV[] = [], plan = compileImageOperatorGraph(createDefaultUvDistortGraph(type), params);
    const actual = evaluateImageOperatorPlan(plan, source(uv), { uv, sampleImage: at => { sampled.push(at); return source(at); } });
    const expectedUv = reference(type, uv, params);
    expect(sampled).toHaveLength(1);
    expect(sampled[0][0]).toBeCloseTo(expectedUv[0], 13); expect(sampled[0][1]).toBeCloseTo(expectedUv[1], 13);
    expect(actual).toEqual(source(sampled[0]));
    expect(actual[3]).not.toBe(source(uv)[3]);
  });

  it('keeps Twirl radius boundary and Bulge center/boundary strictly excluded', () => {
    for (const [type, uv] of [['twirl', [1, .5]], ['bulge', [.5, .5]], ['bulge', [1, .5]]] as Array<[EditableUvDistortEffectType, UV]>) {
      const params = defaults[type], sampled: UV[] = [];
      evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultUvDistortGraph(type), params), source(uv), { uv, sampleImage: at => { sampled.push(at); return source(at); } });
      expect(sampled[0][0]).toBeCloseTo(uv[0], 14); expect(sampled[0][1]).toBeCloseTo(uv[1], 14);
    }
  });

  it('preserves fractional Kaleidoscope segments and WGSL-style negative fract folding', () => {
    const uv: UV = [.18, .24], params = { segments: 5.5, rotation: -2.4 }, sampled: UV[] = [];
    evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultUvDistortGraph('kaleidoscope'), params), source(uv), { uv, sampleImage: at => { sampled.push(at); return source(at); } });
    const expected = reference('kaleidoscope', uv, params);
    expect(sampled[0][0]).toBeCloseTo(expected[0], 13); expect(sampled[0][1]).toBeCloseTo(expected[1], 13);
  });

  it.each(Object.keys(defaults) as EditableUvDistortEffectType[])('%s is owner-backed, one-pass, bounded, and rewires to source UV', type => {
    const effect = { type, params: {} }, graph = effectOperatorGraph(effect), params = effectOperatorParams(effect);
    expect(isImageGraphEffectType(type)).toBe(true); expect(isLocalImageEffectType(type)).toBe(false);
    expect(params).toMatchObject(defaults[type]); expect(graph.nodes.length).toBeLessThanOrEqual(64);
    const plan = compileImageOperatorGraph(graph, params); expect(plan.passes).toBeUndefined();
    const rewired = structuredClone(graph), uvEdge = rewired.edges.find(item => item.to === 'sample' && item.input === 'uv')!;
    uvEdge.from = 'uv'; uvEdge.output = 'uv';
    const uv: UV = [.31, .67], sampled: UV[] = [];
    evaluateImageOperatorPlan(compileImageOperatorGraph(rewired, params), source(uv), { uv, sampleImage: at => { sampled.push(at); return source(at); } });
    expect(sampled[0]).toEqual(uv);
  });
});
