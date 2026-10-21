// The coverage and compositing maths of the Generate shaders, run on the CPU from the WGSL source
// itself (scalar helper functions translated line by line), checked against independent
// references: box-filtered line areas, disc areas, premultiplied "over" and plain geometry.
// Unconditional, so CI covers the shader maths even without a WGSL validator.
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { colorWheel } from '../../src/effects/generate/colorWheel';
import { perspectiveGrid } from '../../src/effects/generate/perspectiveGrid';
import { stickFigure } from '../../src/effects/generate/stickFigure';
import { stickFigureRing, STICK_FIGURE_RING_MIN_OPENING } from '../../src/effects/generate/stickFigure/layout';

type Scalar = (...args: number[]) => number;
type Params = Record<string, number | boolean | string>;

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high);
/** WGSL built-ins the scalar helpers use, with WGSL semantics. */
const BUILTINS: Record<string, unknown> = {
  select: (falseValue: number, trueValue: number, condition: boolean) => condition ? trueValue : falseValue,
  clamp,
  smoothstep: (low: number, high: number, x: number) => { const t = clamp((x - low) / (high - low), 0, 1); return t * t * (3 - 2 * t); },
  mix: (a: number, b: number, t: number) => a * (1 - t) + b * t,
  fract: (x: number) => x - Math.floor(x),
  abs: Math.abs, max: Math.max, min: Math.min, pow: Math.pow, sqrt: Math.sqrt, atan2: Math.atan2,
};

/** Translates named scalar `fn`s of a WGSL module to JavaScript (f32 maths runs in double). */
function wgslScalarFunctions(source: string, names: readonly string[]): Record<string, Scalar> {
  const code = names.map(name => {
    const start = source.indexOf(`fn ${name}(`);
    if (start < 0) throw new Error(`fn ${name} not found`);
    let depth = 0, end = source.indexOf('{', start);
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}' && --depth === 0) break;
    }
    const text = source.slice(start, end + 1)
      .replace(/^fn /, 'function ')
      .replace(/\)\s*->\s*f32\s*\{/, ') {')
      .replace(/(\w+)\s*:\s*f32/g, '$1')
      .replace(/\bvar\b/g, 'let');
    if (/\bvec[234]|\bu32\b|\bi32\b/.test(text)) throw new Error(`fn ${name} is not scalar`);
    return text;
  }).join('\n');
  return new Function(...Object.keys(BUILTINS), `${code}\nreturn { ${names.join(', ')} };`)(...Object.values(BUILTINS));
}

const grid = wgslScalarFunctions(perspectiveGrid.shader, ['pristineLine', 'perspectiveGridLines']);
const wheel = wgslScalarFunctions(colorWheel.shader, ['colorWheelHue', 'colorWheelDiscCoverage', 'straightOverChannel']);

/** The grid's line amount at an output pixel centre, from packed uniforms (as the fragment shader reads them). */
function gridAmount(params: Params, width: number, height: number, px: number, py: number, time = 0): number {
  const u = perspectiveGrid.packUniforms({ ...getDefaultParams('perspective-grid'), ...params }, width, height, time)!;
  const [horizon, columns, rows, scroll, linePixels, fade] = u;
  const floorPixels = Math.max((1 - horizon) * height, 1);
  const depth = ((py + 0.5) / height - horizon) * height / floorPixels;
  return grid.perspectiveGridLines((px + 0.5) / width, depth, columns, rows, scroll, linePixels, u[14], fade, width, floorPixels);
}

describe('Perspective Grid line coverage (WGSL on the CPU)', () => {
  it('conserves each line family\'s area: averaged over a cell it equals the line width in cells', () => {
    for (const width of [0.02, 0.1, 0.3, 0.6, 0.9]) {
      for (const deriv of [0.004, 0.05, 0.3, 1, 4]) {
        // Box-filter reference: a line `width` cells wide covers that share of every cell.
        const samples = 4000;
        let sum = 0;
        for (let i = 0; i < samples; i += 1) sum += grid.pristineLine((i + 0.5) / samples, deriv, width);
        // Sharp lines are exact up to their 1.5 px soft rim; sub-pixel and dense lines keep their share.
        expect(sum / samples, `width ${width}, ${deriv} cells per pixel`).toBeCloseTo(width, 1);
      }
    }
  });

  it('covers everything once a line is a cell wide or wider, and nothing at width 0', () => {
    for (const width of [1, 1.67, 2.6, 1e30, Number.POSITIVE_INFINITY]) {
      for (const coord of [0, 0.25, 0.5, 0.99]) expect(grid.pristineLine(coord, 0.3, width)).toBe(1);
    }
    expect(grid.pristineLine(0, 0.3, 0)).toBe(0);
    expect(grid.pristineLine(0, 0.3, -2)).toBe(0);
  });

  it('keeps a dense grid of thick lines covered instead of punching a hole into the floor', () => {
    // Line Width 8 (16 px) with 200 columns: every column line is wider than its cell.
    const params = { lineWidth: 8, columns: 200, rows: 60, fade: 0.05, opacity: 1, widthMode: 'floor' };
    let previous = 0;
    for (let py = 760; py < 1080; py += 4) {
      const amount = gridAmount(params, 1920, 1080, 1344, py);
      expect(amount).toBeGreaterThanOrEqual(0);
      expect(amount).toBeLessThanOrEqual(1);
      // Full coverage only fades with depth: never darker further forward.
      expect(amount).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = amount;
    }
    expect(previous).toBeGreaterThan(0.95);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1e30, 1e30, 0])('draws an amount between 0 and 1 everywhere for %s', value => {
    const params = { columns: value, rows: value, lineWidth: value, fade: value, horizon: value, speed: value, offset: value };
    for (const widthMode of ['floor', 'screen']) {
      for (let py = 0; py < 1080; py += 37) {
        for (let px = 0; px < 1920; px += 151) {
          const amount = gridAmount({ ...params, widthMode }, 1920, 1080, px, py, 7);
          expect(Number.isFinite(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
          expect(amount).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  /** Pixels covered along one scanline by the centre column (the vertical line at x = 0.5; with two
   * columns the next lines are a quarter of the floor width away). */
  const centreLinePixels = (params: Params, py: number, width = 1920, height = 1080) => {
    let sum = 0;
    for (let px = width / 2 - 40; px < width / 2 + 40; px += 1) sum += gridAmount({ columns: 2, rows: 0, fade: 0, ...params }, width, height, px, py);
    return sum;
  };

  it('keeps grids saved before Lines existed at an even screen width, a hairline at Line Width 0', () => {
    // Old shader: full core of 2 × Line Width px plus a one-pixel soft rim, at every depth.
    const legacy = perspectiveGrid.packUniforms({ horizon: 0.5, columns: 14, rows: 0, lineWidth: 2, fade: 0, opacity: 1 }, 1920, 1080, 0)!;
    expect(legacy[14]).toBe(1);
    expect(legacy[4]).toBeCloseTo(5);
    for (const py of [600, 800, 1070]) expect(centreLinePixels({ horizon: 0.5, lineWidth: 2, widthMode: 'screen' }, py)).toBeCloseTo(5, 0);
    for (const py of [600, 1070]) expect(centreLinePixels({ horizon: 0.5, lineWidth: 0, widthMode: 'screen' }, py)).toBeCloseTo(1, 0);
  });

  it('thins floor lines with distance: the width at the front edge times the depth', () => {
    for (const py of [650, 800, 1079]) {
      const depth = ((py + 0.5) / 1080 - 0.5) * 2;
      expect(centreLinePixels({ horizon: 0.5, lineWidth: 3, widthMode: 'floor' }, py)).toBeCloseTo(6 * depth, 0);
    }
    // The same share of the picture at 960 × 540: half the pixels.
    expect(centreLinePixels({ horizon: 0.5, lineWidth: 3, widthMode: 'floor' }, 539, 960, 540)).toBeCloseTo(3, 0);
  });

  it('fades in over a soft edge at the horizon instead of starting with a hard step', () => {
    const params = { horizon: 0.5, columns: 400, rows: 60, lineWidth: 4, fade: 0.05, widthMode: 'floor' };
    const row = (py: number) => Array.from({ length: 64 }, (_, i) => gridAmount(params, 1920, 1080, 600 + i * 11, py)).reduce((a, b) => a + b) / 64;
    expect(row(539)).toBe(0);
    // Dense rows near the horizon are haze that thins towards it, not a flat slab.
    expect(row(541)).toBeLessThan(row(560));
    expect(row(560)).toBeLessThan(row(640));
  });
});

describe('Color Wheel disc and hue (WGSL on the CPU)', () => {
  it('covers the disc area at any resolution with a one-pixel rim', () => {
    for (const shortSide of [540, 1080, 2160]) {
      const radius = 0.45, radiusPx = radius * shortSide;
      let area = 0;
      for (let y = -radiusPx - 2; y < radiusPx + 2; y += 1) {
        for (let x = -radiusPx - 2; x < radiusPx + 2; x += 1) {
          area += wheel.colorWheelDiscCoverage(Math.hypot(x + 0.5, y + 0.5) / shortSide, radius, shortSide);
        }
      }
      expect(area / (Math.PI * radiusPx * radiusPx)).toBeCloseTo(1, 2);
      expect(wheel.colorWheelDiscCoverage((radiusPx - 1) / shortSide, radius, shortSide)).toBe(1);
      expect(wheel.colorWheelDiscCoverage((radiusPx + 1) / shortSide, radius, shortSide)).toBe(0);
    }
  });

  it('composites the disc like premultiplied "over": no darkening over transparency', () => {
    for (const [top, alpha, under, underAlpha] of [[0.9, 0.5, 0.2, 0], [0.9, 0.5, 0.2, 1], [0.3, 0.25, 0.8, 0.6], [1, 1, 0, 0.3]]) {
      const outAlpha = alpha + underAlpha * (1 - alpha);
      const premultiplied = top * alpha + under * underAlpha * (1 - alpha);
      expect(wheel.straightOverChannel(top, alpha, under, underAlpha) * outAlpha).toBeCloseTo(premultiplied, 6);
    }
    expect(wheel.straightOverChannel(0.9, 0.3, 0.2, 0)).toBeCloseTo(0.9, 6);
  });

  it('runs counter-clockwise on screen by default and clockwise for wheels saved without Direction', () => {
    const counterClockwise = colorWheel.packUniforms({ ...getDefaultParams('color-wheel') }, 1920, 1080, 0)![10];
    const saved = colorWheel.packUniforms({ rotation: 0, saturation: 1.2, value: 1, mix: 1 }, 1920, 1080, 0)![10];
    expect([counterClockwise, saved]).toEqual([1, 0]);
    // Screen y points down: "up" is (0, -1). Red sits at the right; a quarter turn later comes up or down.
    expect(wheel.colorWheelHue(1, 0, 1, 0)).toBeCloseTo(0, 6);
    expect(wheel.colorWheelHue(0, -1, 1, 0)).toBeCloseTo(0.25, 6);
    expect(wheel.colorWheelHue(0, 1, 0, 0)).toBeCloseTo(0.25, 6);
  });
});

describe('Stick Figure ring head', () => {
  const ringFns = wgslScalarFunctions(stickFigure.shader, ['stickFigureRingDistance']);
  /** Independent capsule distance (plain geometry). */
  const capsule = (px: number, py: number, ax: number, ay: number, bx: number, by: number, radius: number) => {
    const t = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / Math.max((bx - ax) ** 2 + (by - ay) ** 2, 1e-6), 0, 1);
    return Math.hypot(px - ax - (bx - ax) * t, py - ay - (by - ay) * t) - radius;
  };

  it('strokes the ring like the limbs, keeps half the head radius open and grows at most to 1.5 × the head', () => {
    for (const [limb, head] of [[6, 26], [12, 26], [20, 26], [40, 26], [300, 26], [0.5, 0.5]]) {
      const { centre, halfStroke, outer } = stickFigureRing(limb, head);
      expect(outer).toBeCloseTo(centre + halfStroke, 9);
      expect(centre - halfStroke).toBeGreaterThanOrEqual(head * STICK_FIGURE_RING_MIN_OPENING - 1e-9);
      expect(outer).toBeLessThanOrEqual(1.5 * head + 1e-9);
      // The limb thickness up to one head radius.
      expect(2 * halfStroke).toBeCloseTo(Math.min(2 * limb, head), 9);
    }
    // Thin lines keep the outer edge at the head radius.
    expect(stickFigureRing(6, 26).outer).toBeCloseTo(26, 9);
  });

  it('leaves the opening empty: no neck or ring pixel inside it, also with thick lines', () => {
    for (const thickness of [6, 24, 80]) {
      const packed = stickFigure.packUniforms({ ...getDefaultParams('stick-figure'), headStyle: 'ring', thickness }, 1920, 1080)!;
      const limbR = packed[2], centre = packed[10], halfStroke = packed[11];
      const [nx, ny, bx, by, hx, hy] = [packed[14], packed[15], packed[16], packed[17], packed[18], packed[19]];
      const opening = centre - halfStroke;
      let checked = 0;
      for (let y = -opening; y <= opening; y += 0.5) {
        for (let x = -opening; x <= opening; x += 0.5) {
          const d = Math.hypot(x, y);
          if (d > opening - 0.6) continue; // the anti-aliased rim
          const distance = ringFns.stickFigureRingDistance(d, capsule(hx + x, hy + y, nx, ny, bx, by, limbR), centre, halfStroke);
          expect(clamp(0.5 - distance, 0, 1), `thickness ${thickness} at ${x}, ${y}`).toBe(0);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(100);
      // The neck still reaches the ring: just outside its outer edge, towards the neck, it is drawn.
      const toNeck = Math.hypot(bx - hx, by - hy) || 1;
      const edge = centre + halfStroke + 0.75;
      const px = hx + (bx - hx) / toNeck * edge, py = hy + (by - hy) / toNeck * edge;
      expect(ringFns.stickFigureRingDistance(edge, capsule(px, py, nx, ny, bx, by, limbR), centre, halfStroke)).toBeLessThan(0);
    }
  });
});
