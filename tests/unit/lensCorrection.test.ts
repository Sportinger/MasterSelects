import { describe, it, expect } from 'vitest';
import { lensCorrection, lensCorrectionWarnings, lensGeometryChangedSince327, normalizeLensCorrection } from '../../src/effects/distort/lens-correction';
import { getEffect, getDefaultParams, effectGroup } from '../../src/effects';
import { CANON_24_105_PROFILE, lensProfileUniforms } from '../../src/effects/distort/lens-correction/lensProfile';
import { LENS_KNEE_SLOPE, LENS_NO_KNEE, lensKnee, lensOutputRadius, lensSourceRadius, lensStretchRange } from '../../src/effects/distort/lens-correction/lensFrameFit';

const packedGeometry = (p: Float32Array) => ({ aspect: p[3], centerX: p[4], centerY: p[5], cropFactor: p[10], distortion: p[0], fineDistortion: p[1], profile: [...p.slice(12, 16)] });
/** Output radius of the farthest frame corner (before scale is applied, as the shader measures it). */
const cornerRadius = (p: Float32Array) => {
  const radiusScale = 2 / Math.hypot(p[3], 1);
  return Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => Math.hypot((u - p[4]) * p[3] * radiusScale, (v - p[5]) * radiusScale))) / p[2];
};

describe('Lens Correction', () => {
  it('keeps legacy framing and fits barrel-distorted corners rather than zooming into them', () => {
    expect(lensCorrection.packUniforms({distortion:-10,scale:125},6000,4000)![2]).toBeCloseTo(1.25);
    const fitted=lensCorrection.packUniforms({distortion:-10,scale:125,fitFullImage:true},6000,4000)!;
    // At a centered source corner, r - 0.1 r^3 = 1 gives r ~= 1.1535.
    expect(fitted[2]).toBeCloseTo(.867,2);
    expect(lensCorrection.packUniforms({fitFullImage:true},6000,4000)![2]).toBe(1);
    expect(lensCorrection.packUniforms({distortion:-10,fitFullImage:false},6000,4000)![2]).toBe(1);
  });
  it('lets Fit Entire Photo pick the scale alone and names a Scale it ignores (row hidden, keyframes or a tool call)', () => {
    const fit=lensCorrection.packUniforms({distortion:-10,scale:125,fitFullImage:true},6000,4000)![2];
    expect(lensCorrection.packUniforms({distortion:-10,scale:60,fitFullImage:true},6000,4000)![2]).toBeCloseTo(fit,6);
    expect(lensCorrection.packUniforms({scale:50,fitFullImage:true},6000,4000)![2]).toBe(1);
    expect(lensCorrectionWarnings({distortion:-10,scale:60,fitFullImage:true}).join(' ')).toContain('Scale 60% is ignored while Fit Entire Photo is on');
    expect(lensCorrectionWarnings({distortion:-10,scale:100,fitFullImage:true})).toEqual([]);
    expect(lensCorrectionWarnings({distortion:-10,scale:60})).toEqual([]);
  });
  it('declares presets that set only its own controls, within range, without folding the picture', () => {
    expect(lensCorrection.presets!.map(preset => preset.name)).toEqual(['Wide Angle', 'Action Cam', 'Whole Photo', 'Even Corners']);
    for (const preset of lensCorrection.presets!) {
      for (const [key, value] of Object.entries(preset.params)) {
        const definition = lensCorrection.params[key];
        expect(definition && !definition.hidden, `${preset.name}: ${key}`).toBe(true);
        if (typeof value === 'number') expect(value).toBe(Math.min(definition.max!, Math.max(definition.min!, value)));
      }
      expect(lensCorrectionWarnings(preset.params), preset.name).toEqual([]);
      // The lens model draws the whole frame: the knee's straight line stays beyond the farthest corner.
      for (const [width, height] of [[1920, 1080], [1500, 1000]]) {
        const packed = lensCorrection.packUniforms({ ...getDefaultParams('lens-correction'), ...preset.params }, width, height)!;
        expect(lensKnee(packedGeometry(packed)).radius, `${preset.name} ${width}x${height}`).toBeGreaterThan(cornerRadius(packed));
      }
    }
  });
  it('stays continuous while Fine Distortion moves across the point where the knee appears or vanishes', () => {
    // Distortion -40 with Fine 9 dips below the knee slope and recovers; by Fine 10 the dip is gone.
    const sweep = (extra: Record<string, number | boolean>) => {
      const rows: Array<{ scale: number; source: number }> = [];
      for (let fine = 9; fine <= 10 + 1e-9; fine += .05) {
        const packed = lensCorrection.packUniforms({ distortion: -40, fineDistortion: fine, sourceAspect: 1.5, ...extra }, 1500, 1000)!;
        rows.push({ scale: packed[2], source: lensSourceRadius(cornerRadius(packed), packedGeometry(packed)) });
      }
      return rows;
    };
    for (const extra of [{ fitFullImage: true }, { scale: 60 }]) {
      const rows = sweep(extra);
      for (let i = 1; i < rows.length; i++) {
        expect(Math.abs(rows[i].scale / rows[i - 1].scale - 1), `${JSON.stringify(extra)} step ${i} scale`).toBeLessThan(.01);
        expect(Math.abs(rows[i].source / rows[i - 1].source - 1), `${JSON.stringify(extra)} step ${i} corner`).toBeLessThan(.01);
      }
    }
    // Where the polynomial recovers, the mapping hands back to it.
    const geometry = packedGeometry(lensCorrection.packUniforms({ distortion: -40, fineDistortion: 9, sourceAspect: 1.5 }, 1500, 1000)!);
    const knee = lensKnee(geometry);
    expect(knee.radius).toBeLessThan(knee.rejoin); expect(knee.rejoin).toBeLessThan(LENS_NO_KNEE);
    const beyond = knee.rejoin + .2;
    expect(lensSourceRadius(beyond, geometry)).toBeGreaterThan(knee.source + knee.slope * (beyond - knee.radius));
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
  it('continues strong barrel removal in a straight line from the knee instead of folding, so the whole photo always fits', () => {
    const manual = (distortion: number, fineDistortion = 0) => ({ aspect: 1.5, centerX: .5, centerY: .5, cropFactor: 1, distortion, fineDistortion,
      profile: lensProfileUniforms('manual', 24, 4, 1000) });
    // d/dr (r + k r^3) = 1 + 3 k r^2 reaches the knee slope at r = sqrt((1 - slope) / (-3 k)).
    expect(lensKnee(manual(-.5)).radius).toBeCloseTo(Math.sqrt((1 - LENS_KNEE_SLOPE) / 1.5), 5);
    expect(lensKnee(manual(-.2)).radius).toBeGreaterThan(1);
    expect(lensKnee(manual(.8)).radius).toBe(LENS_NO_KNEE);
    // Down to Distortion -25 a centred frame keeps the 3.2.7 polynomial up to its corner (radius 1).
    expect(lensKnee(manual(-.25)).radius).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(lensGeometryChangedSince327({ distortion: -25 }, 1500, 1000)).toBe(false);
    expect(lensGeometryChangedSince327({ distortion: -14, fitFullImage: true }, 1500, 1000)).toBe(false);
    expect(lensGeometryChangedSince327({ distortion: -40 }, 1500, 1000)).toBe(true);
    expect(lensGeometryChangedSince327({ distortion: -10, scale: 60, fitFullImage: true }, 1500, 1000)).toBe(true);
    for (const [distortion, fine] of [[-.6, 0], [-1, 0], [0, -.5], [-1, -.5]]) {
      const geometry = manual(distortion, fine), knee = lensKnee(geometry);
      // Continuous at the knee, then strictly outward: no fold anywhere.
      expect(lensSourceRadius(knee.radius + 1e-9, geometry)).toBeCloseTo(lensSourceRadius(knee.radius, geometry), 6);
      let previous = 0;
      for (let step = 1; step <= 4000; step++) {
        const mapped = lensSourceRadius(step / 1000, geometry);
        expect(mapped).toBeGreaterThan(previous); previous = mapped;
      }
      expect(lensOutputRadius(lensSourceRadius(1.7, geometry), geometry)).toBeCloseTo(1.7, 6);
    }
    // The knee sits in slot 11, its source radius and slope in 24 and 25.
    const packed = lensCorrection.packUniforms({ distortion: -50 }, 1500, 1000)!;
    expect(packed.byteLength).toBe(112);
    expect(packed[11]).toBeCloseTo(Math.sqrt(.75 / 1.5), 4);
    expect(packed[24]).toBeCloseTo(packed[11] - .5 * packed[11] ** 3, 4); expect(packed[25]).toBe(LENS_KNEE_SLOPE);
  });
  it('fits the whole photo at Distortion -60 with nothing folded, no NaN and no warning', () => {
    for (const [params, aspect] of [[{ distortion: -60 }, 1.5], [{ distortion: -100, fineDistortion: -50 }, 16 / 9], [{ distortion: -60, centerX: .3, centerY: .62 }, 1.5]] as const) {
      const all = { ...params, fitFullImage: true, sourceAspect: aspect };
      const p = lensCorrection.packUniforms(all, 1920, 1080)!;
      expect([...p].every(Number.isFinite)).toBe(true);
      expect(p[2]).toBeGreaterThan(.05); expect(p[2]).toBeLessThan(1);
      // No fold to warn about, but the stretched outer ring is named.
      const warnings = lensCorrectionWarnings(all, 1920, 1080);
      expect(warnings).toHaveLength(1); expect(warnings[0]).toMatch(/^Beyond about \d+ % of the way to the frame corner .* stretched evenly/);
      const geometry = packedGeometry(p);
      const radiusScale = 2 / Math.hypot(p[3], 1);
      // Every point of the source perimeter lands inside the frame, so no part of the photo is cut or folded away.
      for (let step = 0; step <= 256; step++) for (const [u, v] of [[step / 256, 0], [step / 256, 1], [0, step / 256], [1, step / 256]]) {
        const radius = Math.hypot((u - p[4]) * p[3] * radiusScale, (v - p[5]) * radiusScale);
        const ratio = radius > 0 ? lensOutputRadius(radius, geometry) / radius : 1;
        const x = p[4] + (u - p[4]) * ratio * p[2], y = p[5] + (v - p[5]) * ratio * p[2];
        expect(x).toBeGreaterThanOrEqual(-1e-4); expect(x).toBeLessThanOrEqual(1.0001);
        expect(y).toBeGreaterThanOrEqual(-1e-4); expect(y).toBeLessThanOrEqual(1.0001);
      }
    }
  });
  it('names the outer ring a straight line stretches instead of straightening it, and nothing below that', () => {
    expect(lensCorrectionWarnings({ distortion: -25 }, 1500, 1000)).toEqual([]);
    expect(lensCorrectionWarnings({ distortion: -14, fitFullImage: true }, 1500, 1000)).toEqual([]);
    // Distortion -28 with Fit: the knee lies about halfway to the corner.
    const whole = lensCorrectionWarnings({ distortion: -28, fitFullImage: true }, 1500, 1000);
    expect(whole).toHaveLength(1); expect(whole[0]).toMatch(/^Beyond about (4\d|5\d) % of the way/);
    // Fine Distortion recovers the polynomial before the corner: the note names both ends.
    const geometry = packedGeometry(lensCorrection.packUniforms({ distortion: -40, fineDistortion: 9, scale: 60, sourceAspect: 1.5 }, 1500, 1000)!);
    expect(lensStretchRange(geometry, 4)).toBeDefined();
    expect(lensCorrectionWarnings({ distortion: -40, fineDistortion: 9, scale: 60, sourceAspect: 1.5 }, 1500, 1000)[0]).toMatch(/^Between about \d+ % and \d+ %/);
  });
  it('reports clamped values instead of applying them silently', () => {
    expect(lensCorrectionWarnings({ distortion: -10 })).toEqual([]);
    expect(lensCorrectionWarnings({ distortion: -50 })).toHaveLength(1);
    const clamped = lensCorrectionWarnings({ distortion: 250, vignette: NaN });
    expect(clamped).toEqual(expect.arrayContaining([expect.stringContaining('distortion: 250 is outside -100..100; using 100'), expect.stringContaining('vignette: NaN')]));
  });
  it('bypasses profile and manual vignetting together while retaining geometry and stored settings', () => {
    const params={profile:CANON_24_105_PROFILE,focalLength:24,aperture:4,distortion:12,redFringe:2,vignette:35};
    const enabled=lensCorrection.packUniforms(params,6000,4000)!;
    const bypassed=lensCorrection.packUniforms({...params,vignetteEnabled:false},6000,4000)!;
    expect(bypassed[8]).toBe(0); expect([...bypassed.slice(20,24)]).toEqual([0,0,0,0]);
    for(const i of [0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,24,25])expect(bypassed[i]).toBe(enabled[i]);
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
    expect(uniforms.byteLength).toBe(112);
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
