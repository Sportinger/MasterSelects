import { describe, expect, it } from 'vitest';
import { RGB_SPLIT_PRESETS, rgbSplit } from '../../src/effects/distort/rgb-split';
import { RGB_SPLIT_MODE_OPTIONS } from '../../src/services/operators/mirrorRecipes';

describe('RGB Split presets', () => {
  it('name only Amount, Angle and Mode, inside the control limits', () => {
    expect(RGB_SPLIT_PRESETS.map(preset => preset.name)).toEqual(['Misprint', 'Glitch', 'Cheap Lens', 'Double Vision']);
    const amount = rgbSplit.params.amount as { min: number; max: number };
    const angle = rgbSplit.params.angle as { min: number; max: number };
    for (const preset of RGB_SPLIT_PRESETS) {
      expect(Object.keys(preset.params).toSorted()).toEqual(['amount', 'angle', 'mode']);
      const value = preset.params.amount as number;
      // A preset always splits: Amount 0 would leave the picture unchanged.
      expect(value).toBeGreaterThan(amount.min);
      expect(value).toBeLessThanOrEqual(amount.max);
      expect(preset.params.angle as number).toBeGreaterThanOrEqual(angle.min);
      expect(preset.params.angle as number).toBeLessThanOrEqual(angle.max);
      expect(RGB_SPLIT_MODE_OPTIONS.map(option => option.value)).toContain(preset.params.mode);
    }
    expect(rgbSplit.presets).toBe(RGB_SPLIT_PRESETS);
  });

  it('are all different looks', () => {
    const looks = RGB_SPLIT_PRESETS.map(preset => JSON.stringify(preset.params));
    expect(new Set(looks).size).toBe(looks.length);
  });
});
