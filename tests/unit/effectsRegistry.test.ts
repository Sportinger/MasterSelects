/**
 * Tests for the Effects Registry system.
 *
 * Imports directly from src/effects/index.ts and validates that all effects
 * are properly registered with correct structure and parameter definitions.
 */

import { describe, it, expect } from 'vitest';
import {
  EFFECT_REGISTRY,
  EFFECT_CATEGORIES,
  getEffect,
  getDefaultParams,
  getAllEffects,
  getEffectsByCategory,
  getCategoriesWithEffects,
  hasEffect,
  getEffectConfig,
} from '../../src/effects/index';
import { CATEGORY_INFO } from '../../src/effects/types';
import type { EffectDefinition, EffectCategory, EffectParam } from '../../src/effects/types';

// ---- Category registration -------------------------------------------------

describe('Effect category registration', () => {
  const expectedPopulatedCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'keying'];
  const expectedEmptyCategories: EffectCategory[] = ['generate', 'time', 'transition'];

  it('should have all eight categories defined', () => {
    const allCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'generate', 'keying', 'time', 'transition'];
    for (const cat of allCategories) {
      expect(EFFECT_CATEGORIES).toHaveProperty(cat);
      expect(Array.isArray(EFFECT_CATEGORIES[cat])).toBe(true);
    }
  });

  it('should have effects registered in populated categories', () => {
    for (const cat of expectedPopulatedCategories) {
      expect(EFFECT_CATEGORIES[cat].length).toBeGreaterThan(0);
    }
  });

  it('should have empty arrays for categories with no effects yet', () => {
    for (const cat of expectedEmptyCategories) {
      expect(EFFECT_CATEGORIES[cat]).toHaveLength(0);
    }
  });

  it('getCategoriesWithEffects should only return non-empty categories', () => {
    const populated = getCategoriesWithEffects();
    const categoryNames = populated.map(c => c.category);

    for (const cat of expectedPopulatedCategories) {
      expect(categoryNames).toContain(cat);
    }
    for (const cat of expectedEmptyCategories) {
      expect(categoryNames).not.toContain(cat);
    }
  });

  it('getCategoriesWithEffects should return objects with category and effects array', () => {
    const populated = getCategoriesWithEffects();
    for (const entry of populated) {
      expect(typeof entry.category).toBe('string');
      expect(Array.isArray(entry.effects)).toBe(true);
      expect(entry.effects.length).toBeGreaterThan(0);
      // Every effect in the entry should belong to that category
      for (const effect of entry.effects) {
        expect(effect.category).toBe(entry.category);
      }
    }
  });

  it('getEffectsByCategory should return effects for a given category', () => {
    const colorEffects = getEffectsByCategory('color');
    expect(colorEffects.length).toBeGreaterThan(0);
    for (const effect of colorEffects) {
      expect(effect.category).toBe('color');
    }
  });

  it('getEffectsByCategory should return empty array for empty category', () => {
    const timeEffects = getEffectsByCategory('time');
    expect(timeEffects).toHaveLength(0);
  });

  it('getEffectsByCategory should return effects for every populated category', () => {
    for (const cat of expectedPopulatedCategories) {
      const effects = getEffectsByCategory(cat);
      expect(effects.length).toBeGreaterThan(0);
      for (const effect of effects) {
        expect(effect.category).toBe(cat);
      }
    }
  });

  it('sum of effects across all categories should equal total registry size', () => {
    const allCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'generate', 'keying', 'time', 'transition'];
    let totalFromCategories = 0;
    for (const cat of allCategories) {
      totalFromCategories += EFFECT_CATEGORIES[cat].length;
    }
    expect(totalFromCategories).toBe(EFFECT_REGISTRY.size);
  });
});

// ---- CATEGORY_INFO metadata ------------------------------------------------

describe('CATEGORY_INFO metadata', () => {
  it('should have entries for all eight categories', () => {
    const allCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'generate', 'keying', 'time', 'transition'];
    const infoIds = CATEGORY_INFO.map(c => c.id);
    for (const cat of allCategories) {
      expect(infoIds).toContain(cat);
    }
  });

  it('every CATEGORY_INFO entry should have id and name', () => {
    for (const info of CATEGORY_INFO) {
      expect(typeof info.id).toBe('string');
      expect(info.id.length).toBeGreaterThan(0);
      expect(typeof info.name).toBe('string');
      expect(info.name.length).toBeGreaterThan(0);
    }
  });

  it('CATEGORY_INFO ids should match EFFECT_CATEGORIES keys', () => {
    const categoryKeys = Object.keys(EFFECT_CATEGORIES);
    const infoIds = CATEGORY_INFO.map(c => c.id);
    for (const key of categoryKeys) {
      expect(infoIds).toContain(key);
    }
  });

  it('should have no duplicate CATEGORY_INFO ids', () => {
    const ids = CATEGORY_INFO.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---- Expected effects per category -----------------------------------------

describe('Expected effects per category', () => {
  const expectedColorEffects = [
    'brightness', 'contrast', 'saturation', 'hue-shift',
    'levels', 'invert', 'vibrance', 'temperature', 'exposure',
  ];

  const expectedBlurEffects = [
    'gaussian-blur', 'box-blur', 'radial-blur', 'zoom-blur', 'motion-blur',
  ];

  const expectedDistortEffects = [
    'pixelate', 'kaleidoscope', 'mirror', 'rgb-split', 'twirl', 'wave', 'bulge',
  ];

  const expectedStylizeEffects = [
    'vignette', 'grain', 'sharpen', 'posterize', 'glow', 'edge-detect', 'scanlines', 'threshold',
  ];

  it('should register all color effects', () => {
    for (const id of expectedColorEffects) {
      expect(hasEffect(id)).toBe(true);
    }
  });

  it('should register all blur effects', () => {
    for (const id of expectedBlurEffects) {
      expect(hasEffect(id)).toBe(true);
    }
  });

  it('should register all distort effects', () => {
    for (const id of expectedDistortEffects) {
      expect(hasEffect(id)).toBe(true);
    }
  });

  it('should register all stylize effects', () => {
    for (const id of expectedStylizeEffects) {
      expect(hasEffect(id)).toBe(true);
    }
  });

  it('should register chroma-key in keying category', () => {
    expect(hasEffect('chroma-key')).toBe(true);
    const chromaKey = getEffect('chroma-key')!;
    expect(chromaKey.category).toBe('keying');
  });

  it('color effects should be in the color category', () => {
    for (const id of expectedColorEffects) {
      const effect = getEffect(id)!;
      expect(effect.category).toBe('color');
    }
  });

  it('blur effects should be in the blur category', () => {
    for (const id of expectedBlurEffects) {
      const effect = getEffect(id)!;
      expect(effect.category).toBe('blur');
    }
  });

  it('distort effects should be in the distort category', () => {
    for (const id of expectedDistortEffects) {
      const effect = getEffect(id)!;
      expect(effect.category).toBe('distort');
    }
  });

  it('stylize effects should be in the stylize category', () => {
    for (const id of expectedStylizeEffects) {
      const effect = getEffect(id)!;
      expect(effect.category).toBe('stylize');
    }
  });

  it('should have at least 30 effects total', () => {
    expect(getAllEffects().length).toBeGreaterThanOrEqual(30);
  });

  it('expected effect counts per category should match', () => {
    expect(getEffectsByCategory('color').length).toBe(expectedColorEffects.length);
    expect(getEffectsByCategory('blur').length).toBe(expectedBlurEffects.length);
    expect(getEffectsByCategory('distort').length).toBe(expectedDistortEffects.length);
    expect(getEffectsByCategory('stylize').length).toBe(expectedStylizeEffects.length);
    expect(getEffectsByCategory('keying').length).toBe(1);
  });
});

// ---- Effect structure validation -------------------------------------------

describe('Effect required properties', () => {
  it('every effect should have id, name, category, shader, entryPoint, params, packUniforms', () => {
    const allEffects = getAllEffects();
    expect(allEffects.length).toBeGreaterThan(0);

    for (const effect of allEffects) {
      expect(typeof effect.id).toBe('string');
      expect(effect.id.length).toBeGreaterThan(0);

      expect(typeof effect.name).toBe('string');
      expect(effect.name.length).toBeGreaterThan(0);

      expect(typeof effect.category).toBe('string');

      expect(typeof effect.shader).toBe('string');
      expect(effect.shader.length).toBeGreaterThan(0);

      expect(typeof effect.entryPoint).toBe('string');
      expect(effect.entryPoint.length).toBeGreaterThan(0);

      expect(typeof effect.params).toBe('object');
      expect(effect.params).not.toBeNull();

      expect(typeof effect.packUniforms).toBe('function');
    }
  });

  it('every effect should have a non-negative uniformSize', () => {
    for (const effect of getAllEffects()) {
      expect(typeof effect.uniformSize).toBe('number');
      expect(effect.uniformSize).toBeGreaterThanOrEqual(0);
    }
  });

  it('every effect uniformSize should be 16-byte aligned', () => {
    for (const effect of getAllEffects()) {
      expect(effect.uniformSize % 16).toBe(0);
    }
  });

  it('every effect category should be a valid EffectCategory', () => {
    const validCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'generate', 'keying', 'time', 'transition'];
    for (const effect of getAllEffects()) {
      expect(validCategories).toContain(effect.category);
    }
  });

  it('every effect id should match its key in the EFFECT_REGISTRY', () => {
    for (const [key, effect] of EFFECT_REGISTRY) {
      expect(effect.id).toBe(key);
    }
  });

  it('effects with uniformSize 0 should have packUniforms returning null', () => {
    for (const effect of getAllEffects()) {
      if (effect.uniformSize === 0) {
        const defaults = getDefaultParams(effect.id);
        const result = effect.packUniforms(defaults, 1920, 1080);
        expect(result).toBeNull();
      }
    }
  });

  it('effects with uniformSize > 0 should have packUniforms returning Float32Array', () => {
    for (const effect of getAllEffects()) {
      if (effect.uniformSize > 0) {
        const defaults = getDefaultParams(effect.id);
        const result = effect.packUniforms(defaults, 1920, 1080);
        expect(result).toBeInstanceOf(Float32Array);
      }
    }
  });

  it('invert effect should have uniformSize 0 and no params', () => {
    const invert = getEffect('invert')!;
    expect(invert).toBeDefined();
    expect(invert.uniformSize).toBe(0);
    expect(Object.keys(invert.params)).toHaveLength(0);
  });
});

// ---- No duplicate effect IDs -----------------------------------------------

describe('No duplicate effect IDs', () => {
  it('should have unique IDs across all effects', () => {
    const allEffects = getAllEffects();
    const ids = allEffects.map(e => e.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('registry size should match getAllEffects length', () => {
    expect(EFFECT_REGISTRY.size).toBe(getAllEffects().length);
  });

  it('should have unique entry points across all effects', () => {
    const allEffects = getAllEffects();
    const entryPoints = allEffects.map(e => e.entryPoint);
    const uniqueEntryPoints = new Set(entryPoints);
    expect(uniqueEntryPoints.size).toBe(entryPoints.length);
  });

  it('should have unique display names across all effects', () => {
    const allEffects = getAllEffects();
    const names = allEffects.map(e => e.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ---- Parameter validation --------------------------------------------------

describe('Effect parameter validation', () => {
  it('every parameter should have type, label, and default', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        expect(typeof param.type).toBe('string');
        expect(['number', 'boolean', 'select', 'color', 'point']).toContain(param.type);

        expect(typeof param.label).toBe('string');
        expect(param.label.length).toBeGreaterThan(0);

        expect(param.default).toBeDefined();
      }
    }
  });

  it('number parameters should have min, max, step with min <= default <= max', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'number') continue;

        expect(typeof param.min).toBe('number');
        expect(typeof param.max).toBe('number');
        expect(typeof param.step).toBe('number');

        expect(param.min!).toBeLessThanOrEqual(param.max!);
        expect(param.default as number).toBeGreaterThanOrEqual(param.min!);
        expect(param.default as number).toBeLessThanOrEqual(param.max!);
        expect(param.step!).toBeGreaterThan(0);
      }
    }
  });

  it('number parameters should have numeric default', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'number') continue;
        expect(typeof param.default).toBe('number');
      }
    }
  });

  it('select parameters should have options array with value and label', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'select') continue;

        expect(Array.isArray(param.options)).toBe(true);
        expect(param.options!.length).toBeGreaterThan(0);

        for (const option of param.options!) {
          expect(typeof option.value).toBe('string');
          expect(typeof option.label).toBe('string');
        }

        // Default should be one of the option values
        const optionValues = param.options!.map(o => o.value);
        expect(optionValues).toContain(param.default);
      }
    }
  });

  it('select parameters should have unique option values', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'select') continue;
        const values = param.options!.map(o => o.value);
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  it('boolean parameters should have boolean default', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'boolean') continue;
        expect(typeof param.default).toBe('boolean');
      }
    }
  });
});

// ---- Animatable parameter validation ----------------------------------------

describe('Animatable parameter properties', () => {
  it('every number param should have an animatable property defined', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.type !== 'number') continue;
        expect(typeof param.animatable).toBe('boolean');
      }
    }
  });

  it('quality parameters should not be animatable', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.quality === true) {
          expect(param.animatable).toBe(false);
        }
      }
    }
  });

  it('at least some effects should have animatable params', () => {
    let animatableCount = 0;
    for (const effect of getAllEffects()) {
      for (const param of Object.values(effect.params)) {
        if (param.animatable === true) animatableCount++;
      }
    }
    expect(animatableCount).toBeGreaterThan(0);
  });

  it('brightness amount should be animatable', () => {
    const brightness = getEffect('brightness')!;
    expect(brightness.params.amount.animatable).toBe(true);
  });
});

// ---- Quality parameter validation -------------------------------------------

describe('Quality parameter properties', () => {
  it('quality parameters should only exist on number-type params', () => {
    for (const effect of getAllEffects()) {
      for (const [paramKey, param] of Object.entries(effect.params)) {
        if (param.quality === true) {
          expect(param.type).toBe('number');
        }
      }
    }
  });

  it('quality parameters should exist on multi-sample blur effects', () => {
    const blurEffectsWithQuality = ['gaussian-blur', 'radial-blur', 'zoom-blur', 'motion-blur'];
    for (const id of blurEffectsWithQuality) {
      const effect = getEffect(id)!;
      const qualityParams = Object.values(effect.params).filter(p => p.quality === true);
      expect(qualityParams.length).toBeGreaterThan(0);
    }
  });

  it('glow effect should have quality parameters (rings, samplesPerRing)', () => {
    const glow = getEffect('glow')!;
    expect(glow.params.rings.quality).toBe(true);
    expect(glow.params.samplesPerRing.quality).toBe(true);
  });

  it('gaussian-blur samples should be a quality parameter', () => {
    const gb = getEffect('gaussian-blur')!;
    expect(gb.params.samples.quality).toBe(true);
    expect(gb.params.samples.animatable).toBe(false);
  });

  it('effects without multi-sample logic should not have quality params', () => {
    const simpleEffects = ['brightness', 'contrast', 'saturation', 'invert', 'pixelate', 'mirror'];
    for (const id of simpleEffects) {
      const effect = getEffect(id)!;
      const qualityParams = Object.values(effect.params).filter(p => p.quality === true);
      expect(qualityParams.length).toBe(0);
    }
  });
});

// ---- Helper functions ------------------------------------------------------

describe('Registry helper functions', () => {
  it('getEffect should return a valid definition for known effect', () => {
    const effect = getEffect('brightness');
    expect(effect).toBeDefined();
    expect(effect!.id).toBe('brightness');
    expect(effect!.name).toBe('Brightness');
    expect(effect!.category).toBe('color');
  });

  it('getEffect should return undefined for unknown effect', () => {
    expect(getEffect('nonexistent-effect')).toBeUndefined();
  });

  it('getEffect should return the same reference as EFFECT_REGISTRY.get', () => {
    for (const [id, effect] of EFFECT_REGISTRY) {
      expect(getEffect(id)).toBe(effect);
    }
  });

  it('hasEffect should return true for registered effects', () => {
    expect(hasEffect('gaussian-blur')).toBe(true);
    expect(hasEffect('brightness')).toBe(true);
    expect(hasEffect('chroma-key')).toBe(true);
  });

  it('hasEffect should return false for unregistered effects', () => {
    expect(hasEffect('fake-effect')).toBe(false);
    expect(hasEffect('')).toBe(false);
  });

  it('hasEffect should return true for every effect in getAllEffects', () => {
    for (const effect of getAllEffects()) {
      expect(hasEffect(effect.id)).toBe(true);
    }
  });

  it('getDefaultParams should return correct defaults', () => {
    const defaults = getDefaultParams('brightness');
    expect(defaults).toHaveProperty('amount');
    expect(defaults.amount).toBe(0);
  });

  it('getDefaultParams should return empty object for unknown effect', () => {
    const defaults = getDefaultParams('nonexistent');
    expect(defaults).toEqual({});
  });

  it('getDefaultParams should return all params for multi-param effects', () => {
    const levelsDefaults = getDefaultParams('levels');
    expect(levelsDefaults).toHaveProperty('inputBlack');
    expect(levelsDefaults).toHaveProperty('inputWhite');
    expect(levelsDefaults).toHaveProperty('gamma');
    expect(levelsDefaults).toHaveProperty('outputBlack');
    expect(levelsDefaults).toHaveProperty('outputWhite');
    expect(levelsDefaults.inputBlack).toBe(0);
    expect(levelsDefaults.inputWhite).toBe(1);
    expect(levelsDefaults.gamma).toBe(1);
  });

  it('getDefaultParams should return correct defaults for chroma-key (select param)', () => {
    const defaults = getDefaultParams('chroma-key');
    expect(defaults).toHaveProperty('keyColor');
    expect(defaults.keyColor).toBe('green');
    expect(defaults).toHaveProperty('tolerance');
    expect(defaults.tolerance).toBe(0.2);
    expect(defaults).toHaveProperty('softness');
    expect(defaults).toHaveProperty('spillSuppression');
  });

  it('getDefaultParams should return correct defaults for mirror (boolean params)', () => {
    const defaults = getDefaultParams('mirror');
    expect(defaults.horizontal).toBe(true);
    expect(defaults.vertical).toBe(false);
  });

  it('getDefaultParams key count should match effect params count', () => {
    for (const effect of getAllEffects()) {
      const defaults = getDefaultParams(effect.id);
      const paramCount = Object.keys(effect.params).length;
      expect(Object.keys(defaults).length).toBe(paramCount);
    }
  });

  it('getDefaultParams should return empty object for invert (no params)', () => {
    const defaults = getDefaultParams('invert');
    expect(defaults).toEqual({});
  });

  it('getEffectConfig should return pipeline config for known effects', () => {
    const config = getEffectConfig('gaussian-blur');
    expect(config).toBeDefined();
    expect(config!.entryPoint).toBe('gaussianBlurFragment');
    expect(config!.uniformSize).toBe(16);
    expect(config!.needsUniform).toBe(true);
  });

  it('getEffectConfig should return undefined for unknown effects', () => {
    expect(getEffectConfig('nonexistent')).toBeUndefined();
  });

  it('getEffectConfig needsUniform should be false when uniformSize is 0', () => {
    const config = getEffectConfig('invert');
    expect(config).toBeDefined();
    expect(config!.needsUniform).toBe(false);
    expect(config!.uniformSize).toBe(0);
  });

  it('getEffectConfig needsUniform should be true when uniformSize > 0', () => {
    const effectsWithUniforms = ['brightness', 'gaussian-blur', 'vignette', 'chroma-key'];
    for (const id of effectsWithUniforms) {
      const config = getEffectConfig(id);
      expect(config).toBeDefined();
      expect(config!.needsUniform).toBe(true);
      expect(config!.uniformSize).toBeGreaterThan(0);
    }
  });

  it('getEffectConfig entryPoint should match the effect definition', () => {
    for (const effect of getAllEffects()) {
      const config = getEffectConfig(effect.id);
      expect(config).toBeDefined();
      expect(config!.entryPoint).toBe(effect.entryPoint);
      expect(config!.uniformSize).toBe(effect.uniformSize);
    }
  });
});

// ---- packUniforms ----------------------------------------------------------

describe('packUniforms function', () => {
  it('should return Float32Array for brightness with default params', () => {
    const effect = getEffect('brightness')!;
    const defaults = getDefaultParams('brightness');
    const uniforms = effect.packUniforms(defaults, 1920, 1080);

    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms!.length).toBeGreaterThan(0);
  });

  it('should return Float32Array for gaussian-blur with custom params', () => {
    const effect = getEffect('gaussian-blur')!;
    const uniforms = effect.packUniforms({ radius: 20, samples: 10 }, 1920, 1080);

    expect(uniforms).toBeInstanceOf(Float32Array);
    // First element should be the radius value
    expect(uniforms![0]).toBe(20);
  });

  it('every effect packUniforms should not throw with default params', () => {
    for (const effect of getAllEffects()) {
      const defaults = getDefaultParams(effect.id);
      expect(() => {
        effect.packUniforms(defaults, 1920, 1080);
      }).not.toThrow();
    }
  });

  it('every effect packUniforms should return Float32Array or null', () => {
    for (const effect of getAllEffects()) {
      const defaults = getDefaultParams(effect.id);
      const result = effect.packUniforms(defaults, 1920, 1080);
      expect(result === null || result instanceof Float32Array).toBe(true);
    }
  });

  it('packUniforms Float32Array byte size should not exceed uniformSize', () => {
    for (const effect of getAllEffects()) {
      const defaults = getDefaultParams(effect.id);
      const result = effect.packUniforms(defaults, 1920, 1080);
      if (result !== null) {
        // Float32Array: each element is 4 bytes
        const byteSize = result.length * 4;
        expect(byteSize).toBeLessThanOrEqual(effect.uniformSize);
      }
    }
  });

  it('invert packUniforms should return null', () => {
    const invert = getEffect('invert')!;
    const result = invert.packUniforms({}, 1920, 1080);
    expect(result).toBeNull();
  });

  it('brightness packUniforms should encode amount as first float', () => {
    const effect = getEffect('brightness')!;
    const uniforms = effect.packUniforms({ amount: 0.5 }, 1920, 1080);
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![0]).toBe(0.5);
  });

  it('chroma-key packUniforms should encode green screen correctly', () => {
    const effect = getEffect('chroma-key')!;
    const uniforms = effect.packUniforms(
      { keyColor: 'green', tolerance: 0.2, softness: 0.1, spillSuppression: 0.5 },
      1920, 1080,
    );
    expect(uniforms).toBeInstanceOf(Float32Array);
    // Green: R=0, G=1, B=0
    expect(uniforms![0]).toBe(0); // keyR
    expect(uniforms![1]).toBe(1); // keyG
    expect(uniforms![2]).toBe(0); // keyB
    expect(uniforms![3]).toBeCloseTo(0.2, 5); // tolerance (Float32 precision)
  });

  it('chroma-key packUniforms should encode blue screen correctly', () => {
    const effect = getEffect('chroma-key')!;
    const uniforms = effect.packUniforms(
      { keyColor: 'blue', tolerance: 0.3, softness: 0.15, spillSuppression: 0.6 },
      1920, 1080,
    );
    expect(uniforms).toBeInstanceOf(Float32Array);
    // Blue: R=0, G=0, B=1
    expect(uniforms![0]).toBe(0); // keyR
    expect(uniforms![1]).toBe(0); // keyG
    expect(uniforms![2]).toBe(1); // keyB
  });

  it('mirror packUniforms should encode boolean params as 0/1 floats', () => {
    const effect = getEffect('mirror')!;
    const uniforms = effect.packUniforms({ horizontal: true, vertical: false }, 1920, 1080);
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![0]).toBe(1); // horizontal = true
    expect(uniforms![1]).toBe(0); // vertical = false
  });

  it('packUniforms should not throw with different resolutions', () => {
    const resolutions = [
      [640, 480],
      [1280, 720],
      [1920, 1080],
      [3840, 2160],
      [1, 1],
    ];

    for (const effect of getAllEffects()) {
      const defaults = getDefaultParams(effect.id);
      for (const [w, h] of resolutions) {
        expect(() => {
          effect.packUniforms(defaults, w, h);
        }).not.toThrow();
      }
    }
  });

  it('gaussian-blur packUniforms should include width and height', () => {
    const effect = getEffect('gaussian-blur')!;
    const uniforms = effect.packUniforms({ radius: 10, samples: 5 }, 1920, 1080);
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![1]).toBe(1920); // width
    expect(uniforms![2]).toBe(1080); // height
  });

  it('vignette packUniforms should encode all four parameters', () => {
    const effect = getEffect('vignette')!;
    const uniforms = effect.packUniforms(
      { amount: 0.5, size: 0.5, softness: 0.5, roundness: 1 },
      1920, 1080,
    );
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![0]).toBe(0.5); // amount
    expect(uniforms![1]).toBe(0.5); // size
    expect(uniforms![2]).toBe(0.5); // softness
    expect(uniforms![3]).toBe(1);   // roundness
  });

  it('twirl packUniforms should encode amount, radius, centerX, centerY', () => {
    const effect = getEffect('twirl')!;
    const uniforms = effect.packUniforms(
      { amount: 2, radius: 0.8, centerX: 0.3, centerY: 0.7 },
      1920, 1080,
    );
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![0]).toBeCloseTo(2, 5);   // amount
    expect(uniforms![1]).toBeCloseTo(0.8, 5); // radius (Float32 precision)
    expect(uniforms![2]).toBeCloseTo(0.3, 5); // centerX
    expect(uniforms![3]).toBeCloseTo(0.7, 5); // centerY
  });

  it('levels packUniforms should encode all five parameters', () => {
    const effect = getEffect('levels')!;
    const uniforms = effect.packUniforms(
      { inputBlack: 0.1, inputWhite: 0.9, gamma: 1.5, outputBlack: 0, outputWhite: 1 },
      1920, 1080,
    );
    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms![0]).toBeCloseTo(0.1);
    expect(uniforms![1]).toBeCloseTo(0.9);
    expect(uniforms![2]).toBeCloseTo(1.5);
    expect(uniforms![3]).toBeCloseTo(0);
    expect(uniforms![4]).toBeCloseTo(1);
  });
});

// ---- Cross-validation: EFFECT_CATEGORIES vs EFFECT_REGISTRY -----------------

describe('Cross-validation between EFFECT_CATEGORIES and EFFECT_REGISTRY', () => {
  it('every effect in EFFECT_CATEGORIES should exist in EFFECT_REGISTRY', () => {
    const allCategories: EffectCategory[] = ['color', 'blur', 'distort', 'stylize', 'generate', 'keying', 'time', 'transition'];
    for (const cat of allCategories) {
      for (const effect of EFFECT_CATEGORIES[cat]) {
        expect(EFFECT_REGISTRY.has(effect.id)).toBe(true);
      }
    }
  });

  it('every effect in EFFECT_REGISTRY should appear in its category array', () => {
    for (const [id, effect] of EFFECT_REGISTRY) {
      const categoryEffects = EFFECT_CATEGORIES[effect.category];
      expect(categoryEffects).toBeDefined();
      const found = categoryEffects.find(e => e.id === id);
      expect(found).toBeDefined();
    }
  });

  it('EFFECT_REGISTRY reference should be the same object as in EFFECT_CATEGORIES', () => {
    for (const [id, effect] of EFFECT_REGISTRY) {
      const categoryEffect = EFFECT_CATEGORIES[effect.category].find(e => e.id === id);
      expect(categoryEffect).toBe(effect); // same reference
    }
  });
});

// ---- Specific effect detail tests -------------------------------------------

describe('Specific effect definitions', () => {
  it('chroma-key should have select param with green, blue, custom options', () => {
    const chromaKey = getEffect('chroma-key')!;
    expect(chromaKey.params.keyColor.type).toBe('select');
    const options = chromaKey.params.keyColor.options!;
    expect(options).toHaveLength(3);
    const values = options.map(o => o.value);
    expect(values).toContain('green');
    expect(values).toContain('blue');
    expect(values).toContain('custom');
  });

  it('mirror should have two boolean params', () => {
    const mirror = getEffect('mirror')!;
    expect(mirror.params.horizontal.type).toBe('boolean');
    expect(mirror.params.vertical.type).toBe('boolean');
    expect(mirror.params.horizontal.default).toBe(true);
    expect(mirror.params.vertical.default).toBe(false);
  });

  it('glow should have 6 parameters with correct types', () => {
    const glow = getEffect('glow')!;
    expect(Object.keys(glow.params)).toHaveLength(6);
    expect(glow.params.amount.type).toBe('number');
    expect(glow.params.threshold.type).toBe('number');
    expect(glow.params.radius.type).toBe('number');
    expect(glow.params.softness.type).toBe('number');
    expect(glow.params.rings.type).toBe('number');
    expect(glow.params.samplesPerRing.type).toBe('number');
  });

  it('gaussian-blur uniformSize should be 16 bytes', () => {
    const gb = getEffect('gaussian-blur')!;
    expect(gb.uniformSize).toBe(16);
  });

  it('chroma-key uniformSize should be 32 bytes', () => {
    const ck = getEffect('chroma-key')!;
    expect(ck.uniformSize).toBe(32);
  });

  it('glow uniformSize should be 32 bytes', () => {
    const glow = getEffect('glow')!;
    expect(glow.uniformSize).toBe(32);
  });

  it('levels uniformSize should be 32 bytes', () => {
    const levels = getEffect('levels')!;
    expect(levels.uniformSize).toBe(32);
  });
});
