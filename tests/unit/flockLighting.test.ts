import { describe, expect, it } from 'vitest';
import { flockLightViewProj, type FlockLightSetup } from '../../src/engine/flock/gpu/flockLighting';

function project(m: Float32Array, p: [number, number, number]): [number, number, number] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w];
}

describe('flock key light', () => {
  const light: FlockLightSetup = {
    enabled: true,
    directionSim: [-0.35 / 1.03, 0.8 / 1.03, 0.55 / 1.03],
    ambient: 0.4,
    shadowStrength: 0.7,
    boundsMin: [-180, -105, -135],
    boundsMax: [180, 105, 165],
  };

  it('fits the shadow frustum around the scene bounds', () => {
    const m = flockLightViewProj(light);
    for (let corner = 0; corner < 8; corner += 1) {
      const [x, y, z] = project(m, [
        corner & 1 ? 180 : -180,
        corner & 2 ? 105 : -105,
        corner & 4 ? 165 : -135,
      ]);
      expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-5);
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-5);
      expect(z).toBeGreaterThanOrEqual(-1e-5);
      expect(z).toBeLessThanOrEqual(1 + 1e-5);
    }
  });

  it('gives points closer to the light a smaller depth', () => {
    const m = flockLightViewProj(light);
    const d = light.directionSim;
    const near = project(m, [d[0] * 50, d[1] * 50, d[2] * 50]);
    const far = project(m, [-d[0] * 50, -d[1] * 50, -d[2] * 50]);
    expect(near[2]).toBeLessThan(far[2]);
    expect(near[0]).toBeCloseTo(far[0], 5);
    expect(near[1]).toBeCloseTo(far[1], 5);
  });
});
