import { describe, it, expect } from 'vitest';
import { lensCorrection, normalizeLensCorrection } from '../../src/effects/distort/lens-correction';
import { getEffect, getDefaultParams, effectGroup } from '../../src/effects';
import { CANON_24_105_PROFILE, lensProfileUniforms } from '../../src/effects/distort/lens-correction/lensProfile';
import { lensOutputRadius } from '../../src/effects/distort/lens-correction/lensFrameFit';

describe('Lens Correction', () => {
  it('keeps legacy framing and fits barrel-distorted corners rather than zooming into them', () => {
    expect(lensCorrection.packUniforms({distortion:-10,scale:125},6000,4000)![2]).toBeCloseTo(1.25);
    const fitted=lensCorrection.packUniforms({distortion:-10,scale:125,fitFullImage:true},6000,4000)!;
    // At a centered source corner, r - 0.1 r^3 = 1 gives r ~= 1.1535.
    expect(fitted[2]).toBeCloseTo(.867,2);
    expect(lensCorrection.packUniforms({fitFullImage:true},6000,4000)![2]).toBe(1);
    expect(lensCorrection.packUniforms({distortion:-10,fitFullImage:false},6000,4000)![2]).toBe(1);
  });
  it.each([
    [24,1.5,.5,.5,1], [105,2/3,.37,.61,1], [35,1.5,.25,.75,1.6],
  ])('keeps the full corrected source perimeter visible at %s mm with offset optical centers', (focal,aspect,centerX,centerY,cropFactor) => {
    const params={profile:CANON_24_105_PROFILE,focalLength:focal,sourceAspect:aspect,centerX,centerY,cropFactor,
      distortion:-3,fineDistortion:1,fitFullImage:true};
    const p=lensCorrection.packUniforms(params,6000,4000)!;
    const geometry={aspect:p[3],centerX:p[4],centerY:p[5],cropFactor:p[10],distortion:p[0],fineDistortion:p[1],profile:[...p.slice(12,16)]};
    const radiusScale=2/Math.hypot(p[3],1);
    for(let step=0;step<=1024;step++)for(const [u,v] of [[step/1024,0],[step/1024,1],[0,step/1024],[1,step/1024]]) {
      const radius=Math.hypot((u-p[4])*p[3]*radiusScale,(v-p[5])*radiusScale);
      const outputRadius=lensOutputRadius(radius,geometry), ratio=radius>0?outputRadius/radius:1;
      const x=p[4]+(u-p[4])*ratio*p[2], y=p[5]+(v-p[5])*ratio*p[2];
      expect(x).toBeGreaterThanOrEqual(-1e-5);expect(x).toBeLessThanOrEqual(1.00001);
      expect(y).toBeGreaterThanOrEqual(-1e-5);expect(y).toBeLessThanOrEqual(1.00001);
      // Independently evaluate the shader's polynomial at the inverted radius.
      const r=outputRadius*1.80277564/p[10];
      const mapped=outputRadius*Math.max(.05,(1+p[15]*(p[12]*r**3+p[13]*r**2+p[14]*r))*(1+p[0]*outputRadius**2+p[1]*outputRadius**4));
      expect(mapped).toBeCloseTo(radius,6);
    }
  });
  it('bypasses profile and manual vignetting together while retaining geometry and stored settings', () => {
    const params={profile:CANON_24_105_PROFILE,focalLength:24,aperture:4,distortion:12,redFringe:2,vignette:35};
    const enabled=lensCorrection.packUniforms(params,6000,4000)!;
    const bypassed=lensCorrection.packUniforms({...params,vignetteEnabled:false},6000,4000)!;
    expect(bypassed[8]).toBe(0); expect([...bypassed.slice(20)]).toEqual([0,0,0,0]);
    for(const i of [0,1,2,3,4,5,6,7,9,10,12,13,14,15,16,17,18,19])expect(bypassed[i]).toBe(enabled[i]);
    expect(enabled[8]).toBeCloseTo(.35); expect(enabled[23]).toBe(1);
    expect(params.vignette).toBe(35);
    expect(lensCorrection.packUniforms({...params,vignetteEnabled:true},6000,4000)).toEqual(enabled);
    const manual=lensCorrection.packUniforms({vignette:50,vignetteEnabled:false},6000,4000)!;
    expect(manual[8]).toBe(0); expect(manual[23]).toBe(0);
  });
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
