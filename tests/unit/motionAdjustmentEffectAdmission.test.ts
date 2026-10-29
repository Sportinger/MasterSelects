import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EFFECT_REGISTRY, getDefaultParams } from '../../src/effects';
import {
  EXPLICIT_UNAVAILABLE_ADJUSTMENT_EFFECTS,
  classifyAdjustmentEffect,
  listAdjustmentEffectClassifications,
} from '../../src/services/motionDesign/adjustment/adjustmentEffectClassification';
import { sanitizeAdjustmentEffectParameters } from '../../src/services/motionDesign/adjustment/adjustmentEffectRegistryAdmission';
import { admitAdjustmentEffectsForRender } from '../../src/services/motionDesign/adjustment/adjustmentEffectRenderAdmission';
import { createTitleAdjustmentMontageFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import {
  MOTION_ADJUSTMENT_MAX_JSON_STRING_VALUE_LENGTH,
  assertMotionAdjustmentJsonData,
} from '../../src/services/motionDesign/adjustment/contractLimits';
import {
  COMPOSITOR_ADJUSTMENT_REPLACE_FLAG,
  COMPOSITOR_UNIFORM_FLOAT_COUNT,
  writeLayerUniformData,
} from '../../src/engine/pipeline/compositor/uniforms';
import { planMotionAdjustmentEffectAdapter } from '../../src/services/motionDesign/adjustment/effectAdapter';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  adaptTimelineEffectsToMotionAdjustmentContracts,
} from '../../src/services/motionDesign/adjustment/supportedEffectContractAdapter';
import {
  InvalidAdjustmentEffectParametersError,
  normalizeAdjustmentEffectParameters,
} from '../../src/services/motionDesign/adjustment/supportedEffects';
import {
  WorkerGpuAdjustmentFallbackError,
  workerGpuUnsupportedAdjustmentEffectTypes,
} from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import type { Effect } from '../../src/types/effects';
import type { Layer } from '../../src/types/layers';

function effect(id: string, type: string, params: Effect['params'] = {}, enabled = true): Effect {
  return { id, name: type, type: type as Effect['type'], enabled, params };
}

const EXPECTED_UNAVAILABLE = [
  'ai-edge-fill', 'cctv', 'face-cables', 'flocking', 'hand-particles', 'hud-tracker',
  'kinetic-trace', 'rain-reveal', 'slit-scan', 'splat-exploration',
  'stardust', 'subject', 'time-stack', 'tracked-scene', 'weave',
];

describe('adjustment effect classification', () => {
  it('classifies every registry effect and admits all but the source-bound ones', () => {
    const classifications = listAdjustmentEffectClassifications();
    expect(classifications).toHaveLength(EFFECT_REGISTRY.size);
    const unavailable = classifications.filter((entry) => !entry.admitted);
    expect(unavailable.map((entry) => entry.effectType).toSorted()).toEqual(EXPECTED_UNAVAILABLE);
    for (const entry of unavailable) {
      expect(entry.behavior).toBe('unavailable');
      expect(entry.reason, entry.effectType).toMatch(/cannot run on an adjustment layer: .+/);
    }
    expect(classifications.filter((entry) => entry.admitted).length).toBe(EFFECT_REGISTRY.size - EXPECTED_UNAVAILABLE.length);
  });

  it('keeps the explicit table on real registry effects', () => {
    for (const effectType of Object.keys(EXPLICIT_UNAVAILABLE_ADJUSTMENT_EFFECTS)) {
      expect(EFFECT_REGISTRY.has(effectType), effectType).toBe(true);
    }
  });

  it('separates previous-output feedback from source history', () => {
    expect(classifyAdjustmentEffect('acuarela')).toMatchObject({ behavior: 'previous-output-feedback', admitted: true });
    expect(classifyAdjustmentEffect('ascii-ghost')).toMatchObject({ behavior: 'previous-output-feedback', admitted: true });
    expect(classifyAdjustmentEffect('slit-scan')).toMatchObject({ unavailableCode: 'source-history', admitted: false });
    expect(classifyAdjustmentEffect('stardust')).toMatchObject({ unavailableCode: 'tracked-source' });
    expect(classifyAdjustmentEffect('pixelate')).toMatchObject({ behavior: 'accumulated-frame', admitted: true });
    // Effects that cut pixels out work through the compositor's adjustment replace mix.
    expect(classifyAdjustmentEffect('chroma-key')).toMatchObject({ behavior: 'accumulated-frame', admitted: true });
    expect(classifyAdjustmentEffect('pixel-particle-disintegrate')).toMatchObject({ admitted: true });
    expect(classifyAdjustmentEffect('audio-eq')).toMatchObject({ unavailableCode: 'audio-effect', admitted: false });
    expect(classifyAdjustmentEffect('runtime-plugin')).toMatchObject({ unavailableCode: 'unknown-effect', admitted: false });
  });
});

describe('registry parameter validation', () => {
  it('keeps numbers as set (the effect clamps them as on a clip), checks types, and passes graph values through', () => {
    // Glow Amount has a 0..5 slider and no render range: an overshooting keyframe renders as set on a clip.
    const result = sanitizeAdjustmentEffectParameters('glow', { amount: 6, node_value: 3 });
    expect(result.parameters).toEqual({ amount: 6, node_value: 3 });
    expect(result.issues).toEqual([]);
    expect(sanitizeAdjustmentEffectParameters('vignette', { size: 2 }).parameters).toEqual({ size: 2 });

    const wrong = sanitizeAdjustmentEffectParameters('posterize', { levels: 'many' });
    expect(wrong.issues[0]).toMatchObject({ parameter: 'levels', kind: 'replaced' });
    expect(wrong.parameters.levels).toBe(EFFECT_REGISTRY.get('posterize')!.params.levels!.default);
  });

  it('rejects wrong types on the strict contract path and keeps the original five on their frozen policy', () => {
    expect(() => normalizeAdjustmentEffectParameters('pixelate', { size: 'large' }))
      .toThrowError(InvalidAdjustmentEffectParametersError);
    expect(normalizeAdjustmentEffectParameters('pixelate', { size: 500 })).toEqual({ size: 500 });
    // Back-compat: the original five still normalize exactly as saved projects expect.
    expect(normalizeAdjustmentEffectParameters('brightness', {})).toEqual({ amount: 0 });
    expect(normalizeAdjustmentEffectParameters('gaussian-blur', { radius: 4 })).toEqual({ radius: 4, samples: 5 });
    expect(() => normalizeAdjustmentEffectParameters('brightness', { amount: 2 }))
      .toThrowError(InvalidAdjustmentEffectParametersError);
  });
});

describe('render admission', () => {
  it('loads a saved project with the original five effects identically', () => {
    const saved = [
      effect('fx-b', 'brightness', { amount: 0.25 }),
      effect('fx-c', 'contrast', {}),
      effect('fx-s', 'saturation', { amount: 0.7 }),
      effect('fx-i', 'invert', {}),
      effect('fx-g', 'gaussian-blur', { radius: 6 }),
      effect('fx-legacy', 'blur', { amount: 3 }),
    ];
    const admission = admitAdjustmentEffectsForRender('clip:adjustment', saved);
    expect(admission.bypassed).toEqual([]);
    expect(admission.effects.map(({ type, params }) => ({ type, params }))).toEqual([
      { type: 'brightness', params: { amount: 0.25 } },
      { type: 'contrast', params: { amount: 1 } },
      { type: 'saturation', params: { amount: 0.7 } },
      { type: 'invert', params: {} },
      { type: 'gaussian-blur', params: { radius: 6, samples: 5 } },
      { type: 'gaussian-blur', params: { radius: 3, samples: 5 } },
    ]);
    const frozen = adaptTimelineEffectsToMotionAdjustmentContracts({
      layerId: 'clip:adjustment',
      effects: saved.map(({ id, name, type, enabled, params }) => ({ id, name, type, enabled, params: params as never })),
    });
    expect(admission.effects.map((item) => item.params)).toEqual(frozen.map((item) => item.parameters));
  });

  it('bypasses one unavailable or malformed effect and keeps the rest of the stack', () => {
    const admission = admitAdjustmentEffectsForRender('clip:adjustment', [
      effect('fx-glow', 'glow', getDefaultParams('glow')),
      effect('fx-slit', 'slit-scan'),
      // Beyond the contract's JSON value budget: malformed, so bypassed.
      effect('fx-bad', 'pixelate', { note: 'x'.repeat(1_048_577) }),
      // A value of the wrong type renders with its default and is reported.
      effect('fx-typo', 'contrast', { amount: 'loud' }),
      effect('fx-off', 'slit-scan', {}, false),
      effect('fx-pix', 'pixelate', { size: -4 }),
    ]);
    expect(admission.effects.map((item) => item.id)).toEqual(['fx-glow', 'fx-typo', 'fx-off', 'fx-pix']);
    expect(admission.effects[1]!.params).toEqual({ amount: 1 });
    expect(admission.effects[3]!.params).toEqual({ size: -4 });
    expect(admission.bypassed.map((item) => item.effectId)).toEqual(['fx-slit', 'fx-bad']);
    expect(admission.bypassed[0]!.reason).toContain('source video');
    expect(admission.adjusted).toEqual([expect.objectContaining({ effectId: 'fx-typo', parameter: 'amount' })]);
  });

  it('renders a value of the original five outside its frozen policy as set instead of dropping the effect', () => {
    // A keyframe overshoot (Brightness 1.4) used to fail the frozen policy and lose the effect.
    const admission = admitAdjustmentEffectsForRender('clip:adjustment', [effect('fx-over', 'brightness', { amount: 1.4 })]);
    expect(admission.bypassed).toEqual([]);
    expect(admission.effects).toEqual([expect.objectContaining({ id: 'fx-over', type: 'brightness', params: { amount: 1.4 } })]);
  });

  it('admits long text parameters such as a Stick Figure choreography', () => {
    // About 120 characters per action: 60 actions are far beyond the 4 KB key budget.
    const actions = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      id: `action-${index}`, action: 'walk', start: index, duration: 1, from: { x: 0.1, y: 0.8 }, to: { x: 0.9, y: 0.8 },
    })));
    expect(actions.length).toBeGreaterThan(4_096);
    const params = { ...getDefaultParams('stick-figure'), actions };
    const admission = admitAdjustmentEffectsForRender('clip:adjustment', [effect('fx-figure', 'stick-figure', params)]);
    expect(admission.bypassed).toEqual([]);
    expect(admission.effects[0]!.params.actions).toBe(actions);
    expect(adaptTimelineEffectsToMotionAdjustmentContracts({
      layerId: 'clip:adjustment',
      effects: [{ id: 'fx-figure', name: 'Stick Figure', type: 'stick-figure', enabled: true, params: params as never }],
    })[0]!.parameters.actions).toBe(actions);
    expect(() => assertMotionAdjustmentJsonData({ key: 's'.repeat(MOTION_ADJUSTMENT_MAX_JSON_STRING_VALUE_LENGTH + 1) }))
      .toThrowError('JSON string length exceeds its hard budget');
    expect(() => assertMotionAdjustmentJsonData(Array.from({ length: 17 }, () => 's'.repeat(MOTION_ADJUSTMENT_MAX_JSON_STRING_VALUE_LENGTH))))
      .toThrowError('JSON total string length exceeds its hard budget');
  });
});

describe('contract planner and worker executor', () => {
  it('plans a registry effect for the main compositor and the worker executor refuses it with a reason', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
    if (!grade || grade.kind !== 'adjustment') throw new Error('Expected adjustment fixture');
    grade.effects = [{ id: 'effect:pixelate', effectType: 'pixelate', enabled: true, parameters: { size: 20 } }];
    const packet = planMotionAdjustmentOperations(fixture);
    const operation = packet.operations.find((candidate) => candidate.type === 'apply-adjustment-effect');
    expect(operation).toMatchObject({ effectType: 'pixelate', parameters: { size: 20 } });
    expect(() => planMotionAdjustmentEffectAdapter(operation as never))
      .toThrowError(/worker GPU executor draws only brightness, contrast, saturation, invert, gaussian-blur/);
  });

  it('names the effects that send a worker GPU frame back to the main compositor', () => {
    const adjustment = {
      id: 'adj', visible: true, opacity: 1, source: { type: 'motion-adjustment' },
      effects: [effect('a', 'brightness'), effect('b', 'glow'), effect('c', 'pixelate', {}, false)],
    } as unknown as Layer;
    expect(workerGpuUnsupportedAdjustmentEffectTypes([adjustment])).toEqual(['glow']);
    expect(new WorkerGpuAdjustmentFallbackError(['glow']).message).toContain('glow needs the main compositor');
  });
});

describe('adjustment replace mix', () => {
  it('flags adjustment layers so their result replaces the frame below instead of going over it', () => {
    const buffer = new ArrayBuffer(COMPOSITOR_UNIFORM_FLOAT_COUNT * 4);
    const floats = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const layer = (sourceType: string) => ({
      id: 'layer', name: 'layer', visible: true, opacity: 1, blendMode: 'multiply', source: { type: sourceType },
      effects: [], position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
    }) as unknown as Layer;
    writeLayerUniformData(layer('motion-adjustment'), 1, 1, false, floats, u32);
    expect(u32[1]! & COMPOSITOR_ADJUSTMENT_REPLACE_FLAG).toBe(COMPOSITOR_ADJUSTMENT_REPLACE_FLAG);
    expect(u32[1]! & 0xff).toBe(4);
    writeLayerUniformData(layer('image'), 1, 1, false, floats, u32);
    expect(u32[1]! & COMPOSITOR_ADJUSTMENT_REPLACE_FLAG).toBe(0);
  });

  it('mixes the processed frame by coverage in the composite shader, keeping cut-out pixels transparent', () => {
    const shader = readFileSync(path.join(process.cwd(), 'src/shaders/composite.wgsl'), 'utf8').replace(/\s+/g, ' ');
    expect(shader).toContain('if ((layer.blendMode & 0x200u) != 0u');
    expect(shader).toContain('return vec4f(mix(baseColor.rgb, blended * keptCoverage, coverage), mix(baseColor.a, layerColor.a, coverage));');
    expect(shader).toContain('coverage = coverage * maskValue;');
  });
});
