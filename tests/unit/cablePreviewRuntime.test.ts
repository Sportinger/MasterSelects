import { describe, expect, it } from 'vitest';
import { applyCablePreviews, setCablePreview } from '../../src/services/faceCables/cablePreviewRuntime';
import type { Effect } from '../../src/types/effects';

describe('cable draft preview isolation', () => {
  const effect: Effect = { id: 'cable', type: 'face-cables', name: 'Face Cables', enabled: true, params: { bakedData: 'saved', cableTime: 2 } };
  it('overrides only the matching clip, effect and paused frame without mutating saved params', () => {
    setCablePreview('clip', 'cable', { time: 2, bakedData: 'draft' });
    expect(applyCablePreviews('clip', 2, [effect], true)[0].params).toEqual({ bakedData: 'draft', cableTime: 0 });
    expect(effect.params.bakedData).toBe('saved');
    expect(applyCablePreviews('clip', 2.02, [effect], true)[0].params.bakedData).toBe('draft');
    expect(applyCablePreviews('other', 2, [effect], true)[0]).toBe(effect);
    expect(applyCablePreviews('clip', 3, [effect], true)[0]).toBe(effect);
    setCablePreview('clip', 'cable', null);
  });
  it('uses saved data for export/playback and after cleanup', () => {
    setCablePreview('clip', 'cable', { time: 2, bakedData: 'draft' });
    expect(applyCablePreviews('clip', 2, [effect], false)[0]).toBe(effect);
    setCablePreview('clip', 'cable', null);
    expect(applyCablePreviews('clip', 2, [effect], true)[0]).toBe(effect);
  });
});
