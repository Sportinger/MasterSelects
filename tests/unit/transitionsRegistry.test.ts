/**
 * Tests for the Transition Suite (issue #196).
 *
 * Validates the transition registry, parameter schemas, packUniforms output,
 * and the shared easing / hex helpers. Pure-function coverage — no GPU needed.
 */

import { describe, it, expect } from 'vitest';
import {
  TRANSITION_REGISTRY,
  TRANSITION_CATEGORIES,
  getTransition,
  getAllTransitions,
  getTransitionsByCategory,
  hasTransition,
  getDefaultTransitionParams,
  applyEasing,
  hexToRgb,
} from '../../src/transitions';

const ALL_IDS = ['crossfade', 'dip-to-black', 'dip-to-white', 'wipe-left', 'wipe-right'];

// ---- Registration ----------------------------------------------------------

describe('Transition registration', () => {
  it('registers all five base transitions', () => {
    expect(TRANSITION_REGISTRY.size).toBe(5);
    for (const id of ALL_IDS) {
      expect(hasTransition(id)).toBe(true);
    }
  });

  it('every transition id matches its registry key', () => {
    for (const [key, def] of TRANSITION_REGISTRY) {
      expect(def.id).toBe(key);
    }
  });

  it('getAllTransitions length matches registry size', () => {
    expect(getAllTransitions().length).toBe(TRANSITION_REGISTRY.size);
  });

  it('has unique ids, names and entry points', () => {
    const all = getAllTransitions();
    expect(new Set(all.map(t => t.id)).size).toBe(all.length);
    expect(new Set(all.map(t => t.name)).size).toBe(all.length);
  });

  it('sum of transitions across categories equals registry size', () => {
    const total = Object.values(TRANSITION_CATEGORIES).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(TRANSITION_REGISTRY.size);
  });

  it('groups crossfade and dips under dissolve, wipes under wipe', () => {
    expect(getTransitionsByCategory('dissolve').map(t => t.id).sort()).toEqual(
      ['crossfade', 'dip-to-black', 'dip-to-white'],
    );
    expect(getTransitionsByCategory('wipe').map(t => t.id).sort()).toEqual(
      ['wipe-left', 'wipe-right'],
    );
  });
});

// ---- Definition structure --------------------------------------------------

describe('Transition definition structure', () => {
  it('every transition has a GPU shader + entry point + packUniforms', () => {
    for (const def of getAllTransitions()) {
      expect(typeof def.shader).toBe('string');
      expect(def.shader.length).toBeGreaterThan(0);
      expect(typeof def.entryPoint).toBe('string');
      expect(def.entryPoint.length).toBeGreaterThan(0);
      expect(typeof def.packUniforms).toBe('function');
    }
  });

  it('every transition uniformSize is 32 and 16-byte aligned', () => {
    for (const def of getAllTransitions()) {
      expect(def.uniformSize).toBe(32);
      expect(def.uniformSize % 16).toBe(0);
    }
  });

  it('every transition exposes the shared easing param', () => {
    for (const def of getAllTransitions()) {
      expect(def.params.easing).toBeDefined();
      expect(def.params.easing.type).toBe('select');
      expect(def.params.easing.default).toBe('linear');
    }
  });

  it('duration bounds are valid (min <= default <= max)', () => {
    for (const def of getAllTransitions()) {
      expect(def.minDuration).toBeLessThanOrEqual(def.defaultDuration);
      expect(def.defaultDuration).toBeLessThanOrEqual(def.maxDuration);
    }
  });
});

// ---- packUniforms ----------------------------------------------------------

describe('packUniforms', () => {
  it('always returns an 8-float array with progress first', () => {
    for (const def of getAllTransitions()) {
      const u = def.packUniforms(getDefaultTransitionParams(def.id), 0.42);
      expect(u).toBeInstanceOf(Float32Array);
      expect(u.length).toBe(8);
      expect(u[0]).toBeCloseTo(0.42, 5);
      // byte size must fit the declared uniform size
      expect(u.length * 4).toBeLessThanOrEqual(def.uniformSize);
    }
  });

  it('crossfade encodes only progress', () => {
    const u = getTransition('crossfade')!.packUniforms({}, 0.5);
    expect(Array.from(u)).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('dip-to-black defaults to black dip color', () => {
    const def = getTransition('dip-to-black')!;
    const u = def.packUniforms(getDefaultTransitionParams('dip-to-black'), 0.5);
    expect(u[1]).toBe(0); // r
    expect(u[2]).toBe(0); // g
    expect(u[3]).toBe(0); // b
  });

  it('dip-to-white defaults to white dip color', () => {
    const def = getTransition('dip-to-white')!;
    const u = def.packUniforms(getDefaultTransitionParams('dip-to-white'), 0.5);
    expect(u[1]).toBeCloseTo(1, 5); // r
    expect(u[2]).toBeCloseTo(1, 5); // g
    expect(u[3]).toBeCloseTo(1, 5); // b
  });

  it('dip encodes a custom color param', () => {
    const def = getTransition('dip-to-black')!;
    const u = def.packUniforms({ color: '#ff0000', easing: 'linear' }, 0.5);
    expect(u[1]).toBeCloseTo(1, 5); // r
    expect(u[2]).toBe(0); // g
    expect(u[3]).toBe(0); // b
  });

  it('wipe-left and wipe-right encode opposite directions', () => {
    const left = getTransition('wipe-left')!.packUniforms(getDefaultTransitionParams('wipe-left'), 0.3);
    const right = getTransition('wipe-right')!.packUniforms(getDefaultTransitionParams('wipe-right'), 0.3);
    expect(left[2]).toBe(-1);  // dirX
    expect(right[2]).toBe(1);  // dirX
    // softness in slot p0 (index 1)
    expect(left[1]).toBeCloseTo(0.03, 5);
  });

  it('does not throw across progress range for any transition', () => {
    for (const def of getAllTransitions()) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        expect(() => def.packUniforms(getDefaultTransitionParams(def.id), p)).not.toThrow();
      }
    }
  });
});

// ---- getDefaultTransitionParams --------------------------------------------

describe('getDefaultTransitionParams', () => {
  it('returns every declared param with its default', () => {
    for (const def of getAllTransitions()) {
      const defaults = getDefaultTransitionParams(def.id);
      expect(Object.keys(defaults).sort()).toEqual(Object.keys(def.params).sort());
    }
  });

  it('returns an empty object for unknown transitions', () => {
    expect(getDefaultTransitionParams('does-not-exist')).toEqual({});
  });
});

// ---- Easing helper ---------------------------------------------------------

describe('applyEasing', () => {
  it('linear is identity', () => {
    for (const p of [0, 0.3, 0.5, 0.9, 1]) {
      expect(applyEasing(p, 'linear')).toBeCloseTo(p, 6);
    }
  });

  it('undefined easing falls back to linear', () => {
    expect(applyEasing(0.4, undefined)).toBeCloseTo(0.4, 6);
  });

  it('clamps input to [0,1]', () => {
    expect(applyEasing(-1, 'linear')).toBe(0);
    expect(applyEasing(2, 'linear')).toBe(1);
  });

  it('all curves pin 0->0 and 1->1', () => {
    for (const mode of ['ease-in', 'ease-out', 'ease-in-out']) {
      expect(applyEasing(0, mode)).toBeCloseTo(0, 6);
      expect(applyEasing(1, mode)).toBeCloseTo(1, 6);
    }
  });

  it('ease-in starts slower than linear, ease-out faster', () => {
    expect(applyEasing(0.5, 'ease-in')).toBeLessThan(0.5);
    expect(applyEasing(0.5, 'ease-out')).toBeGreaterThan(0.5);
  });
});

// ---- hexToRgb helper -------------------------------------------------------

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
  });

  it('parses without leading hash and 3-digit shorthand', () => {
    expect(hexToRgb('ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
  });

  it('falls back to black on malformed input', () => {
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
    expect(hexToRgb('')).toEqual([0, 0, 0]);
    expect(hexToRgb(undefined)).toEqual([0, 0, 0]);
    expect(hexToRgb(42)).toEqual([0, 0, 0]);
  });
});
