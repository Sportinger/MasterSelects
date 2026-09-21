import { describe, expect, it } from 'vitest';
import { fisheye, FISHEYE_PARAMS, normalizeFisheyeParameters } from '../../src/effects/distort/fisheye';

describe('Fisheye parameter normalization', () => {
  it('retains the legacy 24-slot packing order and degree conversion', () => {
    const packed = fisheye.packUniforms({ strength: -.4, fieldOfView: 90, radius: 1.5, zoom: 2, centerX: .2, centerY: .7,
      squeeze: 1.3, rotation: -90, projection: 'stereographic', edgeMode: 'repeat', outside: 'transparent', feather: .1,
      edgeFeather: .02, chromaticAberration: .03, vignette: .4, vignetteSoftness: .6, samples: '8', preserveAspect: false,
      curveBias: .2 }, 200, 100);
    expect(packed).toEqual(new Float32Array([-.4, 90 * Math.PI / 180, 1.5, 2, .2, .7, 1.3, -90 * Math.PI / 180,
      2, 2, 3, 1, .1, .02, .03, .4, .6, 8, 0, .2, 1 / 200, 1 / 100, 0, 0]));
    expect(packed).toHaveLength(24);
  });

  it('uses schema defaults for malformed values and clamps finite numbers', () => {
    const value = normalizeFisheyeParameters({ strength: Number.NaN, fieldOfView: Number.POSITIVE_INFINITY, radius: -5, zoom: 'bad',
      centerX: 2, centerY: -1, squeeze: 0, rotation: 999, projection: 'invalid', edgeMode: 3, outside: 'invalid',
      feather: 2, edgeFeather: -.5, chromaticAberration: 1, vignette: -1, vignetteSoftness: 0, preserveAspect: 0, curveBias: -4 });
    expect(value).toMatchObject({ strength: 1, fieldOfView: 140, radius: .1, zoom: 1, centerX: 1, centerY: 0, squeeze: .25,
      rotation: 180, projection: 'equidistant', edgeMode: 'transparent', outside: 'original', feather: .5, edgeFeather: 0,
      chromaticAberration: .05, vignette: 0, vignetteSoftness: .01, preserveAspect: true, curveBias: -1 });
    expect(fisheye.params).toBe(FISHEYE_PARAMS);
  });

  it.each([[undefined, 1], ['bad', 1], [3.999, 1], ['4', 4], [7.999, 4], ['8', 8], [99, 8]] as const)(
    'preserves legacy sample threshold coercion for %s', (samples, expected) => {
      expect(normalizeFisheyeParameters({ samples }).samples).toBe(expected);
    });

  it('keeps preserveAspect false-only and validates choices against schema defaults', () => {
    expect(normalizeFisheyeParameters({ preserveAspect: false }).preserveAspect).toBe(false);
    expect(normalizeFisheyeParameters({ preserveAspect: 'false', projection: 'orthographic', edgeMode: 'mirror', outside: 'transparent' }))
      .toMatchObject({ preserveAspect: true, projection: 'orthographic', edgeMode: 'mirror', outside: 'transparent' });
  });
});
