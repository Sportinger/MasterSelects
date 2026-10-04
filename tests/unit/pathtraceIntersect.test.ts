import { describe, expect, it } from 'vitest';
import {
  intersectQuad, intersectRoundCone, intersectTriangle, powerHeuristic, roundConeDistance, sampleSphereLight, type V3,
} from '../../src/engine/native3d/pathtrace/bvh/ptIntersectReference';
import { buildEnvironmentAlias, parseRadianceHdr } from '../../src/engine/native3d/pathtrace/lights/ptEnvironment';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const unit = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

describe('path tracing intersections (CPU mirrors of PtTraverse.wgsl)', () => {
  it('hits round cones exactly where sphere tracing the swept-sphere distance does', () => {
    const next = random(3);
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const a: V3 = [next() - 0.5, next() - 0.5, next() - 0.5], b: V3 = [next() - 0.5, next() - 0.5, next() - 0.5];
      const ra = 0.02 + next() * 0.15, rb = 0.02 + next() * 0.15;
      const ro: V3 = [next() * 4 - 2, next() * 4 - 2, 2.5];
      const target: V3 = [(a[0] + b[0]) / 2 + (next() - 0.5) * 0.4, (a[1] + b[1]) / 2 + (next() - 0.5) * 0.4, (a[2] + b[2]) / 2];
      const rd = unit([target[0] - ro[0], target[1] - ro[1], target[2] - ro[2]]);
      const hit = intersectRoundCone(ro, rd, a, b, ra, rb);
      // Brute force: march the exact distance field.
      let t = 0, found = Infinity;
      for (let step = 0; step < 400 && t < 10; step++) {
        const d = roundConeDistance([ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], a, b, ra, rb);
        if (d < 1e-5) { found = t; break; }
        t += Math.max(d, 1e-5);
      }
      if (found === Infinity) expect(hit === null || hit.t < 0, `ray ${i}`).toBe(true);
      else {
        hits++;
        expect(hit, `ray ${i}`).not.toBeNull();
        expect(Math.abs(hit!.t - found), `ray ${i}`).toBeLessThan(2e-3);
        expect(Math.abs(Math.hypot(...hit!.normal) - 1)).toBeLessThan(1e-6);
      }
    }
    expect(hits).toBeGreaterThan(60);
  });

  it('intersects triangles and quads at the analytic plane distance inside their bounds only', () => {
    const p0: V3 = [0, 0, 0], p1: V3 = [1, 0, 0], p2: V3 = [0, 1, 0];
    expect(intersectTriangle([0.25, 0.25, 1], [0, 0, -1], p0, p1, p2)).toEqual([1, 0.25, 0.25]);
    expect(intersectTriangle([0.75, 0.75, 1], [0, 0, -1], p0, p1, p2)).toBeNull();
    expect(intersectTriangle([0.25, 0.25, -1], [0, 0, 1], p0, p1, p2)?.[0]).toBe(1);
    const quad = intersectQuad([0.3, 0.6, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(quad?.map(v => Math.round(v * 1e9) / 1e9)).toEqual([2, 0.3, 0.6]);
    expect(intersectQuad([1.3, 0.6, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe('light sampling and MIS (CPU mirrors of PtLights.wgsl)', () => {
  it('samples sphere lights inside their cone with a pdf that integrates the cone to one', () => {
    const next = random(9), center: V3 = [0, 0, 3], radius = 0.7;
    const cosMax = Math.sqrt(1 - radius * radius / 9);
    let estimate = 0;
    for (let i = 0; i < 20000; i++) {
      const sample = sampleSphereLight([0, 0, 0], center, radius, [next(), next()])!;
      expect(sample.wi[2]).toBeGreaterThanOrEqual(cosMax - 1e-9);
      estimate += 1 / sample.pdf;
    }
    // E[1 / pdf] is the cone's solid angle.
    expect(estimate / 20000).toBeCloseTo(2 * Math.PI * (1 - cosMax), 9);
  });

  it('weights two strategies with power heuristic weights that sum to one', () => {
    const next = random(5);
    for (let i = 0; i < 100; i++) {
      const a = next() * 10, b = next() * 10;
      expect(powerHeuristic(a, b) + powerHeuristic(b, a)).toBeCloseTo(1, 12);
    }
  });

  it('parses Radiance HDR and builds an alias table proportional to luminance times sin(theta)', () => {
    const width = 8, height = 4;
    const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) pixels.set(i === 9 ? [128, 128, 128, 136] : [128, 128, 128, 128], i * 4);
    const bytes = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const image = parseRadianceHdr(bytes);
    expect(image.rgba[9 * 4]).toBe(128);
    expect(image.rgba[0]).toBeCloseTo(0.5, 9);
    const { table } = buildEnvironmentAlias(image);
    // Sampling with the alias table reproduces each texel's pmf.
    const counts = new Float64Array(width * height), next = random(1);
    for (let n = 0; n < 200000; n++) {
      const scaled = next() * width * height, slot = Math.floor(scaled), fraction = scaled - slot;
      counts[fraction < table[slot * 4] ? slot : table[slot * 4 + 1]]++;
    }
    for (let i = 0; i < width * height; i++) expect(counts[i] / 200000).toBeCloseTo(table[i * 4 + 2], 2);
    expect(table[9 * 4 + 2]).toBeGreaterThan(table[8 * 4 + 2] * 100);
  });
});
