import {
  IDENTITY_ADJUSTMENT_TRANSFORM,
  MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentStackContract,
} from './contracts';
import { MOTION_ADJUSTMENT_DEFAULT_REVISION } from './revisionContract';

const FULL_RANGE = { start: 0, end: 10 };

export function createTitleAdjustmentMontageFixture(): MotionAdjustmentStackContract {
  return {
    contractVersion: MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
    revision: MOTION_ADJUSTMENT_DEFAULT_REVISION,
    compositionId: 'composition:adjustment-contract-fixture',
    evaluationTime: 5,
    inputOrder: 'top-to-bottom',
    layers: [
      {
        kind: 'source',
        layerId: 'title',
        enabled: true,
        activeRange: { ...FULL_RANGE },
        source: { kind: 'title', sourceId: 'title:hero' },
        mix: createDefaultMix(),
      },
      {
        kind: 'adjustment',
        layerId: 'grade',
        enabled: true,
        activeRange: { ...FULL_RANGE },
        transform: { ...IDENTITY_ADJUSTMENT_TRANSFORM },
        mix: {
          opacity: 0.65,
          blendMode: 'overlay',
          masks: [
            {
              id: 'mask:grade-window',
              mode: 'add',
              inverted: false,
              opacity: 0.8,
              feather: 16,
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.9, y: 0.2 },
                { x: 0.9, y: 0.8 },
                { x: 0.1, y: 0.8 },
              ],
            },
          ],
        },
        effects: [
          {
            id: 'effect:brightness',
            effectType: 'brightness',
            enabled: true,
            parameters: { amount: 0.12 },
          },
          {
            id: 'effect:contrast',
            effectType: 'contrast',
            enabled: true,
            parameters: { amount: 0.2 },
          },
        ],
      },
      {
        kind: 'source',
        layerId: 'montage',
        enabled: true,
        activeRange: { ...FULL_RANGE },
        source: { kind: 'timeline-media', sourceId: 'timeline-media:montage' },
        mix: createDefaultMix(),
      },
    ],
  };
}

export function createTwoAdjustmentFixture(): MotionAdjustmentStackContract {
  const fixture = createTitleAdjustmentMontageFixture();
  const montage = fixture.layers[2];
  if (!montage || montage.kind !== 'source') {
    throw new Error('Invalid title/adjustment/montage fixture');
  }
  return {
    ...fixture,
    layers: [
      {
        kind: 'adjustment',
        layerId: 'upper-adjustment',
        enabled: true,
        activeRange: { ...FULL_RANGE },
        transform: { ...IDENTITY_ADJUSTMENT_TRANSFORM },
        mix: createDefaultMix(),
        effects: [
          {
            id: 'effect:invert',
            effectType: 'invert',
            enabled: true,
            parameters: {},
          },
        ],
      },
      {
        kind: 'adjustment',
        layerId: 'lower-adjustment',
        enabled: true,
        activeRange: { ...FULL_RANGE },
        transform: { ...IDENTITY_ADJUSTMENT_TRANSFORM },
        mix: createDefaultMix(),
        effects: [
          {
            id: 'effect:saturation',
            effectType: 'saturation',
            enabled: true,
            parameters: { amount: 0.75 },
          },
          {
            id: 'effect:blur',
            effectType: 'gaussian-blur',
            enabled: true,
            parameters: { radius: 4 },
          },
        ],
      },
      montage,
    ],
  };
}

export function createTimeRangeExclusionFixture(): MotionAdjustmentStackContract {
  const fixture = createTitleAdjustmentMontageFixture();
  return {
    ...fixture,
    evaluationTime: 5,
    layers: [
      {
        kind: 'source',
        layerId: 'future-title',
        enabled: true,
        activeRange: { start: 6, end: 10 },
        source: { kind: 'title', sourceId: 'title:future' },
        mix: createDefaultMix(),
      },
      ...fixture.layers,
      {
        kind: 'source',
        layerId: 'ended-source',
        enabled: true,
        activeRange: { start: 0, end: 5 },
        source: { kind: 'timeline-media', sourceId: 'timeline-media:ended' },
        mix: createDefaultMix(),
      },
      {
        kind: 'source',
        layerId: 'disabled-source',
        enabled: false,
        activeRange: { ...FULL_RANGE },
        source: { kind: 'timeline-media', sourceId: 'timeline-media:disabled' },
        mix: createDefaultMix(),
      },
    ],
  };
}

function createDefaultMix(): MotionAdjustmentMixContract {
  return {
    opacity: 1,
    blendMode: 'normal',
    masks: [],
  };
}
