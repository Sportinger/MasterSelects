import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { createMockClip } from '../helpers/mockData';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { cableFrameLayout, defaultFaceCable, encodeCableBake } from '../../src/services/faceCables/cableData';
import { packFaceCableUniforms } from '../../src/effects/tracking/faceCableUniforms';

function effectKeyframe(
  property: Keyframe['property'],
  time: number,
  value: number,
  easing: Keyframe['easing'] = 'linear',
): Keyframe {
  return { id: `${property}-${time}`, clipId: 'clip-1', property, time, value, easing };
}

function evaluateDirectEffects(effects: Effect[], keyframes: Keyframe[], time: number): Effect[] {
  const clip = createMockClip({ id: 'clip-1', effects });
  const store = createTestTimelineStore({
    clips: [clip],
    clipKeyframes: new Map([[clip.id, keyframes]]),
  });
  return store.getState().getInterpolatedEffects(clip.id, time);
}

describe('evaluateCompositionClipEffects', () => {
  it('renders the correct baked cable frame in direct/export and nested evaluation without live tracking', () => {
    const cables = [{ ...defaultFaceCable(), segments: 4 }];
    const layout = cableFrameLayout(3, cables), data = new Float32Array(layout.stride * 3);
    for (let frame = 0; frame < 3; frame++) {
      const base = frame * layout.stride;
      data[base] = 1; data[base + 1] = 0.005;
      for (let i = 0; i <= 4; i++) data.set([0.2 + frame * 0.1, 0.2 + i * 0.1, 1], base + 2 + i * 3);
    }
    const effect: Effect = { id: 'cables', type: 'face-cables', name: 'Face Cables', enabled: true,
      params: { bakedData: encodeCableBake({ version: 3, fps: 30, frames: 3, duration: 0.1, cables, data }) } };
    for (const keys of [[], [effectKeyframe('rotation.z', 0, 0)], [effectKeyframe('effect.cables.globalWindStrength', 0, 5)]]) {
      for (const time of [2 / 30, 0, 1 / 30]) {
        const direct = evaluateDirectEffects([effect], keys, time);
        const nested = evaluateCompositionClipEffects([effect], keys, time);
        expect(nested).toEqual(direct);
        for (const evaluated of [direct, nested]) {
          expect(evaluated[0].params.cableTime).toBe(time);
          const uniforms = packFaceCableUniforms(evaluated[0].params as Record<string, number | string | boolean>, 1000, 1000);
          expect(uniforms[2]).toBe(1);
          expect(uniforms[4 + 6]).toBe(1);
          expect(uniforms[4 + 12]).toBeCloseTo((0.2 + Math.round(time * 30) * 0.1) * 1000, 3);
        }
      }
    }
    expect(effect.params.cableTime).toBeUndefined();
  });
  const effects: Effect[] = [{
    id: 'brightness',
    name: 'Brightness',
    type: 'brightness',
    enabled: true,
    params: { amount: 2 },
  }];

  const keyframes = [
    effectKeyframe('effect.brightness.amount', 0, 0, 'ease-in'),
    effectKeyframe('effect.brightness.amount', 10, 10),
  ];

  it('matches direct effect interpolation for numeric parameters and easing', () => {
    const result = evaluateCompositionClipEffects(effects, keyframes, 5);

    expect(result).toEqual(evaluateDirectEffects(effects, keyframes, 5));
    expect(result[0].params.amount).toBeCloseTo(2.5);
  });

  it('matches direct endpoint behavior', () => {
    expect(evaluateCompositionClipEffects(effects, keyframes, -1)).toEqual(
      evaluateDirectEffects(effects, keyframes, -1),
    );
    expect(evaluateCompositionClipEffects(effects, keyframes, 12)).toEqual(
      evaluateDirectEffects(effects, keyframes, 12),
    );
  });

  it('ignores unknown effect properties like the direct path', () => {
    const unknownKeyframes = [
      effectKeyframe('effect.brightness.missing', 0, 1),
      effectKeyframe('effect.unknown.amount', 0, 1),
    ];
    const result = evaluateCompositionClipEffects(effects, unknownKeyframes, 0);

    expect(result).toEqual(evaluateDirectEffects(effects, unknownKeyframes, 0));
    expect(result[0].params).toEqual({ amount: 2 });
  });

  it('matches direct interpolation for nested legacy effect properties', () => {
    const legacyEffects: Effect[] = [{
      id: 'legacy-volume',
      name: 'Legacy Volume',
      type: 'audio-volume',
      enabled: true,
      params: { automation: { gain: 1 } },
    }];
    const legacyKeyframes = [
      effectKeyframe('effect.legacy-volume.automation.gain', 0, 0),
      effectKeyframe('effect.legacy-volume.automation.gain', 10, 10),
    ];
    const result = evaluateCompositionClipEffects(legacyEffects, legacyKeyframes, 5);

    expect(result).toEqual(evaluateDirectEffects(legacyEffects, legacyKeyframes, 5));
    expect(result[0].params.automation).toEqual({ gain: 5 });
  });

  it('does not mutate persisted effect data', () => {
    const input = [{ ...effects[0], params: { ...effects[0].params } }];
    const before = JSON.parse(JSON.stringify(input));
    const result = evaluateCompositionClipEffects(input, keyframes, 5);

    expect(input).toEqual(before);
    expect(result).not.toBe(input);
    expect(result[0].params).not.toBe(input[0].params);
  });
});
