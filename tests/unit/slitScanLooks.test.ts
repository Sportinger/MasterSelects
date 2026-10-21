import { describe, expect, it } from 'vitest';
import { SLIT_SCAN_LOOKS, SLIT_SCAN_LOOK_KEYS, applySlitScanLook, slitScanLookOf } from '../../src/effects/time/slit-scan/looks';
import { slitScanNumber, slitScanParams } from '../../src/effects/time/slit-scan/parameters';
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
    // A new effect (registry defaults) starts as the Sweep look; unknown ids change nothing.
    expect(slitScanLookOf({})).toBe('sweep');
    expect(applySlitScanLook(saved, 'nope')).toBe(saved);
  });

  it('reads Custom while a Look value is animated (keyframes or a node source decide it, not the Look)', () => {
    const applied = applySlitScanLook({}, 'fall');
    expect(slitScanLookOf(applied, ['delay'])).toBe('custom');
    expect(slitScanLookOf(applied, ['speed'])).toBe('custom');
    // Keys outside the Look (here Protection strength and Time factor) do not matter.
    expect(slitScanLookOf(applied, ['maskStrength', 'timeFactor'])).toBe('fall');
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
