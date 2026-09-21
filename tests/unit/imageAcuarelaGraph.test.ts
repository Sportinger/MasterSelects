import { describe, expect, it } from 'vitest';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';

const source = ([u, v]: [number, number]): [number, number, number, number] => [u, v, .2 + u * .3, .4];
const feedback = (): [number, number, number, number] => [.8, .2, .5, .7];
const fract = (value: number) => value - Math.floor(value);
const hash = (x: number, y: number) => fract(Math.sin((x * 127.1 + y * 311.7) * 12.9898 + (x * 269.5 + y * 183.3) * 78.233) * 43758.5453);
const noise = (x: number, y: number) => { const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y), ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) * (1 - ux) + hash(ix + 1, iy) * ux, b = hash(ix, iy + 1) * (1 - ux) + hash(ix + 1, iy + 1) * ux; return a * (1 - uy) + b * uy; };
const fbm = (x: number, y: number, time: number): [number, number] => { let sx = 0, sy = 0, norm = 0;
  [1, 2, 4, 8].forEach((frequency, index) => { const amplitude = [.5, .265, .14045, .0744385][index], t = time + index * 13.37, px = x * frequency, py = y * frequency;
    sx += (noise(px + t * .19, py + t * .31) * 2 - 1) * amplitude; sy += (noise(px * 1.173 + 19.17 - t * .27, py * 1.173 + 7.31 + t * .16) * 2 - 1) * amplitude; norm += amplitude; });
  return [sx / norm, sy / norm]; };

describe('Acuarela image graph', () => {
  it('binds the legacy shader parameters and the explicit frame-history source within budget', () => {
    const graph = createDefaultAcuarelaGraph();
    for (const id of ['opacity', 'gain', 'speed', 'detail', 'strength', 'density', 'gainX', 'gainY']) {
      expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    }
    expect(graph.nodes.find(node => node.id === 'reset')).toBeUndefined();
    expect(graph.nodes.find(node => node.id === 'feedback')).toMatchObject({ operator: 'image.frame-history', bindings: {} });
    expect(graph.nodes.find(node => node.id === 'safe-speed')?.operator).toBe('math.max.scalar');
    expect(graph.nodes.find(node => node.id === 'noise-scale')).toBeUndefined();
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'safe-density', to: 'density-uv', input: 'b' }),
      expect.objectContaining({ from: 'density-uv', to: 'noise-uv', input: 'a' }),
      expect.objectContaining({ from: 'safe-detail', to: 'noise-uv', input: 'b' }),
      expect.objectContaining({ from: 'amplitude-0', to: 'amplitude-1', input: 'a' }),
      expect.objectContaining({ from: 'amplitude-1', to: 'amplitude-2', input: 'a' }),
      expect.objectContaining({ from: 'amplitude-2', to: 'amplitude-3', input: 'a' }),
      expect.objectContaining({ from: 'gain-vector', to: 'gain-strength', input: 'a' }),
      expect.objectContaining({ from: 'gain-strength', to: 'offset-gain-scale', input: 'a' }),
      expect.objectContaining({ from: 'offset-gain-scale', to: 'offset', input: 'b' }),
    ]));
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
  });

  it('matches the zero-strength legacy feedback blend and sampled alpha', () => {
    const params = { opacity: 1, gain: 0, speed: 4, detail: 4, strength: 0, density: 4, gainX: .3, gainY: .3 };
    const plan = compileImageOperatorGraph(createDefaultAcuarelaGraph(), params, { allowFrameHistory: true });
    expect(plan.frameHistoryResource).toBe('effect-history');
    const uv: [number, number] = [.5, .5], current = source(uv), prior = feedback(), decay = .98, memoryMix = .04;
    const expectedRgb = current.slice(0, 3).map((value, index) => value * (1 - memoryMix) + prior[index] * decay * memoryMix);
    const expected = [...expectedRgb, Math.max(current[3], prior[3] * decay)] as [number, number, number, number];
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution: [8, 8], timelineTimeSeconds: .75,
      sampleImage: source, sampleResource: (id) => { expect(id).toBe('effect-history'); return feedback(); } });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
  });

  it('returns the original source exactly when opacity is zero', () => {
    const params = { opacity: 0, gain: .7, speed: 9, detail: 7, strength: 1, density: 80, gainX: 1, gainY: 1 };
    const plan = compileImageOperatorGraph(createDefaultAcuarelaGraph(), params, { allowFrameHistory: true });
    const uv: [number, number] = [.42, .61];
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution: [8, 8], timelineTimeSeconds: 1.2,
      sampleImage: source, sampleResource: () => feedback() })).toEqual(source(uv));
  });

  it('matches nonzero four-octave displacement and timeline sampling', () => {
    const params = { opacity: .8, gain: 0, speed: 2, detail: 1.5, strength: .6, density: 2, gainX: .4, gainY: .25 }, time = .7, uv: [number, number] = [.5, .5];
    const driven = time * params.speed * .75, base = fbm(uv[0] * params.density * params.detail, uv[1] * params.density * params.detail, driven);
    const offset: [number, number] = [base[0] * params.gainX * params.strength * .024, base[1] * -params.gainY * params.strength * .024];
    const warped: [number, number] = [uv[0] + offset[0], uv[1] + offset[1]], wet = source(warped);
    const smears = [source([uv[0] + offset[0] * .45, uv[1] + offset[1] * .45]), source([uv[0] - offset[0] * .65, uv[1] - offset[1] * .65]),
      source([uv[0] - offset[1] * .5, uv[1] + offset[0] * .5])], current = source(uv), prior = feedback(), wash = [0, 1, 2].map(i => (wet[i] + smears[0][i] + smears[1][i] + smears[2][i]) * .25);
    const warpMix = params.strength * .92, warpedRgb = wash.map((value, i) => current[i] * (1 - warpMix) + value * warpMix), feedbackMix = params.strength * .1 + params.opacity * .04;
    const waterRgb = warpedRgb.map((value, i) => Math.min(value * (1 - feedbackMix) + prior[i] * .98 * feedbackMix, Math.max(current[i], wash[i]) + .1));
    const waterAlpha = Math.max(current[3], prior[3] * .98), expected = waterRgb.map((value, i) => current[i] * .2 + value * .8).concat(current[3] * .2 + waterAlpha * .8);
    const plan = compileImageOperatorGraph(createDefaultAcuarelaGraph(), params, { allowFrameHistory: true });
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution: [8, 8], timelineTimeSeconds: time, sampleImage: source, sampleResource: () => feedback() });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 8));
  });
});
