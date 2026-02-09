import { describe, it, expect } from 'vitest';
import {
  isEffectProperty,
  parseEffectProperty,
  createEffectProperty,
} from '../../src/types/index';
import type { EffectProperty } from '../../src/types/index';

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
});
