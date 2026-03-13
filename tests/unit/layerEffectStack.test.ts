import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';

describe('splitLayerEffects', () => {
  it('returns default inline values when effects are skipped', () => {
    const result = splitLayerEffects([
      {
        id: 'fx-1',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: { amount: 0.5 },
      },
    ] as Effect[], true);

    expect(result.inlineEffects).toEqual({
      brightness: 0,
      contrast: 1,
      saturation: 1,
      invert: false,
    });
    expect(result.complexEffects).toBeUndefined();
  });

  it('separates inline and complex effects while ignoring disabled and audio effects', () => {
    const result = splitLayerEffects([
      {
        id: 'fx-brightness',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: { amount: 0.25 },
      },
      {
        id: 'fx-contrast',
        name: 'Contrast',
        type: 'contrast',
        enabled: true,
        params: { amount: 1.4 },
      },
      {
        id: 'fx-invert',
        name: 'Invert',
        type: 'invert',
        enabled: true,
        params: {},
      },
      {
        id: 'fx-blur',
        name: 'Gaussian Blur',
        type: 'gaussian-blur',
        enabled: true,
        params: { radius: 12 },
      },
      {
        id: 'fx-audio',
        name: 'EQ',
        type: 'audio-eq',
        enabled: true,
        params: {},
      },
      {
        id: 'fx-disabled',
        name: 'Pixelate',
        type: 'pixelate',
        enabled: false,
        params: { pixelSize: 8 },
      },
    ] as Effect[]);

    expect(result.inlineEffects).toEqual({
      brightness: 0.25,
      contrast: 1.4,
      saturation: 1,
      invert: true,
    });
    expect(result.complexEffects).toEqual([
      expect.objectContaining({ id: 'fx-blur', type: 'gaussian-blur' }),
    ]);
  });
});
