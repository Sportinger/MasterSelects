import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { createMockClip } from '../helpers/mockData';
import { createTestTimelineStore } from '../helpers/storeFactory';

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
