import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import {
  KINETIC_TRACE_LEGACY_KEEP,
  KINETIC_TRACE_PRESETS,
  kineticTrace,
  kineticTraceFeedbackState,
  kineticTraceKeep,
  kineticTraceParamNotes,
  kineticTraceSoftness,
} from '../../src/effects/time/kinetic-trace';
import { kineticTrace as trackingExport } from '../../src/effects/tracking';

const pack = (params: Record<string, number | boolean | string>) => Array.from(kineticTrace.packUniforms(params, 64, 36, 1) ?? []);

describe('Motion Trails (kinetic-trace)', () => {
  it('stays registered under its id and the tracking family export', () => {
    expect(getEffect('kinetic-trace')).toBe(kineticTrace);
    expect(trackingExport).toBe(kineticTrace);
    expect(kineticTrace.uniformSize).toBe(pack(getDefaultParams('kinetic-trace')).length * 4);
  });

  it('feeds back the unmixed trace, so Amount is an opacity and Length alone sets the trail', () => {
    expect(kineticTrace.feedbackStateParams).toBe(kineticTraceFeedbackState);
    expect(kineticTraceFeedbackState({ amount: 0.3, trail: 0.9 })).toEqual({ amount: 1 });
    for (const amount of [0, 0.3, 1]) expect(kineticTraceKeep({ amount, trail: 0.9 })).toBeCloseTo(0.9);
    // The state pass packs Amount 1, the output pass the real Amount, both with the same Length.
    const state = pack({ amount: 0.3, trail: 0.9, ...kineticTraceFeedbackState({ amount: 0.3, trail: 0.9 }) });
    const output = pack({ amount: 0.3, trail: 0.9 });
    expect([state[2], output[2]].map(value => +value.toFixed(4))).toEqual([1, 0.3]);
    expect(state[16]).toBeCloseTo(output[16]);
    expect(pack({ amount: 1, trail: 0.96, tint: 0.4, softness: 2 }).slice(16, 19).map(value => +value.toFixed(4))).toEqual([0.96, 0.4, 2]);
    expect(kineticTraceParamNotes({ amount: 0.2, trail: 0.95 })).toEqual([]);
  });

  it('lets a trail fade completely in the 8-bit feedback texture', () => {
    // rgba8unorm rounds: v × keep rounds back to v below 0.5 / (1 - keep) steps; 0.6 of a step more fades it.
    const run = (keep: number, bias: number) => { let v = 255; for (let n = 0; n < 3000; n++) v = Math.max(0, Math.round(v * keep - bias)); return v; };
    expect(run(0.97, 0)).toBeGreaterThan(10);
    expect(run(0.97, 0.6)).toBe(0);
    expect(run(0.995, 0.6)).toBe(0);
    expect(kineticTrace.shader).toMatch(/let fade = select\(0\.6 \/ 255\.0, 0\.0, keep >= 1\.0\)/);
  });

  it('softens the trail by Softness pixels of a 1080-line frame, clamped and reported', () => {
    expect(kineticTraceSoftness({})).toBe(0);
    expect(kineticTraceSoftness({ softness: 12 })).toBe(8);
    expect(kineticTraceSoftness({ softness: -1 })).toBe(0);
    expect(getDefaultParams('kinetic-trace').softness).toBe(1);
    expect(kineticTrace.params.softness.legacyDefault).toBe(0);
    expect(kineticTraceParamNotes({ trail: 0.9, softness: 12 }).join(' ')).toMatch(/Softness 12 is outside 0 to 8 px; it renders as 8 px/);
    expect(kineticTrace.shader).toMatch(/params\.softness \/ 1080\.0/);
  });

  it('renders a Motion Trails saved before Length and Tint exactly as before', () => {
    const saved = { amount: 0.8, color: '#36f59a', speed: 1, historyLoop: 'reset' };
    expect(kineticTraceKeep(saved)).toBe(KINETIC_TRACE_LEGACY_KEEP);
    const uniforms = pack(saved);
    expect(uniforms[2]).toBeCloseTo(0.8);
    expect(uniforms[16]).toBeCloseTo(0.9);
    expect(uniforms[17]).toBe(0);
    expect(uniforms[18]).toBe(0);
    // It fed back its Amount-mixed output and keeps doing so (no unmixed state pass).
    expect(kineticTraceFeedbackState(saved)).toBeUndefined();
    expect(kineticTrace.params.color.legacyDefault).toBe('#36f59a');
    expect(kineticTrace.params.trail.legacyDefault).toBeCloseTo(0.9 * 0.8);
    expect(kineticTrace.params.tint.legacyDefault).toBe(0);
    expect(kineticTrace.params.speed.deprecated).toMatch(/no speed/);
  });

  it('clamps and reports out-of-range and no-op values', () => {
    expect(pack({ amount: 1.4, trail: -0.2, tint: 2 }).slice(16, 18)).toEqual([0, 1]);
    expect(pack({ amount: 1.4, trail: 0.5 })[2]).toBe(1);
    const notes = kineticTraceParamNotes({ amount: 1.4, trail: -0.2, tint: 2 }).join(' ');
    expect(notes).toMatch(/Amount 1.4 is outside 0 to 1; it renders as 1/);
    expect(notes).toMatch(/Length -0.2 is outside 0 to 1; it renders as 0/);
    expect(notes).toMatch(/Tint 2 is outside 0 to 1/);
    expect(kineticTraceParamNotes({ amount: 0.5 }).join(' ')).toMatch(/saved before Length/);
    expect(kineticTraceParamNotes({ amount: 1, trail: 0.9, tint: 0, color: '#ff0000' }).join(' ')).toMatch(/At Tint 0 the Overlay colour/);
    expect(kineticTraceParamNotes(getDefaultParams('kinetic-trace'))).toEqual([]);
  });

  it('has the default look as its first preset and only valid, distinct presets', () => {
    const defaults = getDefaultParams('kinetic-trace');
    expect(KINETIC_TRACE_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(KINETIC_TRACE_PRESETS.length).toBeLessThanOrEqual(5);
    expect(Object.entries(KINETIC_TRACE_PRESETS[0].params).every(([key, value]) => defaults[key] === value)).toBe(true);
    for (const preset of KINETIC_TRACE_PRESETS) {
      for (const [key, value] of Object.entries(preset.params)) {
        const param = kineticTrace.params[key];
        expect(param, `${preset.name}.${key}`).toBeDefined();
        expect(param.deprecated).toBeUndefined();
        if (param.type === 'number') expect(value as number).toBeGreaterThanOrEqual(param.min ?? 0);
        if (param.type === 'number') expect(value as number).toBeLessThanOrEqual(param.max ?? 1);
      }
      expect(kineticTraceParamNotes({ ...defaults, ...preset.params }), preset.name).toEqual([]);
    }
    expect(new Set(KINETIC_TRACE_PRESETS.map(preset => JSON.stringify(preset.params))).size).toBe(KINETIC_TRACE_PRESETS.length);
  });

  it('draws the subject glow only with tracking data and tints by brightness, not per channel', () => {
    const shader = kineticTrace.shader;
    expect(shader).toMatch(/if \(params\.count < 0\.5\) \{ return 0\.0; \}/);
    expect(shader).toMatch(/smoothstep\(-0\.02, 0\.02, luminance\(trail\.rgb\) - luminance\(current\.rgb\)\)/);
    // Premultiplied trail: over transparency it fades with its alpha.
    expect(shader).toMatch(/return vec4f\(texel\.rgb \* texel\.a, texel\.a\)/);
  });
});
