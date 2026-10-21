import { describe, expect, it } from 'vitest';
import { chromaKey } from '../../src/effects/keying/chroma-key';
import { chromaKeyNumbers } from '../../src/effects/keying/chroma-key/keyerContract';
import { chromaKeyCpuPixel, chromaKeyCpuScreen } from '../../src/effects/keying/chroma-key/keyerCpu';
import { createDefaultChromaKeyGraph } from '../../src/services/operators/chromaKeyEffectGraph';
import { upgradeChromaKeyGraph } from '../../src/services/operators/chromaKeyGraphUpgrade';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createLegacyChromaKeyGraph } from '../../src/services/operators/legacyChromaKeyEffectGraph';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';

type Rgba = [number, number, number, number];
const SCREEN: [number, number, number] = [60 / 255, 150 / 255, 70 / 255];
const hex = (rgb: readonly number[]) => `#${rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
const smoothstep = (low: number, high: number, value: number) => { const t = Math.min(1, Math.max(0, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Independent reference of the documented keyer (keyerContract.ts) for a fixed screen colour (pick),
 * straight 0..1 RGBA in and out: matte, screen subtraction, spill. */
function reference(color: Rgba, screen: readonly number[], channel: number,
  params: { clipBlack: number; clipWhite: number; spill: number; method?: 'average' | 'max' }, found = 1): Rgba {
  const c = color.slice(0, 3).map(value => Math.max(0, value));
  const others = (values: number[]) => values.filter((_value, index) => index !== channel);
  const primary = c[channel], other = Math.max(...others(c)), screenPrimary = screen[channel];
  const screenDifference = Math.max(screenPrimary - Math.max(...others([...screen])), 1e-4);
  const brightness = Math.max(Math.min(Math.max(primary, .25 * screenPrimary), screenPrimary), 1e-4);
  const raw = 1 - clamp01((primary - other) * screenPrimary / (screenDifference * brightness) * found);
  const clipBlack = clamp01(params.clipBlack), clipWhite = clamp01(params.clipWhite);
  const matte = clamp01((raw - clipBlack) / Math.max(clipWhite - clipBlack, 1e-3));
  // Screen subtraction: c = matte * F + (1 - matte) * screen (dimmed to the pixel's level) solved for F.
  const dim = brightness / Math.max(screenPrimary, 1e-4), ceiling = Math.max(1, ...c), trust = smoothstep(0, .05, matte);
  const colour = c.map((value, index) => {
    const unmixed = Math.min(ceiling, Math.max(0, value - (1 - matte) * screen[index] * dim)) / Math.max(matte, 1e-4);
    return Math.min(ceiling, Math.max(0, value + (unmixed - value) * trust));
  });
  const rest = others(colour), limit = params.method === 'max' ? Math.max(...rest) : (rest[0] + rest[1]) / 2;
  colour[channel] -= Math.max(colour[channel] - limit, 0) * clamp01(params.spill) * found;
  return [colour[0], colour[1], colour[2], color[3] * matte];
}

function raster(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y).map(value => Math.round(value * 255)), (y * width + x) * 4);
  return data;
}

/** The compiled multi-pass graph on the CPU pass runner (float caches, RGBA8 output). */
function runGraph(data: Uint8ClampedArray, width: number, height: number, params: Record<string, unknown>): Uint8ClampedArray {
  const { plan } = prepareImageEffect({ type: 'chroma-key', params });
  const output = data.slice();
  applyWorkerSoftwareImageGraphs(output, width, height, [plan!], 0);
  return output;
}
const chromaKeyHexColorRounded = (rgb: readonly number[]) => rgb.map(value => Math.round(value * 255) / 255);
const read = (data: Uint8ClampedArray, width: number, x: number, y: number): Rgba =>
  Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), value => value / 255) as Rgba;

const SAMPLES: Rgba[] = [
  [...SCREEN, 1], [.02, .1, .04, 1], [.6, .72, .55, 1], [.42, .55, .4, .8], [.9, .92, .88, 1], [.85, .6, .5, 1],
  [.2, .25, .18, 1], [.1, .7, .2, .5], [.3, .2, .8, 1], [.5, .5, .5, 0], [.35, .48, .3, 1], [1, 1, 0, 1],
];

describe('Chroma Key screen-matte graph', () => {
  it('is a granular graph of shared nodes with a 64 px and a 1 px screen cache', () => {
    const graph = createDefaultChromaKeyGraph();
    expect(validateEffectGraph(graph)).toEqual([]);
    const bound = Object.fromEntries(graph.nodes.filter(node => node.bindings.value).map(node => [node.bindings.value, node.operator]));
    expect(bound).toMatchObject({ keyColor: 'values.choice', screenColor: 'values.color', clipBlack: 'values.number', clipWhite: 'values.number',
      spillSuppression: 'values.number', spillMethod: 'values.choice', edgeSoftness: 'values.number', edgeShrink: 'values.number', view: 'values.choice' });
    expect(graph.nodes.some(node => node.operator.includes('chroma'))).toBe(false);
    expect(graph.nodes.filter(node => node.operator === 'image.materialize').map(node => node.constants?.maxEdge ?? 0).toSorted())
      .toEqual([0, 0, 0, 0, 1, 64]);
  });

  it('adds no full-resolution pass while Edge Softness and Shrink/Grow are 0', () => {
    const passes = (params: Record<string, unknown>) => prepareImageEffect({ type: 'chroma-key', params }).plan!.passes!.map(pass => pass.outputResource ?? 'final');
    expect(passes({})).toEqual(['image-resource:screen-grid:image', 'image-resource:screen-color-estimate:image', 'final']);
    expect(passes({ edgeSoftness: 2 })).toContain('image-resource:edge-soften-rows:image');
    expect(passes({ edgeSoftness: 2 })).not.toContain('image-resource:edge-shrink-rows:image');
    expect(passes({ edgeShrink: -1 })).toContain('image-resource:edge-shrunk-cache:image');
  });

  it.each([
    ['green pick', SCREEN],
    ['blue pick', [.15, .3, .75] as [number, number, number]],
    ['red pick', [.8, .2, .25] as [number, number, number]],
  ])('keys a %s like the documented formula, spill and straight alpha included', (_name, screen) => {
    const channel = screen[1] >= Math.max(screen[0], screen[2]) ? 1 : screen[2] >= screen[0] ? 2 : 0;
    const settings = { clipBlack: .2, clipWhite: .9, spill: .75 };
    const width = SAMPLES.length, data = raster(width, 1, x => SAMPLES[x]);
    const output = runGraph(data, width, 1, { keyColor: 'custom', screenColor: hex(screen), clipBlack: .2, clipWhite: .9, spillSuppression: .75 });
    const picked = chromaKeyCpuScreen(data, { screen: 'custom', screenColor: screen.map(value => Math.round(value * 255) / 255) as [number, number, number], clipBlack: .2, clipWhite: .9, spillSuppression: .75, view: 'result' });
    for (let x = 0; x < width; x++) {
      const input = read(data, width, x, 0);
      const expected = reference(input, picked.color, channel, settings);
      const actual = read(output, width, x, 0);
      expect(actual[3]).toBeCloseTo(expected[3], 2);
      // Fully transparent pixels carry no meaningful colour.
      if (expected[3] > .02) for (let index = 0; index < 3; index++) expect(actual[index]).toBeCloseTo(clamp01(expected[index]), 2);
      // The worker CPU path uses the same contract.
      const cpu = chromaKeyCpuPixel(input, picked, { screen: 'custom', screenColor: picked.color as [number, number, number], clipBlack: .2, clipWhite: .9, spillSuppression: .75, view: 'result' });
      cpu.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
    }
  });

  it('measures an unevenly lit screen by itself and keys it fully; the subject stays solid', () => {
    const width = 48, height = 27;
    // Lit centre, dark corners (falloff), a white/skin subject block and a chiffon-like 50 % mix.
    const screenAt = (x: number, y: number): Rgba => {
      const light = .6 + .4 * Math.exp(-(((x - 24) / 20) ** 2 + ((y - 13) / 12) ** 2));
      return [SCREEN[0] * light, SCREEN[1] * light, SCREEN[2] * light, 1];
    };
    const subject = (x: number, y: number) => x >= 20 && x < 28 && y >= 9 && y < 18;
    const data = raster(width, height, (x, y) => subject(x, y) ? (x < 24 ? [.88, .66, .55, 1] : [.92, .92, .9, 1])
      : x >= 30 && x < 34 && y >= 10 && y < 16 ? [(.9 + SCREEN[0]) / 2, (.9 + SCREEN[1]) / 2, (.88 + SCREEN[2]) / 2, 1] : screenAt(x, y));
    const output = runGraph(data, width, height, { keyColor: 'green' });
    // Independent estimate: weighted mean over every pixel.
    let weight = 0; const sum = [0, 0, 0];
    for (let index = 0; index < width * height; index++) {
      const c = [0, 1, 2].map(channel => data[index * 4 + channel] / 255);
      const w = smoothstep(.1, .3, (c[1] - Math.max(c[0], c[2])) / Math.max(c[1], 1e-4)) * smoothstep(.03, .12, c[1]);
      weight += w; c.forEach((value, channel) => { sum[channel] += w * value; });
    }
    const estimate = sum.map(value => value / weight);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const alpha = read(output, width, x, y)[3];
      if (subject(x, y)) expect(alpha).toBe(1);
      else if (!(x >= 29 && x < 35 && y >= 9 && y < 17)) expect(alpha).toBeLessThan(.02);
    }
    const mixed = reference(read(data, width, 32, 12), estimate, 1, { clipBlack: .3, clipWhite: .85, spill: 1 });
    expect(read(output, width, 32, 12)[3]).toBeCloseTo(mixed[3], 1);
  });

  it('recovers the coverage of a light subject mixed into the screen (hair, chiffon, motion blur)', () => {
    // A light grey subject F mixed into the screen with coverage k: the matte follows k (the max-of-others
    // difference bends it by a few per cent), and screen subtraction makes the keyed pixel composite like the
    // real mix: over any background B, a * colour + (1 - a) * B stays close to k * F + (1 - k) * B.
    const width = 200, height = 12, subject = [.85, .86, .84];
    const coverage = (x: number) => Math.min(1, Math.max(0, (x - 90) / 20)) * (x < 130 ? 1 : 0);
    const data = raster(width, height, x => [0, 1, 2].map(index => coverage(x) * subject[index] + (1 - coverage(x)) * SCREEN[index]).concat(1) as Rgba);
    const expectedMatte = (x: number) => coverage(x) * (1 - (subject[1] - subject[0]) / (SCREEN[1] - SCREEN[2]));
    const picked = runGraph(data, width, height, { keyColor: 'custom', screenColor: hex(SCREEN), clipBlack: 0, clipWhite: 1 });
    // The automatic estimate sees the mixed pixels as slightly less pure screen: a small, bounded bias.
    const auto = runGraph(data, width, height, { keyColor: 'green', clipBlack: 0, clipWhite: 1 });
    for (let x = 0; x < width; x++) {
      expect(read(picked, width, x, 6)[3]).toBeCloseTo(expectedMatte(x), 1);
      expect(Math.abs(read(auto, width, x, 6)[3] - expectedMatte(x))).toBeLessThan(.08);
      const keyed = read(picked, width, x, 6);
      for (const background of [0, 1]) for (let index = 0; index < 3; index++) {
        const truth = coverage(x) * subject[index] + (1 - coverage(x)) * background;
        expect(Math.abs(keyed[3] * keyed[index] + (1 - keyed[3]) * background - truth)).toBeLessThan(.05);
      }
    }
  });

  it('subtracts the local screen colour behind thin strands, and never a wide veil as its own screen', () => {
    // Left half a lighter, right half the plain screen (the same screen difference, so the matte is exact).
    // 1 px strands and one 60 px veil of 50 % white chiffon (F = 0.9).
    const width = 640, height = 40, chiffon = .9, row = 20;
    const screenAt = (x: number) => SCREEN.map(value => value + (x < width / 2 ? .15 : 0));
    const strand = (x: number) => x === 160 || x === 480, veil = (x: number) => x >= 200 && x < 260;
    const data = raster(width, height, x => screenAt(x).map(value => strand(x) || veil(x) ? .5 * chiffon + .5 * value : value).concat(1) as Rgba);
    const output = runGraph(data, width, height, { keyColor: 'green', clipBlack: 0, clipWhite: 1 });
    // Composited over black a correctly keyed pixel shows 0.5 * F in every channel.
    const error = (pixel: readonly number[]) => Math.max(...[0, 1, 2].map(index => Math.abs(pixel[3] * pixel[index] - .5 * chiffon)));
    for (const x of [160, 480]) {
      expect(read(output, width, x, row)[3]).toBeCloseTo(.5, 1);
      expect(error(read(output, width, x, row))).toBeLessThan(.025);
    }
    // The veil fills whole grid cells; it falls back to the frame estimate instead of subtracting itself.
    for (const x of [215, 230, 245]) expect(error(read(output, width, x, row))).toBeLessThan(.06);
    // One frame-wide screen colour (no grid) subtracts the wrong screen at the strands: the local grid matters.
    const settings = { screen: 'green', screenColor: SCREEN, clipBlack: 0, clipWhite: 1, spillSuppression: 1, view: 'result' } as const;
    const flatScreen = chromaKeyCpuScreen(data, settings), localScreen = chromaKeyCpuScreen(data, settings, width, height);
    for (const x of [160, 480]) {
      const input = read(data, width, x, row);
      const flat = chromaKeyCpuPixel(input, flatScreen, settings), local = chromaKeyCpuPixel(input, localScreen, settings, x, row);
      expect(error(local)).toBeLessThan(.025);
      expect(error(flat)).toBeGreaterThan(error(local) + .02);
    }
  });

  it('limits spill to the mean of the other channels (Neutral) or to the stronger one (Gentle)', () => {
    // Opaque pixels (no screen share): brown hair with a green cast, and a yellow costume.
    const hair: Rgba = [.42, .4, .22, 1], yellow: Rgba = [.9, .8, .1, 1];
    const data = raster(64, 36, (x, y) => x === 10 && y === 10 ? hair : x === 20 && y === 10 ? yellow : [...SCREEN, 1]);
    const neutral = runGraph(data, 64, 36, { keyColor: 'green' }), gentle = runGraph(data, 64, 36, { keyColor: 'green', spillMethod: 'max' });
    const near = (actual: Rgba, expected: number[]) => expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 2));
    const hairIn = read(data, 64, 10, 10), yellowIn = read(data, 64, 20, 10);
    near(read(neutral, 64, 10, 10), [hairIn[0], (hairIn[0] + hairIn[2]) / 2, hairIn[2]]);
    near(read(gentle, 64, 10, 10), [hairIn[0], Math.min(hairIn[1], hairIn[0]), hairIn[2]]);
    near(read(neutral, 64, 20, 10), [yellowIn[0], (yellowIn[0] + yellowIn[2]) / 2, yellowIn[2]]);
    near(read(gentle, 64, 20, 10), yellowIn.slice(0, 3));
  });

  it('keys nothing when the frame holds no screen, and says so through the matte (no silent garbage)', () => {
    const data = raster(16, 9, (x, y) => [.5 + x / 40, .4 + y / 40, .35, 1]);
    const output = runGraph(data, 16, 9, { keyColor: 'green', view: 'matte' });
    for (let index = 0; index < 16 * 9; index++) expect(output[index * 4]).toBe(255);
    const greyPick = runGraph(data, 16, 9, { keyColor: 'custom', screenColor: '#808080' });
    expect(greyPick).toEqual(data);
  });

  it('clamps out-of-range values, reports them, and still renders a defined image', () => {
    expect(chromaKeyNumbers({ spillSuppression: 7, edgeSoftness: -3, edgeShrink: 400, clipBlack: 1.5, clipWhite: -2 })).toEqual({
      clipBlack: 1, clipWhite: 0, spill: 1, softness: 0, shrink: 20, clamped: ['clipBlack', 'clipWhite', 'spillSuppression', 'edgeSoftness', 'edgeShrink'],
    });
    expect(chromaKeyNumbers({ clipBlack: Number.NaN, edgeSoftness: 'wide' })).toMatchObject({ clipBlack: .3, softness: 0, clamped: ['clipBlack', 'edgeSoftness'] });
    expect(chromaKeyNumbers({}).clamped).toEqual([]);
    const width = SAMPLES.length, data = raster(width, 1, x => SAMPLES[x]);
    for (const params of [{ clipBlack: 1.5, clipWhite: -2, spillSuppression: 7 }, { clipBlack: -4, clipWhite: -3 }, { clipBlack: -1, clipWhite: 3 }]) {
      const output = runGraph(data, width, 1, { keyColor: 'custom', screenColor: hex(SCREEN), ...params });
      for (let x = 0; x < width; x++) {
        const input = read(data, width, x, 0);
        const expected = reference(input, chromaKeyHexColorRounded(SCREEN), 1, { clipBlack: params.clipBlack, clipWhite: params.clipWhite, spill: params.spillSuppression ?? 1 });
        const actual = read(output, width, x, 0);
        expect(actual.every(Number.isFinite)).toBe(true);
        expect(actual[3]).toBeCloseTo(expected[3], 2);
        if (expected[3] > .02) for (let index = 0; index < 3; index++) expect(actual[index]).toBeCloseTo(clamp01(expected[index]), 2);
      }
    }
  });
});

describe('Chroma Key edge (Shrink/Grow, Edge Softness)', () => {
  // 108 px short side: one 1080p pixel is 0.1 px here, so 20 is 2 px.
  const size = 108, edgeX = 54, row = 54;
  const data = raster(size, size, x => x < edgeX ? [...SCREEN, 1] : [.9, .9, .88, 1]);
  const semi = raster(size, size, x => x < 20 || x >= 88 ? [...SCREEN, 1] : [(.9 + SCREEN[0]) / 2, (.9 + SCREEN[1]) / 2, (.88 + SCREEN[2]) / 2, 1]);
  const params = { keyColor: 'custom', screenColor: hex(SCREEN), clipBlack: 0, clipWhite: 1 };
  const alphaRow = (output: Uint8ClampedArray) => Array.from({ length: size }, (_value, x) => output[(row * size + x) * 4 + 3] / 255);
  /** Sub-pixel position where alpha crosses 0.5 (pixel x spans x..x+1). */
  const crossing = (alpha: number[]) => {
    for (let x = 1; x < size; x++) if (alpha[x] >= .5 && alpha[x - 1] < .5) return x - .5 + (.5 - alpha[x - 1]) / (alpha[x] - alpha[x - 1]);
    return NaN;
  };
  const ramp = (alpha: number[]) => alpha.findIndex(value => value >= .9) - alpha.findIndex(value => value >= .1);

  it('moves a hard edge by Shrink/Grow pixels of a 1080p frame and softens it by Edge Softness', () => {
    const plain = alphaRow(runGraph(data, size, size, params));
    expect(crossing(plain)).toBeCloseTo(edgeX, 0);
    expect(ramp(plain)).toBeLessThanOrEqual(1);
    const shrunk = alphaRow(runGraph(data, size, size, { ...params, edgeShrink: 20 }));
    const grown = alphaRow(runGraph(data, size, size, { ...params, edgeShrink: -20 }));
    expect(crossing(shrunk) - edgeX).toBeGreaterThan(1.4); expect(crossing(shrunk) - edgeX).toBeLessThan(2.6);
    expect(edgeX - crossing(grown)).toBeGreaterThan(1.4); expect(edgeX - crossing(grown)).toBeLessThan(2.6);
    // No step where the soft-minimum window leaves the screen.
    for (let x = 1; x < size; x++) expect(Math.abs(shrunk[x] - shrunk[x - 1])).toBeLessThan(.6);
    const soft = alphaRow(runGraph(data, size, size, { ...params, edgeSoftness: 20 }));
    expect(crossing(soft)).toBeCloseTo(edgeX, 0);
    expect(ramp(soft)).toBeGreaterThanOrEqual(1); expect(ramp(soft)).toBeLessThanOrEqual(3);
  });

  it('never grows or softens the subject in from transparent source pixels (inset layers)', () => {
    // Left of the edge transparent (an inset or pre-keyed layer), right the screen: nothing may appear.
    const inset = raster(size, size, x => x < edgeX ? [0, 0, 0, 0] : [...SCREEN, 1]);
    for (const extra of [{}, { edgeShrink: -20 }, { edgeSoftness: 20 }, { edgeShrink: -20, edgeSoftness: 20 }]) {
      for (const value of alphaRow(runGraph(inset, size, size, { ...params, ...extra }))) expect(value).toBeLessThan(.01);
    }
  });

  it('keeps flat semi-transparent areas while shrinking or growing', () => {
    const plain = alphaRow(runGraph(semi, size, size, params))[54];
    expect(plain).toBeGreaterThan(.3);
    expect(alphaRow(runGraph(semi, size, size, { ...params, edgeShrink: 10 }))[54]).toBeCloseTo(plain, 2);
    expect(alphaRow(runGraph(semi, size, size, { ...params, edgeShrink: -10 }))[54]).toBeCloseTo(plain, 2);
  });
});

describe('Chroma Key saved projects', () => {
  it('upgrades an untouched Rec.601 graph and keeps edited graphs as saved', () => {
    const legacy = createLegacyChromaKeyGraph();
    expect(upgradeChromaKeyGraph(legacy).nodes.some(node => node.id === 'screen-grid')).toBe(true);
    const edited = createLegacyChromaKeyGraph();
    edited.nodes.find(node => node.id === 'outer-tolerance')!.bypassed = true;
    expect(upgradeChromaKeyGraph(edited)).toBe(edited);
    // The edited graph still compiles against the retired parameters.
    expect(() => compileImageOperatorGraph(edited, { keyColor: 'green', tolerance: .3, softness: .1, spillSuppression: .5 },
      { parameterSchema: chromaKey.params })).not.toThrow();
    expect(effectOperatorGraph({ type: 'chroma-key', params: {}, operatorGraph: legacy }).nodes.some(node => node.id === 'screen-grid')).toBe(true);
  });

  it('retires Tolerance and the old Edge Softness with a reason for tools', () => {
    expect(chromaKey.params.tolerance).toMatchObject({ hidden: true, deprecated: expect.stringContaining('Clip Black') });
    expect(chromaKey.params.softness).toMatchObject({ hidden: true, deprecated: expect.stringContaining('Clip White') });
  });
});
