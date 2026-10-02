import { describe, it, expect } from 'vitest';
import { lensCorrection, normalizeLensCorrection } from '../../src/effects/distort/lens-correction';
import { getEffect, getDefaultParams, effectGroup } from '../../src/effects';
import { CANON_24_105_PROFILE, lensProfileUniforms } from '../../src/effects/distort/lens-correction/lensProfile';

describe('Lens Correction', () => {
  it('is available in Lens & Distort with neutral defaults and keyframeable controls', () => {
    expect(getEffect('lens-correction')).toBe(lensCorrection);
    expect(effectGroup('lens-correction').label).toBe('Lens & Distort');
    const defaults = getDefaultParams('lens-correction');
    expect(defaults).toMatchObject({ distortion: 0, fineDistortion: 0, redFringe: 0, blueFringe: 0, vignette: 0, scale: 100 });
    expect(Object.values(lensCorrection.params).filter(param => param.type === 'number' && !param.hidden).every(param => param.animatable)).toBe(true);
  });
  it('uses bounded, finite uniforms, preserves aspect, and supports signed corrections', () => {
    const p = normalizeLensCorrection({ distortion: -200, scale: 0, vignette: NaN, centerX: 2, blueFringe: Infinity });
    expect(p).toMatchObject({ distortion: -100, scale: 50, vignette: 0, centerX: 1, blueFringe: 0 });
    const uniforms = lensCorrection.packUniforms({ distortion: -25, fineDistortion: 10, scale: 120, redFringe: -5, vignette: 50 }, 6000, 4000)!;
    expect(uniforms.byteLength).toBe(96);
    expect(uniforms[0]).toBe(-0.25); expect(uniforms[3]).toBe(1.5);
    expect(uniforms[2]).toBeCloseTo(1.2); expect(uniforms[6]).toBeCloseTo(-0.005);
    expect(uniforms[8]).toBe(0.5);
    expect([...uniforms].every(Number.isFinite)).toBe(true);
  });
  it('uses the measured 24 mm f/4 infinity calibration and neutral coefficients for manual mode', () => {
    const terms = lensProfileUniforms(CANON_24_105_PROFILE, 24, 4, 1000);
    const d = 1 - 0.017263 + 0.049244;
    expect(terms.slice(0, 4)).toEqual([0.017263 / d ** 4, -0.049244 / d ** 3, 0, 1]);
    expect(terms.slice(4, 8)).toEqual([-0.0000336, 1.0011673, -0.0000857, 1.000182]);
    expect(terms.slice(8)).toEqual([-0.546, -0.2245, -0.0825, 1]);
    expect(lensProfileUniforms('manual', 24, 4, 1000)).toEqual([0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0]);
  });
  it('interpolates zoom and focus distance without stepping between calibration points', () => {
    const a = lensProfileUniforms(CANON_24_105_PROFILE, 35, 4, 1000);
    const b = lensProfileUniforms(CANON_24_105_PROFILE, 50, 4, 1000);
    const midpoint = lensProfileUniforms(CANON_24_105_PROFILE, 42.5, 4, 1000);
    for (const i of [8, 9, 10]) expect(midpoint[i]).toBeCloseTo((a[i] + b[i]) / 2, 8);
    const near = lensProfileUniforms(CANON_24_105_PROFILE, 24, 4, 0.45);
    expect(near.slice(8, 11)).toEqual([-0.4795, -0.5164, 0.1168]);
    const middleFocus = lensProfileUniforms(CANON_24_105_PROFILE, 24, 4, 0.6);
    const far = lensProfileUniforms(CANON_24_105_PROFILE, 24, 4, 0.9);
    for (const i of [8, 9, 10]) expect(middleFocus[i]).toBeCloseTo((near[i] + far[i]) / 2, 8);
    const uniforms = lensCorrection.packUniforms({ profile: CANON_24_105_PROFILE, focalLength: 40, aperture: 4,
      sourceAspect: 5796 / 3870 }, 1920, 1080)!;
    expect(uniforms[3]).toBeCloseTo(5796 / 3870);
    expect(uniforms[15]).toBe(1); expect(uniforms[23]).toBe(1);
  });
});
