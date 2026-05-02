import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  createVectorAnimationInputProperty,
  isVectorAnimationBounceMode,
  normalizeVectorAnimationRenderDimension,
  normalizeVectorAnimationStateCues,
  parseVectorAnimationInputProperty,
  resolveVectorAnimationStateName,
} from '../../src/types/vectorAnimation';

describe('vector animation state cues', () => {
  it('normalizes state cues by trimming names, clamping time, and sorting', () => {
    expect(normalizeVectorAnimationStateCues([
      { id: 'late', time: 2, stateName: ' active ' },
      { id: 'empty', time: 1, stateName: ' ' },
      { id: 'early', time: -3, stateName: 'idle' },
    ])).toEqual([
      { id: 'early', time: 0, stateName: 'idle' },
      { id: 'late', time: 2, stateName: 'active' },
    ]);
  });

  it('resolves the latest cue at the clip-local time with static state fallback', () => {
    const settings = {
      ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
      stateMachineState: 'idle',
      stateMachineStateCues: [
        { id: 'hover', time: 1, stateName: 'hover' },
        { id: 'pressed', time: 3, stateName: 'pressed' },
      ],
    };

    expect(resolveVectorAnimationStateName(settings, 0)).toBe('idle');
    expect(resolveVectorAnimationStateName(settings, 1.5)).toBe('hover');
    expect(resolveVectorAnimationStateName(settings, 4)).toBe('pressed');
  });
});

describe('vector animation input properties', () => {
  it('round-trips encoded state machine input properties', () => {
    const property = createVectorAnimationInputProperty('button.machine', 'On Off');

    expect(parseVectorAnimationInputProperty(property)).toEqual({
      stateMachineName: 'button.machine',
      inputName: 'On Off',
    });
  });
});

describe('vector animation playback settings', () => {
  it('normalizes render dimensions and identifies bounce modes', () => {
    expect(normalizeVectorAnimationRenderDimension(1920.4)).toBe(1920);
    expect(normalizeVectorAnimationRenderDimension(4)).toBeUndefined();
    expect(normalizeVectorAnimationRenderDimension(9000)).toBeUndefined();
    expect(isVectorAnimationBounceMode('bounce')).toBe(true);
    expect(isVectorAnimationBounceMode('reverse-bounce')).toBe(true);
    expect(isVectorAnimationBounceMode('forward')).toBe(false);
  });
});
