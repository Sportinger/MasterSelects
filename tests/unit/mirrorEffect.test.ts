import { describe, expect, it } from 'vitest';
import { MIRROR_PRESETS, mirror } from '../../src/effects/distort/mirror';
import { MIRROR_KEEP_OPTIONS } from '../../src/services/operators/mirrorRecipes';

describe('Mirror presets', () => {
  it('name only the mirror lines, the kept side and a level Angle, with valid values', () => {
    expect(MIRROR_PRESETS.map(preset => preset.name)).toEqual(['Still Lake', 'Folded City', 'Face to Face', 'Four Way']);
    for (const preset of MIRROR_PRESETS) {
      expect(Object.keys(preset.params).toSorted()).toEqual(['angle', 'horizontal', 'keep', 'vertical']);
      expect(typeof preset.params.horizontal).toBe('boolean');
      expect(typeof preset.params.vertical).toBe('boolean');
      // At least one line mirrors: a preset never leaves the picture unchanged.
      expect(preset.params.horizontal || preset.params.vertical).toBe(true);
      expect(MIRROR_KEEP_OPTIONS.map(option => option.value)).toContain(preset.params.keep);
      expect(preset.params.angle).toBe(0);
    }
    expect(mirror.presets).toBe(MIRROR_PRESETS);
  });

  it('are all different looks', () => {
    const looks = MIRROR_PRESETS.map(preset => JSON.stringify(preset.params));
    expect(new Set(looks).size).toBe(looks.length);
  });
});
