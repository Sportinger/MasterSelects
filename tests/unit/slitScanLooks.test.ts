import { describe, expect, it } from 'vitest';
import { SLIT_SCAN_LOOKS, SLIT_SCAN_LOOK_KEYS, applySlitScanLook, slitScanLookOf } from '../../src/effects/time/slit-scan/looks';
import { slitScanNumber, slitScanParamWarnings, slitScanParams } from '../../src/effects/time/slit-scan/parameters';
import { getEffect } from '../../src/effects';
import fs from 'node:fs';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';

describe('Slit Scan looks', () => {
  it('set every look key to a value the parameter accepts, and only the Time and Wave sections', () => {
    for (const look of SLIT_SCAN_LOOKS) for (const key of SLIT_SCAN_LOOK_KEYS) {
      const parameter = slitScanParams[key], value = look.params[key];
      expect(['Time', 'Wave']).toContain(parameter.group);
      if (parameter.type === 'select') expect(parameter.options!.map(option => option.value)).toContain(value);
      else { expect(typeof value).toBe('number'); expect(value as number).toBeGreaterThanOrEqual(parameter.min!); expect(value as number).toBeLessThanOrEqual(parameter.max!); }
    }
    const signatures = SLIT_SCAN_LOOKS.map(look => JSON.stringify(look.params));
    expect(new Set(signatures).size).toBe(SLIT_SCAN_LOOKS.length);
  });

  it('recognises an applied look, keeps the other settings, and reads Custom after any edit', () => {
    const saved = { temporalStorage: 'hybrid', temporalInterpolation: 'nearest', delay: 4, profile: 'wave' };
    for (const look of SLIT_SCAN_LOOKS) {
      const applied = applySlitScanLook(saved, look.id);
      expect(slitScanLookOf(applied)).toBe(look.id);
      expect(applied).toMatchObject({ temporalStorage: 'hybrid', temporalInterpolation: 'nearest' });
      expect(slitScanLookOf({ ...applied, delay: Number(applied.delay) + 0.5 })).toBe('custom');
    }
    // A new effect (registry defaults, Delay 1 s) matches no preset; unknown ids change nothing.
    expect(slitScanLookOf({})).toBe('custom');
    expect(applySlitScanLook(saved, 'nope')).toBe(saved);
  });

  it('reads Custom while a Look value is animated (keyframes or a node source decide it, not the Look)', () => {
    const applied = applySlitScanLook({}, 'rings');
    expect(slitScanLookOf(applied, ['delay'])).toBe('custom');
    expect(slitScanLookOf(applied, ['speed'])).toBe('custom');
    // Keys outside the Look (here Protection strength and Time factor) do not matter.
    expect(slitScanLookOf(applied, ['maskStrength', 'timeFactor'])).toBe('rings');
  });

  it('offers three to five named presets', () => {
    expect(SLIT_SCAN_LOOKS.map(look => look.label)).toEqual(['Sweep', 'Wave Folds', 'Radial Bloom', 'Time Rings', 'Time Steps']);
    for (const look of SLIT_SCAN_LOOKS) expect(look.label).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
  });

  it('keeps the docs presets loop recipe in step with the presets (scripts/doc-clips/keying-time.json)', () => {
    const shots = JSON.parse(fs.readFileSync('scripts/doc-clips/keying-time.json', 'utf8')) as { clips: Array<{ name: string; presets?: Array<{ name: string; params: Record<string, unknown> }> }> };
    const recipe = shots.clips.find(clip => clip.name === 'slit-scan-presets')!.presets!;
    expect(recipe).toEqual(SLIT_SCAN_LOOKS.map(look => ({ name: look.label, params: look.params })));
  });

  it('dims Angle in the radial profiles and the Wave section outside the wave profiles, matching the graph', () => {
    const active = (key: string, profile: string) => slitScanParams[key].activeWhen!.values.includes(profile);
    for (const profile of ['linear', 'center', 'wave']) expect(active('angle', profile), profile).toBe(true);
    for (const profile of ['radial', 'rings']) expect(active('angle', profile), profile).toBe(false);
    for (const key of ['waves', 'phase', 'speed']) {
      for (const profile of ['wave', 'rings']) expect(active(key, profile), `${key} ${profile}`).toBe(true);
      for (const profile of ['linear', 'center', 'radial']) expect(active(key, profile), `${key} ${profile}`).toBe(false);
      expect(slitScanParams[key].activeWhen!.param).toBe('profile');
    }
    // Every value the dims name is a real Profile option.
    const profiles = slitScanParams.profile.options!.map(option => option.value);
    for (const key of ['angle', 'waves', 'phase', 'speed']) for (const value of slitScanParams[key].activeWhen!.values) expect(profiles).toContain(value);
  });

  it('says that Time bands above 0 up to 1 render as off, and nothing for 0 or real band counts', () => {
    const definition = getEffect('slit-scan')!;
    expect('paramWarnings' in definition && definition.paramWarnings).toBe(slitScanParamWarnings);
    expect(slitScanParamWarnings({ bands: 1 })).toEqual(['Time bands 1 acts as off (0): set 2 or more to cut the picture into bands.']);
    expect(slitScanParamWarnings({ bands: 0.4 })).toHaveLength(1);
    for (const bands of [0, 2, 12, 64, undefined, 'abc']) expect(slitScanParamWarnings({ bands }), String(bands)).toEqual([]);
  });

  it('blends adjacent frames by default for new effects, like the runtime fallback of older saved ones', () => {
    expect(slitScanParams.temporalInterpolation.default).toBe('linear');
  });

  it('reads null, NaN and text numbers with the graph\'s rule, so the history window and the graph delay agree', () => {
    for (const delay of [null, Number.NaN, 'abc', '2.5', 2.5]) {
      const graphDelay = Number(effectOperatorParams({ type: 'slit-scan', params: { delay } }).delay);
      expect(slitScanNumber({ delay }, 'delay'), String(delay)).toBe(Math.min(60, Math.max(0, graphDelay)));
    }
    expect(slitScanNumber({ delay: null }, 'delay')).toBe(1);
    expect(slitScanNumber({ delay: '2.5' }, 'delay')).toBe(2.5);
  });
});
