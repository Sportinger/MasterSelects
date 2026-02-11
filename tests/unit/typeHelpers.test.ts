import { describe, it, expect } from 'vitest';
import {
  isEffectProperty,
  parseEffectProperty,
  createEffectProperty,
  isAudioEffect,
} from '../../src/types/index';
import type { EffectProperty, EffectType } from '../../src/types/index';

// ─── isEffectProperty ──────────────────────────────────────────────────────

describe('isEffectProperty', () => {
  it('transform property → false', () => {
    expect(isEffectProperty('opacity')).toBe(false);
    expect(isEffectProperty('position.x')).toBe(false);
    expect(isEffectProperty('scale.x')).toBe(false);
    expect(isEffectProperty('rotation.z')).toBe(false);
    expect(isEffectProperty('speed')).toBe(false);
  });

  it('effect property → true', () => {
    expect(isEffectProperty('effect.abc123.shift')).toBe(true);
    expect(isEffectProperty('effect.myEffect.amount')).toBe(true);
  });

  it('edge cases', () => {
    expect(isEffectProperty('')).toBe(false);
    expect(isEffectProperty('effec')).toBe(false);
    expect(isEffectProperty('effect')).toBe(false);
    expect(isEffectProperty('effect.')).toBe(true); // starts with "effect."
  });

  it('all TransformProperty values → false', () => {
    const transformProperties = [
      'opacity', 'speed',
      'position.x', 'position.y', 'position.z',
      'scale.x', 'scale.y',
      'rotation.x', 'rotation.y', 'rotation.z',
    ];
    for (const prop of transformProperties) {
      expect(isEffectProperty(prop)).toBe(false);
    }
  });

  it('case sensitivity (Effect vs effect)', () => {
    expect(isEffectProperty('Effect.abc.shift')).toBe(false);
    expect(isEffectProperty('EFFECT.abc.shift')).toBe(false);
    expect(isEffectProperty('eFFECT.abc.shift')).toBe(false);
  });

  it('similar prefixes that are not "effect." → false', () => {
    expect(isEffectProperty('effects.abc.shift')).toBe(false);
    expect(isEffectProperty('effectx.abc.shift')).toBe(false);
    expect(isEffectProperty('effect_.abc.shift')).toBe(false);
  });

  it('effect property with underscores and hyphens', () => {
    expect(isEffectProperty('effect.effect_123456.shift')).toBe(true);
    expect(isEffectProperty('effect.my-effect.some-param')).toBe(true);
  });

  it('effect property with numeric ids', () => {
    expect(isEffectProperty('effect.12345.amount')).toBe(true);
    expect(isEffectProperty('effect.0.0')).toBe(true);
  });

  it('acts as type guard (narrows to EffectProperty)', () => {
    const prop: string = 'effect.abc.shift';
    if (isEffectProperty(prop)) {
      // If this compiles, the type guard is working
      const ep: EffectProperty = prop;
      expect(ep).toBe('effect.abc.shift');
    }
  });
});

// ─── parseEffectProperty ───────────────────────────────────────────────────

describe('parseEffectProperty', () => {
  it('valid effect property → { effectId, paramName }', () => {
    const result = parseEffectProperty('effect.abc123.shift' as EffectProperty);
    expect(result).toEqual({ effectId: 'abc123', paramName: 'shift' });
  });

  it('different property names', () => {
    const result = parseEffectProperty('effect.myEffect.amount' as EffectProperty);
    expect(result).toEqual({ effectId: 'myEffect', paramName: 'amount' });
  });

  it('invalid format (too few parts) → null', () => {
    const result = parseEffectProperty('effect.abc' as EffectProperty);
    expect(result).toBeNull();
  });

  it('invalid format (too many parts) → null', () => {
    const result = parseEffectProperty('effect.abc.def.ghi' as EffectProperty);
    expect(result).toBeNull();
  });

  it('wrong prefix → null', () => {
    const result = parseEffectProperty('noteffect.abc.shift' as EffectProperty);
    expect(result).toBeNull();
  });

  it('single part (no dots) → null', () => {
    const result = parseEffectProperty('effect' as EffectProperty);
    expect(result).toBeNull();
  });

  it('empty string → null', () => {
    const result = parseEffectProperty('' as EffectProperty);
    expect(result).toBeNull();
  });

  it('effect property with empty effectId → still parses (effect..param)', () => {
    const result = parseEffectProperty('effect..param' as EffectProperty);
    expect(result).toEqual({ effectId: '', paramName: 'param' });
  });

  it('effect property with empty paramName → still parses (effect.id.)', () => {
    const result = parseEffectProperty('effect.id.' as EffectProperty);
    expect(result).toEqual({ effectId: 'id', paramName: '' });
  });

  it('effect property with underscored id', () => {
    const result = parseEffectProperty('effect.effect_789012.contrast' as EffectProperty);
    expect(result).toEqual({ effectId: 'effect_789012', paramName: 'contrast' });
  });

  it('effect property with hyphenated id', () => {
    const result = parseEffectProperty('effect.hue-shift-1.amount' as EffectProperty);
    expect(result).toEqual({ effectId: 'hue-shift-1', paramName: 'amount' });
  });

  it('five parts → null', () => {
    const result = parseEffectProperty('effect.a.b.c.d' as EffectProperty);
    expect(result).toBeNull();
  });

  it('exactly two parts (effect.something) → null', () => {
    const result = parseEffectProperty('effect.something' as EffectProperty);
    expect(result).toBeNull();
  });

  it('prefix is "effects" (plural) with three parts → null', () => {
    const result = parseEffectProperty('effects.id.param' as EffectProperty);
    expect(result).toBeNull();
  });
});

// ─── createEffectProperty ──────────────────────────────────────────────────

describe('createEffectProperty', () => {
  it('creates correct format', () => {
    expect(createEffectProperty('abc123', 'shift')).toBe('effect.abc123.shift');
  });

  it('roundtrip with parseEffectProperty', () => {
    const prop = createEffectProperty('myEffect', 'amount');
    const parsed = parseEffectProperty(prop);
    expect(parsed).toEqual({ effectId: 'myEffect', paramName: 'amount' });
  });

  it('result is detected by isEffectProperty', () => {
    const prop = createEffectProperty('effect_001', 'brightness');
    expect(isEffectProperty(prop)).toBe(true);
  });

  it('various effectId formats', () => {
    expect(createEffectProperty('effect_123456', 'shift')).toBe('effect.effect_123456.shift');
    expect(createEffectProperty('hue-shift-1', 'amount')).toBe('effect.hue-shift-1.amount');
    expect(createEffectProperty('123', 'val')).toBe('effect.123.val');
  });

  it('roundtrip preserves identity for multiple properties', () => {
    const testCases = [
      { effectId: 'blur_1', paramName: 'radius' },
      { effectId: 'colorCorrect', paramName: 'temperature' },
      { effectId: 'fx-001', paramName: 'mix' },
      { effectId: 'effect_abc', paramName: 'intensity' },
    ];
    for (const tc of testCases) {
      const prop = createEffectProperty(tc.effectId, tc.paramName);
      const parsed = parseEffectProperty(prop);
      expect(parsed).toEqual(tc);
    }
  });

  it('created property matches expected EffectProperty template literal type', () => {
    const prop = createEffectProperty('id', 'param');
    // Verify it matches the `effect.${string}.${string}` pattern
    expect(prop).toMatch(/^effect\..+\..+$/);
  });

  it('with empty effectId and paramName', () => {
    const prop = createEffectProperty('', '');
    expect(prop).toBe('effect..');
    // Parsing this should return empty strings
    const parsed = parseEffectProperty(prop);
    expect(parsed).toEqual({ effectId: '', paramName: '' });
  });
});

// ─── isAudioEffect ────────────────────────────────────────────────────────

describe('isAudioEffect', () => {
  it('audio-eq → true', () => {
    expect(isAudioEffect('audio-eq')).toBe(true);
  });

  it('audio-volume → true', () => {
    expect(isAudioEffect('audio-volume')).toBe(true);
  });

  it('visual effects → false', () => {
    const visualEffects: EffectType[] = [
      'hue-shift',
      'saturation',
      'brightness',
      'contrast',
      'blur',
      'pixelate',
      'kaleidoscope',
      'mirror',
      'invert',
      'rgb-split',
      'levels',
    ];
    for (const effect of visualEffects) {
      expect(isAudioEffect(effect)).toBe(false);
    }
  });

  it('every EffectType is categorized as either audio or visual', () => {
    const allEffects: EffectType[] = [
      'hue-shift', 'saturation', 'brightness', 'contrast',
      'blur', 'pixelate', 'kaleidoscope', 'mirror',
      'invert', 'rgb-split', 'levels',
      'audio-eq', 'audio-volume',
    ];
    const audioEffects = allEffects.filter(e => isAudioEffect(e));
    const visualEffects = allEffects.filter(e => !isAudioEffect(e));
    // Audio effects should be exactly the two known ones
    expect(audioEffects).toEqual(['audio-eq', 'audio-volume']);
    // Visual effects should be the remaining 11
    expect(visualEffects).toHaveLength(11);
    // Together they cover all
    expect(audioEffects.length + visualEffects.length).toBe(allEffects.length);
  });
});
