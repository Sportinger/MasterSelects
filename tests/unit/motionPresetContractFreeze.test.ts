import { describe, expect, it } from 'vitest';
import {
  MOTION_PRESET_CODEC_ERROR_CODES,
  MOTION_PRESET_FORMAT,
  MOTION_PRESET_VERSION,
  type MotionPresetEnvelopeV1,
} from '../../src/services/motionDesign/presets/contracts';
import {
  decodeMotionPresetEnvelope,
  encodeMotionPresetEnvelope,
} from '../../src/services/motionDesign/presets/codec';
import {
  MOTION_JSON_BUDGETS,
  cloneMotionJsonValue,
  inspectMotionJsonSafety,
} from '../../src/services/motionDesign/presets/jsonSafety';

function createAdversarialArray<T>(
  values: readonly T[],
  counter: { calls: number },
): readonly T[] {
  class AdversarialArray extends Array<T> {}
  const fail = (): never => {
    counter.calls += 1;
    throw new Error('Adversarial array method must not execute.');
  };
  Object.defineProperties(AdversarialArray.prototype, {
    [Symbol.iterator]: { configurable: true, value: fail },
    map: { configurable: true, value: fail },
    find: { configurable: true, value: fail },
    forEach: { configurable: true, value: fail },
  });
  const array = new AdversarialArray<T>();
  for (let index = 0; index < values.length; index += 1) {
    Array.prototype.push.call(array, values[index]);
  }
  return array;
}

function createPreset(): MotionPresetEnvelopeV1 {
  return {
    format: MOTION_PRESET_FORMAT,
    version: MOTION_PRESET_VERSION,
    scope: 'project-local',
    presetId: 'preset-brand-plate',
    name: 'Brand Plate',
    kind: 'appearance',
    payload: {
      fill: { color: '#2244ff', opacity: 0.9 },
      stroke: { width: 4 },
    },
    dependencies: [{
      id: 'font-brand',
      kind: 'font',
      sourceProjectId: 'project-font-inter',
      label: 'Inter',
    }],
  };
}

describe('MD8 project-local preset contract freeze', () => {
  it('round-trips a versioned preset through its JSON codec', () => {
    const preset = createPreset();
    const encoded = encodeMotionPresetEnvelope(preset);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok || !encoded.json) return;

    const decoded = decodeMotionPresetEnvelope(encoded.json);
    expect(decoded).toEqual({ ok: true, envelope: preset });
    expect(JSON.parse(encoded.json)).toEqual(preset);
    expect(structuredClone(decoded)).toEqual(decoded);
  });

  it('rejects malformed JSON, unknown versions/kinds, and unknown envelope fields', () => {
    const preset = createPreset();
    const results = [
      decodeMotionPresetEnvelope('{'),
      decodeMotionPresetEnvelope({ ...preset, version: 2 }),
      decodeMotionPresetEnvelope({ ...preset, kind: 'script' }),
      decodeMotionPresetEnvelope({ ...preset, unexpectedField: {} }),
    ];
    expect(results.map((result) => result.ok ? 'ok' : result.failures[0]?.code)).toEqual([
      MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_JSON,
      MOTION_PRESET_CODEC_ERROR_CODES.UNKNOWN_VERSION,
      MOTION_PRESET_CODEC_ERROR_CODES.UNKNOWN_KIND,
      MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
    ]);
  });

  it('fails closed for duplicate dependency ids', () => {
    const preset = createPreset();
    const result = decodeMotionPresetEnvelope({
      ...preset,
      dependencies: [preset.dependencies[0], preset.dependencies[0]],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.DUPLICATE_DEPENDENCY);
    }
  });

  it.each([
    { label: 'non-finite', payload: { value: Number.POSITIVE_INFINITY } },
    { label: 'runtime handle', payload: { controller: new AbortController() } },
    { label: 'function', payload: { callback: () => 1 } },
    { label: 'embedded binary', payload: { image: 'data:image/png;base64,AAAA' } },
  ])('rejects $label payloads as non-JSON-safe', ({ payload }) => {
    const result = decodeMotionPresetEnvelope({ ...createPreset(), payload });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
    }
  });

  it('rejects cyclic payloads without throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => decodeMotionPresetEnvelope({ ...createPreset(), payload: cyclic })).not.toThrow();
    const result = decodeMotionPresetEnvelope({ ...createPreset(), payload: cyclic });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
  });

  it('rejects symbol fields, accessors, and sparse arrays that cannot round-trip as plain JSON', () => {
    const symbolPayload: Record<PropertyKey, unknown> = { visible: true };
    symbolPayload[Symbol('hidden')] = { runtime: true };
    const accessorPayload = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 42,
    });
    const sparse = new Array(2) as unknown[];
    sparse[1] = 'value';

    for (const payload of [symbolPayload, accessorPayload, { sparse }]) {
      const result = decodeMotionPresetEnvelope({ ...createPreset(), payload });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
    }
  });

  it('inspects the full preset envelope without executing top-level or dependency getters', () => {
    let getterCalls = 0;
    const topLevel = { ...createPreset() } as Record<string, unknown>;
    Object.defineProperty(topLevel, 'version', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return MOTION_PRESET_VERSION;
      },
    });
    const dependency = { ...createPreset().dependencies[0] } as Record<string, unknown>;
    Object.defineProperty(dependency, 'sourceProjectId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'must-not-run';
      },
    });
    const dependencyEnvelope = { ...createPreset(), dependencies: [dependency] };

    const topResult = decodeMotionPresetEnvelope(topLevel);
    const dependencyResult = decodeMotionPresetEnvelope(dependencyEnvelope);
    expect(getterCalls).toBe(0);
    expect(topResult.ok).toBe(false);
    expect(dependencyResult.ok).toBe(false);
    if (!topResult.ok && !dependencyResult.ok) {
      expect(topResult.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
      expect(dependencyResult.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
    }
  });

  it.each([
    ['runtimeHandle', 'runtime-id'],
    ['renderingContext', {}],
    ['gpuTexture', 'texture-id'],
    ['videoFrame', {}],
    ['decoder', 'decoder-id'],
    ['fileHandle', {}],
    ['localPath', 'C:/secret.mov'],
    ['objectUrl', 'blob:runtime-only'],
  ])('rejects deeply persisted runtime field %s', (field, runtimeValue) => {
    const result = decodeMotionPresetEnvelope({
      ...createPreset(),
      payload: { safe: { nested: { [field]: runtimeValue } } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
  });

  it('applies global string budgets to metadata outside the payload', () => {
    const result = decodeMotionPresetEnvelope({
      ...createPreset(),
      name: 'x'.repeat(65_537),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe(MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE);
  });

  it('enforces exact and over-limit global node budgets for wide arrays and objects', () => {
    const exactArray = Array.from({ length: MOTION_JSON_BUDGETS.maxNodes - 1 }, () => 0);
    const overArray = Array.from({ length: MOTION_JSON_BUDGETS.maxNodes }, () => 0);
    const exactObject = Object.fromEntries(Array.from(
      { length: MOTION_JSON_BUDGETS.maxNodes - 1 },
      (_, index) => [`key-${index}`, 0],
    ));
    const overObject = Object.fromEntries(Array.from(
      { length: MOTION_JSON_BUDGETS.maxNodes },
      (_, index) => [`key-${index}`, 0],
    ));

    expect(inspectMotionJsonSafety(exactArray).ok).toBe(true);
    expect(inspectMotionJsonSafety(exactObject).ok).toBe(true);
    for (const value of [overArray, overObject]) {
      const result = inspectMotionJsonSafety(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]?.code).toBe('MD8_JSON_BUDGET_EXCEEDED');
      }
    }
  });

  it('enforces exact and over-limit global depth budgets', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = null;
      for (let index = 0; index < depth; index += 1) value = { value };
      return value;
    };
    expect(inspectMotionJsonSafety(nested(MOTION_JSON_BUDGETS.maxDepth)).ok).toBe(true);
    const over = inspectMotionJsonSafety(nested(MOTION_JSON_BUDGETS.maxDepth + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.failures).toHaveLength(1);
      expect(over.failures[0]?.code).toBe('MD8_JSON_BUDGET_EXCEEDED');
    }
  });

  it('stops at the hard failure cap and never invokes getters during wide preflight', () => {
    const invalidValues = Array.from(
      { length: MOTION_JSON_BUDGETS.maxFailures + 10 },
      () => () => 1,
    );
    const invalid = inspectMotionJsonSafety(invalidValues);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.failures).toHaveLength(MOTION_JSON_BUDGETS.maxFailures);

    let getterCalls = 0;
    const wide = Object.fromEntries(Array.from(
      { length: MOTION_JSON_BUDGETS.maxNodes },
      (_, index) => [`key-${index}`, 0],
    ));
    Object.defineProperty(wide, 'runtimeHandle', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return {};
      },
    });
    const wideResult = inspectMotionJsonSafety(wide);
    expect(wideResult.ok).toBe(false);
    expect(getterCalls).toBe(0);
    if (!wideResult.ok) expect(wideResult.failures).toHaveLength(1);
  });

  it('rejects array subclasses before iterator, map, find, or forEach can execute', () => {
    const counter = { calls: 0 };
    const subclass = createAdversarialArray([1, 2, 3], counter);
    expect(inspectMotionJsonSafety(subclass).ok).toBe(false);
    expect(decodeMotionPresetEnvelope({
      ...createPreset(),
      payload: { values: subclass },
    }).ok).toBe(false);
    expect(() => cloneMotionJsonValue(subclass as never)).toThrow(TypeError);
    expect(counter.calls).toBe(0);
  });
});
