import { describe, expect, it } from 'vitest';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';
import { applyWorkerSoftwareMirrorPixelEffects, workerSoftwareMirrorPixelAdjustment } from '../../src/services/render/workerSoftwareMirrorPixelEffects';

/**
 * Independent CPU references for the Kaleidoscope, Mirror, RGB Split, Pixelate, Blockify and Block
 * Mosaic recipes (docs/Features/Effects-Mirror-Pixel.md), evaluated on discrete images through the
 * real multi-pass plans: cached passes are textures of the frame size read with bilinear filtering
 * and stored as float16, like the GPU's rgba16float caches.
 */
type UV = [number, number];
const fract = (value: number) => value - Math.floor(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const premultiply = ([r, g, b, a]: Pixel): Pixel => [r * a, g * a, b * a, a];
const straight = ([r, g, b, a]: Pixel): Pixel => { const safe = Math.max(a, 1e-6); return [r / safe, g / safe, b / safe, a]; };

function plan(type: string, params: Record<string, unknown>) {
  const effect = { type, params };
  const resolved = effectOperatorParams(effect);
  return compileImageOperatorGraph(effectOperatorGraph(effect), resolved, effectOperatorCompileContext(effect));
}

/** A texel pattern with colour detail and a transparent corner. */
const texel = (x: number, y: number): Pixel => [fract(x * .37 + y * .11), fract(y * .23 + .4), fract((x + y) * .17 + .2), x < 2 && y < 2 ? 0 : .4 + fract(x * .13) * .6];

/** Encodes the read position: rgb = (u, v, .3), constant alpha, so a straight output is the UV it read. */
const position = ([u, v]: UV): Pixel => [u, v, .3, .5];

function readUv(type: string, params: Record<string, unknown>, uv: UV, resolution: UV = [1920, 1080]): UV {
  const evaluate = createImagePassEvaluator(plan(type, params), resolution, position);
  const [u, v] = evaluate(uv);
  return [u, v];
}

const mirrorRepeat = (value: number) => 1 - Math.abs(fract(value * .5) * 2 - 1);
const edgeUv = (uv: UV, edges: string): UV => edges === 'mirror' ? [mirrorRepeat(uv[0]), mirrorRepeat(uv[1])] : [clamp(uv[0], 0, 1), clamp(uv[1], 0, 1)];

describe('Kaleidoscope recipe', () => {
  function reference(uv: UV, params: { segments: number; rotation?: number; sourceAngle?: number; zoom?: number; centerX?: number; centerY?: number; shape?: string; edges?: string },
    [width, height]: UV = [1920, 1080]): UV {
    const short = Math.min(width, height), scale: UV = params.shape === 'frame' ? [1, 1] : [width / short, height / short];
    const center: UV = [params.centerX ?? .5, params.centerY ?? .5];
    const p: UV = [(uv[0] - center[0]) * scale[0], (uv[1] - center[1]) * scale[1]];
    const angle = Math.atan2(p[1], p[0]) + (params.rotation ?? 0), radius = Math.hypot(...p) / Math.max(params.zoom ?? 1, .01);
    const count = clamp(params.segments, 2, 64), low = Math.floor(count), t = count - low;
    const read = (n: number): UV => {
      const wedge = Math.PI * 2 / n, folded = wedge * (.5 - Math.abs(fract(angle / wedge) - .5)) + (params.sourceAngle ?? 0);
      return edgeUv([center[0] + Math.cos(folded) * radius / scale[0], center[1] + Math.sin(folded) * radius / scale[1]], params.edges ?? 'mirror');
    };
    const a = read(low), b = read(low + 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  it.each([
    [{ segments: 6 }, [.71, .33]],
    [{ segments: 3, rotation: -2.4, sourceAngle: .6, zoom: 1.7, centerX: .4, centerY: .6 }, [.18, .24]],
    [{ segments: 12, rotation: 9, shape: 'frame', edges: 'clamp' }, [.95, .91]],
    [{ segments: 5.25, sourceAngle: -2.1 }, [.62, .12]],
    [{ segments: 7, zoom: .4, edges: 'clamp' }, [.03, .97]],
  ] as const)('reads the folded, turned and zoomed position with Frame Edges (%j)', (params, uv) => {
    const actual = readUv('kaleidoscope', { ...params }, [...uv] as UV), expected = reference([...uv] as UV, { ...params });
    expect(actual[0]).toBeCloseTo(expected[0], 9); expect(actual[1]).toBeCloseTo(expected[1], 9);
  });

  it('keeps wedges round on a wide frame: points at equal on-screen distance read at equal distance', () => {
    const right = readUv('kaleidoscope', { segments: 1e9 }, [.5 + .2 * 1080 / 1920, .5]);
    const down = readUv('kaleidoscope', { segments: 1e9 }, [.5, .7]);
    const distance = ([u, v]: UV) => Math.hypot((u - .5) * 1920 / 1080, v - .5);
    expect(distance(right)).toBeCloseTo(distance(down), 9);
  });

  it('has no seam across the mirror lines or the ±180° wrap for whole segment counts', () => {
    for (const segments of [2, 3, 5, 6, 11]) for (const angle of [Math.PI, Math.PI / segments, 2 * Math.PI / segments, -Math.PI / 2]) {
      const at = (offset: number): UV => [.5 + Math.cos(angle + offset) * .3 * 1080 / 1920, .5 + Math.sin(angle + offset) * .3];
      const before = readUv('kaleidoscope', { segments }, at(-1e-6)), after = readUv('kaleidoscope', { segments }, at(1e-6));
      expect(Math.hypot(before[0] - after[0], before[1] - after[1])).toBeLessThan(1e-5);
    }
  });

  it('crossfades fractional counts continuously, so an animated count never jumps', () => {
    const uv: UV = [.66, .29];
    const values = [5, 5.001, 5.5, 5.999, 6].map(segments => readUv('kaleidoscope', { segments }, uv));
    expect(values[1][0]).toBeCloseTo(values[0][0], 2); expect(values[3][0]).toBeCloseTo(values[4][0], 2);
  });

  it('clamps any segment count or zoom that arrives instead of producing NaN', () => {
    for (const [segments, zoom] of [[0, 1], [-3, 1], [1e6, 1], [6, 0], [6, -2], [1.5, 1e-9]]) {
      const actual = readUv('kaleidoscope', { segments, zoom }, [.3, .8]);
      expect(actual.every(Number.isFinite)).toBe(true);
      const expected = reference([.3, .8], { segments, zoom });
      expect(actual[0]).toBeCloseTo(expected[0], 9); expect(actual[1]).toBeCloseTo(expected[1], 9);
    }
  });
});

describe('Mirror recipe', () => {
  function reference(uv: UV, params: { horizontal?: boolean; vertical?: boolean; keep?: string; angle?: number; centerX?: number; centerY?: number; edges?: string }): UV {
    const scale: UV = [1920 / 1080, 1], center: UV = [params.centerX ?? .5, params.centerY ?? .5], angle = params.angle ?? 0;
    const p: UV = [(uv[0] - center[0]) * scale[0], (uv[1] - center[1]) * scale[1]], c = Math.cos(angle), s = Math.sin(angle);
    let x = p[0] * c + p[1] * s, y = -p[0] * s + p[1] * c;
    const sign = params.keep === 'end' ? 1 : -1;
    if (params.horizontal !== false) x = Math.abs(x) * sign;
    if (params.vertical === true) y = Math.abs(y) * sign;
    return edgeUv([center[0] + (x * c - y * s) / scale[0], center[1] + (x * s + y * c) / scale[1]], params.edges ?? 'mirror');
  }

  it('keeps the original left-onto-right mirror by default', () => {
    for (const uv of [[.8, .7], [.2, .3], [.5001, .1]] as UV[]) {
      const actual = readUv('mirror', {}, uv);
      expect(actual[0]).toBeCloseTo(uv[0] > .5 ? 1 - uv[0] : uv[0], 12); expect(actual[1]).toBeCloseTo(uv[1], 12);
    }
  });

  it.each([
    [{ horizontal: false, vertical: true }, [.3, .8]],
    [{ vertical: true, keep: 'end' }, [.2, .3]],
    [{ angle: Math.PI / 6, centerX: .4 }, [.75, .2]],
    [{ angle: -Math.PI / 4, vertical: true, centerY: .3, edges: 'clamp' }, [.1, .95]],
  ] as const)('reflects across the turned lines through Center (%j)', (params, uv) => {
    const actual = readUv('mirror', { ...params }, [...uv] as UV), expected = reference([...uv] as UV, { ...params });
    expect(actual[0]).toBeCloseTo(expected[0], 9); expect(actual[1]).toBeCloseTo(expected[1], 9);
  });

  it('is continuous at an angled mirror line: no gap and no doubled row', () => {
    const params = { angle: 25 * Math.PI / 180, centerX: .45, centerY: .55 }, normal: UV = [Math.cos(25 * Math.PI / 180) * 1080 / 1920, Math.sin(25 * Math.PI / 180)];
    const on: UV = [.45 + .1 * -normal[1] * 1080 / 1920, .55 + .1 * normal[0]];
    const before = readUv('mirror', params, [on[0] - normal[0] * 1e-7, on[1] - normal[1] * 1e-7]);
    const after = readUv('mirror', params, [on[0] + normal[0] * 1e-7, on[1] + normal[1] * 1e-7]);
    expect(Math.hypot(before[0] - after[0], before[1] - after[1])).toBeLessThan(1e-6);
  });
});

describe('RGB Split recipe', () => {
  it('reads red ahead and blue behind along the on-screen angle with the original length', () => {
    for (const [amount, angle] of [[.02, 0], [.02, Math.PI / 2], [.05, .7], [-.03, 2.2]]) {
      const uv: UV = [.41, .37], dx = Math.cos(angle), dy = Math.sin(angle);
      const length = Math.hypot(dx * 1920, dy * 1080) * amount, offset: UV = [dx * length / 1920, dy * length / 1080];
      const evaluate = createImagePassEvaluator(plan('rgb-split', { amount, angle, edges: 'clamp' }), [1920, 1080], ([u, v]) => [u, v, u + v, .6]);
      const [r, g, b, a] = evaluate(uv);
      expect(r).toBeCloseTo(clamp(uv[0] + offset[0], 0, 1), 9);
      expect(g).toBeCloseTo(uv[1], 9);
      expect(b).toBeCloseTo(clamp(uv[0] - offset[0], 0, 1) + clamp(uv[1] - offset[1], 0, 1), 9);
      expect(a).toBeCloseTo(.6, 9);
      // On screen the offset points along the angle (equal pixel ratios), unlike the former UV-space direction.
      if (amount && Math.abs(Math.sin(angle)) > 1e-3) expect(Math.atan2(offset[1] * 1080, offset[0] * 1920)).toBeCloseTo(Math.atan2(Math.sign(amount) * dy, Math.sign(amount) * dx), 9);
    }
  });

  it('Lens: no split in the centre, Amount × width at the left and right edges', () => {
    const evaluate = createImagePassEvaluator(plan('rgb-split', { amount: .02, mode: 'lens', edges: 'clamp' }), [1920, 1080], ([u, v]) => [u, v, u, 1]);
    expect(evaluate([.5, .5]).slice(0, 3)).toEqual([.5, .5, .5].map(value => expect.closeTo(value, 9)));
    const edge = evaluate([1, .5]);
    expect(edge[0]).toBeCloseTo(1 - .02, 9);
    expect(edge[2]).toBeCloseTo(1, 9);
  });

  it('keeps every plate coverage: a split cut-out shows its fringes over transparency', () => {
    const image = discreteImage(8, 1, x => (x === 3 || x === 4 ? [.9, .6, .3, 1] : [0, 0, 0, 0]));
    const evaluate = createImagePassEvaluator(plan('rgb-split', { amount: 1 / 8, angle: 0, edges: 'clamp' }), [8, 1], image, { filterResources: true, float16: true });
    // Pixel 2: only the red plate (read one pixel to the right) covers it.
    const red = evaluate([2.5 / 8, .5]);
    expect(red[3]).toBeCloseTo(1, 3); expect(red[0]).toBeCloseTo(.9, 3); expect(red[1]).toBeCloseTo(0, 3); expect(red[2]).toBeCloseTo(0, 3);
    const blue = evaluate([5.5 / 8, .5]);
    expect(blue[3]).toBeCloseTo(1, 3); expect(blue[2]).toBeCloseTo(.3, 3); expect(blue[0]).toBeCloseTo(0, 3);
  });
});

/** Centred grid cell of pixel (x, y) for a cell size in rendered pixels: [x0, x1, y0, y1] inside the frame. */
function referenceCell(x: number, y: number, cell: number, width: number, height: number): [number, number, number, number] {
  const ox = Math.floor(width / 2), oy = Math.floor(height / 2);
  const sx = ox + Math.floor((x + .5 - ox) / cell) * cell, sy = oy + Math.floor((y + .5 - oy) / cell) * cell;
  return [Math.max(0, sx), Math.min(width, sx + cell), Math.max(0, sy), Math.min(height, sy + cell)];
}
function referenceAverage(image: (x: number, y: number) => Pixel, [x0, x1, y0, y1]: [number, number, number, number]): Pixel {
  const sum: Pixel = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) premultiply(image(x, y)).forEach((value, channel) => { sum[channel] += value; });
  return sum.map(value => value / ((x1 - x0) * (y1 - y0))) as Pixel;
}
const expectClose = (actual: Pixel, expected: Pixel, digits = 3) => actual.forEach((value, channel) => expect(value).toBeCloseTo(expected[channel], digits));

describe('Pixelate recipe', () => {
  it.each([[3, 12, 8], [5, 13, 9], [4, 10, 7]] as const)('shows each centred %i-pixel cell as the average of its pixels (%i × %i)', (cell, width, height) => {
    // Pixel Size is measured on a 1080p frame: this size gives `cell` rendered pixels at this height.
    const size = cell * 1080 / Math.min(width, height);
    const evaluate = createImagePassEvaluator(plan('pixelate', { size }), [width, height], discreteImage(width, height, texel), { filterResources: true, float16: true });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const expected = straight(referenceAverage(texel, referenceCell(x, y, cell, width, height)));
      const actual = evaluate([(x + .5) / width, (y + .5) / height]);
      expect(actual[3]).toBeCloseTo(expected[3], 3);
      if (expected[3] > .05) expectClose(actual, expected, 2);
    }
  });

  it('spreads its taps evenly over cells wider than 128 rendered pixels', () => {
    const width = 300, image = discreteImage(width, 1, x => [x / width, 1 - x / width, .5, 1]);
    const evaluate = createImagePassEvaluator(plan('pixelate', { size: 1080 * width }), [width, 1], image, { filterResources: true, float16: true });
    // Two half-frame cells (150 px each, past the 128-pixel exact budget).
    expectClose(evaluate([10.5 / width, .5]), [74.5 / width, 1 - 74.5 / width, .5, 1], 2);
    expectClose(evaluate([290.5 / width, .5]), [224.5 / width, 1 - 224.5 / width, .5, 1], 2);
  });

  it('treats any size below one rendered pixel as 1-pixel cells and never produces NaN', () => {
    for (const size of [0, -5, .1, 1e9]) {
      const evaluate = createImagePassEvaluator(plan('pixelate', { size }), [6, 4], discreteImage(6, 4, texel), { filterResources: true });
      for (const uv of [[.1, .1], [.6, .8]] as UV[]) expect(evaluate(uv).every(Number.isFinite)).toBe(true);
    }
  });
});

describe('Blockify and Block Mosaic recipes', () => {
  it('Blockify posterizes the cell average to Levels steps and mixes with the original by Amount', () => {
    const width = 12, height = 8, cell = 3, size = cell * 1080 / 8;
    for (const [levels, amount] of [[6, 1], [3, .4], [2.4, 2]] as const) {
      const evaluate = createImagePassEvaluator(plan('blockify', { scale: size, levels, amount }), [width, height], discreteImage(width, height, texel), { filterResources: true, float16: true });
      for (const [x, y] of [[4, 5], [9, 1], [11, 7]]) {
        const average = referenceAverage(texel, referenceCell(x, y, cell, width, height)), [r, g, b, a] = straight(average);
        const steps = clamp(Math.floor(levels + .5), 2, 64) - 1, t = clamp(amount, 0, 1);
        const poster = [r, g, b].map(value => Math.floor(value * steps + .5) / steps);
        const original = premultiply(texel(x, y));
        const mixed = [...poster.map(value => value * a), a].map((value, channel) => original[channel] + (value - original[channel]) * t) as Pixel;
        expectClose(evaluate([(x + .5) / width, (y + .5) / height]), straight(mixed), 2);
      }
    }
  });

  /** The shared sine hash (noise.hash2d) of a large-tile index. */
  const hash = ([x, y]: UV) => fract(Math.sin((x * 127.1 + y * 311.7) * 12.9898 + (x * 269.5 + y * 183.3) * 78.233) * 43758.5453);

  it('Block Mosaic draws whole square tiles: small ones or aligned 2 × 2 groups, never L-shapes', () => {
    const width = 40, height = 24, tile = 2, size = tile * 1080 / height, time = 3.4, speed = 1.5;
    const evaluate = createImagePassEvaluator(plan('block-mosaic', { scale: size, grout: 0, amount: 1, speed }),
      [width, height], discreteImage(width, height, texel), { filterResources: true, float16: true, timelineTimeSeconds: time });
    let large = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ox = Math.floor(width / 2), oy = Math.floor(height / 2);
      const group: UV = [Math.floor((x + .5 - ox) / (tile * 2)) + Math.floor(time * speed), Math.floor((y + .5 - oy) / (tile * 2)) + Math.floor(time * speed)];
      const isLarge = hash(group) > .68; if (isLarge) large++;
      const expected = straight(referenceAverage(texel, referenceCell(x, y, isLarge ? tile * 2 : tile, width, height)));
      const actual = evaluate([(x + .5) / width, (y + .5) / height]);
      if (expected[3] > .05) expectClose(actual, expected, 2);
    }
    expect(large).toBeGreaterThan(0);
  });

  it('Block Mosaic grout: Grout Width split over both sides of every tile edge, one pixel soft', () => {
    const width = 48, height = 32, tile = 8, size = tile * 1080 / height;
    const flat = discreteImage(width, height, () => [.8, .6, .4, 1]);
    const evaluate = createImagePassEvaluator(plan('block-mosaic', { scale: size, grout: 2 * 1080 / height, amount: 1, speed: 0, colorA: '#000000' }),
      [width, height], flat, { filterResources: true, float16: true, timelineTimeSeconds: 0 });
    const origin: UV = [24, 16];
    for (const y of [4, 13, 20]) for (let x = 0; x < width; x++) {
      const pixel: UV = [x + .5, y + .5];
      const cell = hash([Math.floor((pixel[0] - origin[0]) / (tile * 2)), Math.floor((pixel[1] - origin[1]) / (tile * 2))]) > .68 ? tile * 2 : tile;
      const start = pixel.map((value, axis) => origin[axis] + Math.floor((value - origin[axis]) / cell) * cell);
      const distance = Math.min(...pixel.map((value, axis) => Math.min(value - start[axis], start[axis] + cell - value)));
      // Grout 2 px: one pixel on each side of the edge (the grout colour is black).
      const coverage = clamp(distance - 1 + .5, 0, 1);
      expect(evaluate([pixel[0] / width, pixel[1] / height])[0]).toBeCloseTo(.8 * coverage, 2);
    }
  });
});

describe('worker CPU fallback', () => {
  it.each([
    ['kaleidoscope', { segments: 5, rotation: .4, sourceAngle: .35, zoom: 1.3, centerX: .45, centerY: .5 }],
    ['kaleidoscope', { segments: 6.5, shape: 'frame', edges: 'transparent' }],
    ['mirror', { horizontal: true, vertical: true, angle: .35, centerX: .4, keep: 'end' }],
    ['rgb-split', { amount: .07, angle: .9, edges: 'transparent' }],
    ['rgb-split', { amount: .05, mode: 'lens' }],
    ['pixelate', { size: 3 * 1080 / 9 }],
  ] as const)('matches the %s graph within 1/255 (%j)', (type, params) => {
    const width = 16, height = 9;
    const bytes = new Uint8ClampedArray(width * height * 4);
    const quantized = (x: number, y: number): Pixel => texel(x, y).map(value => Math.round(value * 255) / 255) as Pixel;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.set(quantized(x, y).map(value => Math.round(value * 255)), (y * width + x) * 4);
    const adjustment = workerSoftwareMirrorPixelAdjustment(type, effectOperatorParams({ type, params }))!;
    applyWorkerSoftwareMirrorPixelEffects(bytes, width, height, [adjustment]);
    const evaluate = createImagePassEvaluator(plan(type, params), [width, height], discreteImage(width, height, quantized), { filterResources: true });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const expected = evaluate([(x + .5) / width, (y + .5) / height]), index = (y * width + x) * 4;
      expect(Math.abs(bytes[index + 3] - expected[3] * 255)).toBeLessThanOrEqual(1);
      if (expected[3] > .1) for (let channel = 0; channel < 3; channel++) expect(Math.abs(bytes[index + channel] - clamp(expected[channel], 0, 1) * 255)).toBeLessThanOrEqual(1.5);
    }
  });
});
