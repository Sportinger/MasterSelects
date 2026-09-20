import { describe, expect, it } from 'vitest';
import { grain } from '../../src/effects/stylize/grain';
import { scanlines } from '../../src/effects/stylize/scanlines';
import { createDefaultGrainGraph, createDefaultScanlinesGraph } from '../../src/services/operators/contextualEffectGraphs';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const scanParams = { density: 5, opacity: 0.3, speed: 2 };
const grainParams = { amount: 0.1, size: 1, speed: 1, seed: 0 };

describe('timeline-context image operator graphs', () => {
  it('matches the exact scanlines formula and preserves straight alpha', () => {
    const plan = compileImageOperatorGraph(createDefaultScanlinesGraph(), scanParams);
    expect(plan.capabilities).toEqual(['uv', 'time']);
    expect(plan.wgsl).toContain('inputColor: vec4f, inputUv: vec2f, timelineTimeSeconds: f32, imageParameters: ImageOperatorParameters');
    expect(() => evaluateImageOperatorPlan(plan, [0.2, 0.4, 0.6, 0.25], { uv: [0.25, 0.75] })).toThrow(/timeline time/);
    const time = 3;
    const scanline = Math.sin((0.75 + time * scanParams.speed * 0.1) * scanParams.density * 100) * 0.5 + 0.5;
    const darken = 1 - scanParams.opacity * (1 - scanline);
    const result = evaluateImageOperatorPlan(plan, [0.2, 0.4, 0.6, 0.25], { uv: [0.25, 0.75], timelineTimeSeconds: time });
    expect(result.slice(0, 3)).toEqual([0.2, 0.4, 0.6].map(value => expect.closeTo(value * darken, 10)));
    expect(result[3]).toBe(0.25);
  });

  it('matches Rec709 luminance-aware grain and gives seed a dynamic stable slot', () => {
    const graph = createDefaultGrainGraph();
    const first = compileImageOperatorGraph(graph, grainParams);
    const second = compileImageOperatorGraph(graph, { ...grainParams, seed: 7 });
    expect(first.key).toBe(second.key);
    expect(first.wgsl).toBe(second.wgsl);
    expect(first.capabilities).toEqual(['uv', 'time']);
    expect(first.instructions.map(item => item.operation)).toEqual(expect.arrayContaining(['time', 'add-vec2', 'dot-vec2', 'sin-scalar', 'luminance-rec709']));
    const pixel: [number, number, number, number] = [0.2, 0.4, 0.6, 0.3];
    const uv: [number, number] = [0.125, 0.75];
    const time = 2;
    const phase = (uv[0] * 100 + time * 0.1) * 12.9898 + (uv[1] * 100 + time * 0.07) * 78.233;
    const unitNoise = Math.sin(phase) * 43758.5453 - Math.floor(Math.sin(phase) * 43758.5453);
    const noise = unitNoise * 2 - 1;
    const luma = pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
    const delta = noise * grainParams.amount * (1 - luma * 0.5);
    const expected = pixel.slice(0, 3).map(value => Math.max(0, Math.min(1, value + delta)));
    const result = evaluateImageOperatorPlan(first, pixel, { uv, timelineTimeSeconds: time });
    expect(result.slice(0, 3)).toEqual(expected.map(value => expect.closeTo(value, 9)));
    expect(result[3]).toBe(pixel[3]);
    expect(evaluateImageOperatorPlan(second, pixel, { uv, timelineTimeSeconds: time })).not.toEqual(result);
  });

  it('keeps the legacy parameter metadata and creates graphless canonical owners', () => {
    expect(scanlines.params).toMatchObject({ density: { default: 5, min: 1, max: 20 }, opacity: { default: 0.3, min: 0, max: 1 }, speed: { default: 0, min: 0, max: 5 } });
    expect(grain.params).toMatchObject({ amount: { default: 0.1, min: 0, max: 0.5 }, size: { default: 1, min: 0.5, max: 5 },
      speed: { default: 1, min: 0, max: 5 }, seed: { default: 0, min: 0, max: 65535 } });
    expect(effectOperatorGraph({ type: 'scanlines', params: scanParams }).nodes.some(node => node.operator === 'image.timeline-time')).toBe(true);
    expect(effectOperatorGraph({ type: 'grain', params: grainParams }).nodes.some(node => node.operator === 'color.luminance-rec709.rgb')).toBe(true);
    const migrated = migratePersistedEffectOperatorGraph({ id: 'legacy-grain', name: 'Film Grain', type: 'grain', enabled: true,
      params: { amount: 0.1, size: 1, speed: 1 } });
    expect(migrated.params.seed).toBe(0);
    expect(migrated.operatorGraph?.nodes.some(node => node.operator === 'image.timeline-time')).toBe(true);
    const invalid = createDefaultGrainGraph();
    invalid.edges = invalid.edges.filter(edge => edge.to !== 'output');
    expect(() => effectOperatorGraph({ type: 'grain', params: grainParams, operatorGraph: invalid })).toThrow();
  });
});
