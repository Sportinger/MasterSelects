import { describe, expect, it } from 'vitest';

import { createTitleAdjustmentMontageFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP,
  adaptTimelineEffectsToMotionAdjustmentContracts,
  type AdaptTimelineAdjustmentEffectsInput,
  type TimelineAdjustmentEffectInput,
} from '../../src/services/motionDesign/adjustment/supportedEffectContractAdapter';

describe('MD7 supported effect contract adapter', () => {
  it('freezes the timeline-to-Adjustment 1.0 compatibility map', () => {
    expect(MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP).toEqual({
      brightness: 'brightness',
      contrast: 'contrast',
      saturation: 'saturation',
      invert: 'invert',
      'gaussian-blur': 'gaussian-blur',
      blur: 'gaussian-blur',
    });
  });

  it('maps the ordered Adjustment 1.0 blur and color matrix into planner inputs', () => {
    const adapterInput = input([
      effect('brightness-id', 'brightness', { amount: 0.25 }),
      effect('contrast-id', 'contrast', {}),
      effect('saturation-id', 'saturation', { amount: 0.7 }),
      effect('invert-id', 'invert', {}),
      effect('blur-id', 'gaussian-blur', { radius: 6 }),
    ]);
    const before = structuredClone(adapterInput);

    const first = adaptTimelineEffectsToMotionAdjustmentContracts(adapterInput);
    const second = adaptTimelineEffectsToMotionAdjustmentContracts(adapterInput);

    expect(first).toEqual(second);
    expect(adapterInput).toEqual(before);
    expect(first).toEqual([
      {
        id: 'brightness-id',
        effectType: 'brightness',
        enabled: true,
        parameters: { amount: 0.25 },
      },
      {
        id: 'contrast-id',
        effectType: 'contrast',
        enabled: true,
        parameters: { amount: 1 },
      },
      {
        id: 'saturation-id',
        effectType: 'saturation',
        enabled: true,
        parameters: { amount: 0.7 },
      },
      {
        id: 'invert-id',
        effectType: 'invert',
        enabled: true,
        parameters: {},
      },
      {
        id: 'blur-id',
        effectType: 'gaussian-blur',
        enabled: true,
        parameters: { radius: 6, samples: 5 },
      },
    ]);

    const fixture = createTitleAdjustmentMontageFixture();
    const adjustment = fixture.layers.find((layer) => layer.kind === 'adjustment');
    if (!adjustment || adjustment.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    adjustment.effects = first;
    const packet = planMotionAdjustmentOperations(fixture);
    expect(packet.operations.flatMap((operation) =>
      operation.type === 'apply-adjustment-effect'
        ? [{
            id: operation.effectId,
            type: operation.effectType,
            parameters: operation.parameters,
          }]
        : [])).toEqual([
      { id: 'brightness-id', type: 'brightness', parameters: { amount: 0.25 } },
      { id: 'contrast-id', type: 'contrast', parameters: { amount: 1 } },
      { id: 'saturation-id', type: 'saturation', parameters: { amount: 0.7 } },
      { id: 'invert-id', type: 'invert', parameters: {} },
      {
        id: 'blur-id',
        type: 'gaussian-blur',
        parameters: { radius: 6, samples: 5 },
      },
    ]);
  });

  it('canonicalizes the existing legacy blur type without guessing ambiguous values', () => {
    expect(adaptTimelineEffectsToMotionAdjustmentContracts(input([
      effect('legacy-radius', 'blur', { radius: 4, samples: 9 }),
      effect('legacy-amount', 'blur', { amount: 7 }),
    ]))).toEqual([
      {
        id: 'legacy-radius',
        effectType: 'gaussian-blur',
        enabled: true,
        parameters: { radius: 4, samples: 9 },
      },
      {
        id: 'legacy-amount',
        effectType: 'gaussian-blur',
        enabled: true,
        parameters: { radius: 7, samples: 5 },
      },
    ]);

    expectAdapterError(
      input([effect('legacy-ambiguous', 'blur', { radius: 4, amount: 7 })]),
      'INVALID_ADJUSTMENT_EFFECT_PARAMETERS',
    );
  });

  it('fails closed with stable codes for unsupported effects and invalid parameters', () => {
    expectAdapterError(
      input([
        effect('valid-first', 'brightness', { amount: 0.1 }),
        effect('unsupported-late', 'glow', { radius: 12 }),
      ]),
      'UNSUPPORTED_ADJUSTMENT_EFFECT',
    );
    expectAdapterError(
      input([effect('bad-brightness', 'brightness', { amount: 2 })]),
      'INVALID_ADJUSTMENT_EFFECT_PARAMETERS',
    );
    expectAdapterError(
      input([effect('bad-blur', 'gaussian-blur', { radius: 5, quality: 1 })]),
      'INVALID_ADJUSTMENT_EFFECT_PARAMETERS',
    );
  });

  it('rejects duplicate ids and non-JSON inputs before reading accessors', () => {
    expectAdapterError(
      input([
        effect('duplicate-id', 'brightness', {}),
        effect('duplicate-id', 'gaussian-blur', {}),
      ]),
      'DUPLICATE_ADJUSTMENT_EFFECT_ID',
    );

    let getterCalls = 0;
    const malicious = input([
      effect('accessor-id', 'brightness', {}),
    ]) as unknown as Record<string, unknown>;
    const effects = malicious.effects as Array<Record<string, unknown>>;
    Object.defineProperty(effects[0]!.params, 'amount', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 0.5;
      },
    });

    expectAdapterError(
      malicious as unknown as AdaptTimelineAdjustmentEffectsInput,
      'INVALID_ADJUSTMENT_EFFECT_INPUT',
    );
    expect(getterCalls).toBe(0);
  });
});

function input(
  effects: readonly TimelineAdjustmentEffectInput[],
): AdaptTimelineAdjustmentEffectsInput {
  return { layerId: 'adjustment:grade', effects };
}

function effect(
  id: string,
  type: string,
  params: TimelineAdjustmentEffectInput['params'],
): TimelineAdjustmentEffectInput {
  return { id, name: type, type, enabled: true, params };
}

function expectAdapterError(
  adapterInput: AdaptTimelineAdjustmentEffectsInput,
  code: string,
): void {
  try {
    adaptTimelineEffectsToMotionAdjustmentContracts(adapterInput);
    throw new Error(`Expected adapter error ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
