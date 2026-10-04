import { describe, expect, it } from 'vitest';
import { hairF, hairPdf, hairSample, hairState, sigmaAFromColor, type HairParams, type Vec3 } from '../../src/engine/native3d/pathtrace/materials/ptChiangHair';
import { buildReferenceLbvh, traverseReferenceLbvh } from '../../src/engine/native3d/pathtrace/bvh/ptLbvhReference';
import { sobol, sobolOwen4 } from '../../src/engine/native3d/pathtrace/integrator/ptSampler';

/** Deterministic uniform numbers for the estimators. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    state ^= state >>> 12;
    return (state >>> 0) / 4294967296;
  };
}

function uniformSphere(u1: number, u2: number): Vec3 {
  const z = 1 - 2 * u1, r = Math.sqrt(Math.max(0, 1 - z * z)), phi = 2 * Math.PI * u2;
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** wo of a camera ray: in the plane perpendicular to y (toward the viewer), like the integrator's fiber frame. */
function viewerDirection(u: number): Vec3 {
  const sinTheta = Math.sin((u - 0.5) * Math.PI * 0.9);
  return [sinTheta, 0, Math.sqrt(1 - sinTheta * sinTheta)];
}

describe('Chiang fiber BSDF (CPU reference of PtFiberBsdf.wgsl)', () => {
  it('conserves energy without absorption (white furnace)', () => {
    const next = random(7);
    for (const betaM of [0.2, 0.4, 0.7, 1]) {
      for (const betaN of [0.3, 0.6, 1]) {
        const params: HairParams = { h: 2 * next() - 1, eta: 1.55, sigmaA: [0, 0, 0], betaM, betaN, alpha: 2 * Math.PI / 180 };
        const state = hairState(params), wo = viewerDirection(next());
        let sum = 0;
        const samples = 60000;
        for (let i = 0; i < samples; i++) sum += hairF(state, wo, uniformSphere(next(), next()))[0] * 4 * Math.PI;
        // pbrt's hair test accepts the same tolerance; very low roughness converges too slowly for uniform sampling.
        expect(sum / samples, `betaM ${betaM}, betaN ${betaN}`).toBeGreaterThan(0.93);
        expect(sum / samples, `betaM ${betaM}, betaN ${betaN}`).toBeLessThan(1.05);
      }
    }
  });

  it('importance sampling agrees with f / pdf and the pdf integrates to one', () => {
    const next = random(11);
    for (const [betaM, betaN] of [[0.25, 0.4], [0.5, 0.8], [0.9, 0.9]]) {
      const params: HairParams = { h: 2 * next() - 1, eta: 1.55, sigmaA: sigmaAFromColor([0.8, 0.6, 0.4], betaN), betaM, betaN,
        alpha: 3 * Math.PI / 180, coatTint: [1, 0.9, 0.8], matte: 0.3, matteAlbedo: [0.8, 0.6, 0.4] };
      const state = hairState(params), wo = viewerDirection(next());
      let sampled = 0, uniform = 0, pdfIntegral = 0;
      const samples = 40000;
      for (let i = 0; i < samples; i++) {
        const sample = hairSample(state, wo, [next(), next(), next()]);
        if (sample.pdf > 0) sampled += sample.value[1] / sample.pdf;
        const wi = uniformSphere(next(), next());
        uniform += hairF(state, wo, wi)[1] * 4 * Math.PI;
        pdfIntegral += hairPdf(state, wo, wi) * 4 * Math.PI;
      }
      expect(Math.abs(sampled / samples - uniform / samples), `betaM ${betaM}`).toBeLessThan(0.05 * Math.max(0.2, uniform / samples));
      expect(pdfIntegral / samples, `betaM ${betaM}`).toBeGreaterThan(0.93);
      expect(pdfIntegral / samples, `betaM ${betaM}`).toBeLessThan(1.07);
    }
  });

  it('absorbs more for darker colors', () => {
    const light = sigmaAFromColor([0.9, 0.9, 0.9], 0.5), dark = sigmaAFromColor([0.2, 0.2, 0.2], 0.5);
    expect(dark[0]).toBeGreaterThan(light[0]);
  });
});

describe('LBVH (CPU reference of PtLbvh.wgsl)', () => {
  /** Spheres as primitives: bounds and an exact ray test. */
  function spheres(count: number, seed: number) {
    const next = random(seed), centers: Vec3[] = [], radii: number[] = [];
    for (let i = 0; i < count; i++) {
      centers.push([next() * 10 - 5, next() * 10 - 5, next() * 10 - 5]);
      radii.push(0.02 + next() * 0.3);
    }
    const aabbs = new Float32Array(count * 6);
    centers.forEach((c, i) => aabbs.set([c[0] - radii[i], c[1] - radii[i], c[2] - radii[i], c[0] + radii[i], c[1] + radii[i], c[2] + radii[i]], i * 6));
    return { centers, radii, aabbs };
  }
  const hitSphere = (center: Vec3, radius: number, origin: Vec3, direction: Vec3) => {
    const oc = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
    const b = oc[0] * direction[0] + oc[1] * direction[1] + oc[2] * direction[2];
    const c = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - radius * radius, d = b * b - c;
    if (d < 0) return Infinity;
    const t = -b - Math.sqrt(d);
    return t > 1e-6 ? t : Infinity;
  };

  it('finds the same closest hit as brute force on random rays', () => {
    for (const count of [1, 2, 3, 17, 1000, 4096]) {
      const scene = spheres(count, count);
      const bvh = buildReferenceLbvh(scene.aabbs);
      expect(bvh.nodes.length).toBe(Math.max(1, 2 * count - 1));
      const next = random(count * 3);
      let hits = 0;
      for (let ray = 0; ray < 400; ray++) {
        const origin: Vec3 = [next() * 14 - 7, next() * 14 - 7, next() * 14 - 7];
        const direction = uniformSphere(next(), next());
        let best = Infinity, primitive = -1;
        scene.centers.forEach((center, i) => { const t = hitSphere(center, scene.radii[i], origin, direction); if (t < best) { best = t; primitive = i; } });
        const result = traverseReferenceLbvh(bvh, origin, direction, (index, tMax) => {
          const t = hitSphere(scene.centers[index], scene.radii[index], origin, direction);
          return t < tMax ? t : Infinity;
        });
        expect(result.primitive, `count ${count}, ray ${ray}`).toBe(primitive);
        if (primitive >= 0) { hits++; expect(result.t).toBeCloseTo(best, 9); }
      }
      if (count >= 1000) expect(hits).toBeGreaterThan(20);
    }
  });

  it('keeps hidden primitives (empty bounds) out of every hit and places them last', () => {
    const scene = spheres(64, 5);
    for (let i = 0; i < 64; i += 3) scene.aabbs.set([1, 1, 1, -1, -1, -1], i * 6);
    const bvh = buildReferenceLbvh(scene.aabbs);
    const hidden = new Set(Array.from({ length: 22 }, (_, k) => k * 3));
    expect([...bvh.sortedPrimitives.slice(-hidden.size)].every(index => hidden.has(index))).toBe(true);
    const next = random(99);
    for (let ray = 0; ray < 200; ray++) {
      const origin: Vec3 = [next() * 14 - 7, next() * 14 - 7, -9];
      const result = traverseReferenceLbvh(bvh, origin, [0, 0, 1], index => hidden.has(index) ? 0.5 : hitSphere(scene.centers[index], scene.radii[index], origin, [0, 0, 1]));
      expect(hidden.has(result.primitive)).toBe(false);
    }
  });

  it('visits far fewer nodes than brute force on a large scene', () => {
    const scene = spheres(4096, 3), bvh = buildReferenceLbvh(scene.aabbs);
    const result = traverseReferenceLbvh(bvh, [0, 0, -20], [0, 0, 1], index => hitSphere(scene.centers[index], scene.radii[index], [0, 0, -20], [0, 0, 1]));
    expect(result.visited).toBeLessThan(600);
  });
});

describe('Owen-scrambled Sobol sampler (CPU mirror of PtSampler.wgsl)', () => {
  it('uses (0, 1)-sequences in every dimension', () => {
    for (let dimension = 0; dimension < 4; dimension++) {
      const cells = new Set<number>();
      for (let index = 0; index < 256; index++) cells.add(Math.floor(sobol(index, dimension) / 2 ** 32 * 256));
      expect(cells.size, `dimension ${dimension}`).toBe(256);
    }
  });

  it('keeps every scrambled pattern stratified (2D for the first pair, 1D for each dimension)', () => {
    for (const seed of [1, 12345, 0xdeadbeef]) {
      const cells = new Set<number>(), rows = [0, 1, 2, 3].map(() => new Set<number>());
      for (let index = 0; index < 64; index++) {
        const p = sobolOwen4(index, seed);
        cells.add(Math.floor(p[0] * 8) * 8 + Math.floor(p[1] * 8));
        p.forEach((value, dimension) => rows[dimension].add(Math.floor(value * 64)));
      }
      expect(cells.size, `seed ${seed}`).toBe(64);
      rows.forEach((row, dimension) => expect(row.size, `seed ${seed}, dimension ${dimension}`).toBe(64));
    }
  });
});
