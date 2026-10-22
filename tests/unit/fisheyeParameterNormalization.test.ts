import { describe, expect, it } from 'vitest';
import { fisheye, FISHEYE_PARAMS, normalizeFisheyeParameters } from '../../src/effects/distort/fisheye';
import { fisheyeParameterWarnings } from '../../src/effects/distort/fisheye/normalization';
import { FISHEYE_SAMPLE_OFFSETS } from '../../src/effects/distort/fisheye/sampleOffsets';

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

  it.each([[undefined, 1], ['bad', 1], [0, 1], [2, 2], [3, 3], ['4', 4], [5, 5], [6.4, 6], [7, 7], ['8', 8], [99, 8]] as const)(
    'renders every whole Edge Sampling count from 1 to 8 (%s gives %s)', (samples, expected) => {
      expect(normalizeFisheyeParameters({ samples }).samples).toBe(expected);
      expect(fisheye.packUniforms({ samples }, 16, 9)[17]).toBe(expected);
    });

  it('names an Edge Sampling value it rounds or caps, and accepts every whole count', () => {
    for (const samples of [1, 2, 3, 4, 5, 6, 7, 8]) expect(fisheyeParameterWarnings({ samples })).toEqual([]);
    expect(fisheyeParameterWarnings({ samples: 6.4 })).toEqual(['samples: 6.4 is not a whole number from 1 to 8; using 6.']);
    expect(fisheyeParameterWarnings({ samples: 99 })).toEqual(['samples: 99 is not a whole number from 1 to 8; using 8.']);
  });

  it('orders the sample offsets in opposite pairs, so every even count is centred on the pixel', () => {
    for (const count of [2, 4, 6, 8]) {
      const used = FISHEYE_SAMPLE_OFFSETS.slice(0, count);
      expect(used.reduce((sum, [x]) => sum + x, 0)).toBeCloseTo(0, 12);
      expect(used.reduce((sum, [, y]) => sum + y, 0)).toBeCloseTo(0, 12);
    }
    expect(new Set(FISHEYE_SAMPLE_OFFSETS.map(offset => offset.join())).size).toBe(8);
  });

  it('keeps preserveAspect false-only and validates choices against schema defaults', () => {
    expect(normalizeFisheyeParameters({ preserveAspect: false }).preserveAspect).toBe(false);
    expect(normalizeFisheyeParameters({ preserveAspect: 'false', projection: 'orthographic', edgeMode: 'mirror', outside: 'transparent' }))
      .toMatchObject({ preserveAspect: true, projection: 'orthographic', edgeMode: 'mirror', outside: 'transparent' });
  });
});
