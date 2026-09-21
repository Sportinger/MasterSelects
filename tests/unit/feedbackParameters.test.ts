import { describe, expect, it } from 'vitest';
import { FEEDBACK_HISTORY_LOOP_PARAM, FEEDBACK_PARAMETERS, resolveFeedbackHistoryLoop } from '../../src/effects/_shared/feedbackParameters';
import { acuarela } from '../../src/effects/stylize/acuarela';
import { rom1 } from '../../src/effects/stylize/rom1';
import { voxelRelief } from '../../src/effects/stylize/voxel-relief';
import { asciiGhost } from '../../src/effects/glyph';
import { kineticTrace } from '../../src/effects/tracking';

describe('shared feedback parameters', () => {
  it('provides one non-animatable reset/continuous owner schema to every feedback definition', () => {
    expect(FEEDBACK_HISTORY_LOOP_PARAM).toEqual({ type: 'select', label: 'History Loop', default: 'reset',
      options: [{ value: 'reset', label: 'Reset' }, { value: 'continuous', label: 'Continuous' }], animatable: false });
    for (const definition of [acuarela, rom1, voxelRelief, asciiGhost, kineticTrace]) {
      expect(definition.usesFeedback).toBe(true);
      expect(definition.params.historyLoop).toBe(FEEDBACK_PARAMETERS.historyLoop);
    }
  });

  it('defaults absent or invalid legacy values to reset and preserves valid serialized values', () => {
    expect(resolveFeedbackHistoryLoop(undefined)).toBe('reset');
    expect(resolveFeedbackHistoryLoop({})).toBe('reset');
    expect(resolveFeedbackHistoryLoop({ historyLoop: 'invalid' })).toBe('reset');
    const restored = JSON.parse(JSON.stringify({ params: { historyLoop: 'continuous' } })) as { params: Record<string, unknown> };
    expect(resolveFeedbackHistoryLoop(restored.params)).toBe('continuous');
  });

  it('packs explicit composition time for Rom1 and animated glyph feedback', () => {
    expect(rom1.packUniforms({}, 32, 18, 4.25)?.[10]).toBe(4.25);
    expect(rom1.packUniforms({}, 32, 18, Number.NaN)?.[10]).toBe(0);
    expect(asciiGhost.packUniforms({}, 32, 18, 4.25)?.[4]).toBe(4.25);
    expect(asciiGhost.packUniforms({}, 32, 18, Number.NaN)?.[4]).toBe(0);
  });
});
