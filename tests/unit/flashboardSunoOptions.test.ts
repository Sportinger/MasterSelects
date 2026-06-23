import { describe, expect, it } from 'vitest';

import {
  buildFlashBoardSunoOptionsState,
  normalizeFlashBoardSunoWeight,
} from '../../src/components/panels/flashboard/FlashBoardSunoOptionsPlanner';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
} from '../../src/services/sunoService';

describe('FlashBoardSunoOptionsPlanner', () => {
  it('normalizes slider weights to stable two-decimal values', () => {
    expect(normalizeFlashBoardSunoWeight(0.654, DEFAULT_SUNO_STYLE_WEIGHT)).toBe(0.65);
    expect(normalizeFlashBoardSunoWeight(2, DEFAULT_SUNO_STYLE_WEIGHT)).toBe(1);
    expect(normalizeFlashBoardSunoWeight(-1, DEFAULT_SUNO_STYLE_WEIGHT)).toBe(0);
    expect(normalizeFlashBoardSunoWeight(Number.NaN, DEFAULT_SUNO_STYLE_WEIGHT)).toBe(DEFAULT_SUNO_STYLE_WEIGHT);
  });

  it('keeps tuning inactive for rounded default slider values', () => {
    const state = buildFlashBoardSunoOptionsState({
      audioWeight: DEFAULT_SUNO_AUDIO_WEIGHT + 0.004,
      customMode: false,
      instrumental: true,
      modelId: 'V5',
      styleWeight: DEFAULT_SUNO_STYLE_WEIGHT + 0.004,
      vocalGender: '',
      weirdnessConstraint: DEFAULT_SUNO_WEIRDNESS_CONSTRAINT + 0.004,
    });

    expect(state.tuningChanged).toBe(false);
  });
});
