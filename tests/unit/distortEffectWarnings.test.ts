import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAddEffect, handleUpdateEffect } from '../../src/services/aiTools/handlers/effects';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { fisheyeParameterWarnings } from '../../src/effects/distort/fisheye/normalization';
import { getEffect } from '../../src/effects';
import type { EffectDefinition } from '../../src/effects/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const data = (result: { success: boolean; data?: unknown; error?: string }) => {
  expect(result.success, result.error).toBe(true);
  return result.data as { effectId: string; warnings?: string[] };
};

describe('distort effects report values they clamp or cannot show', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...initialMediaState, activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', name: 'Composition 1', width: 1920, height: 1080 } as never] } as ReturnType<typeof useMediaStore.getState>);
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video-track', type: 'video' })],
      clips: [createMockClip({ id: 'video-clip', trackId: 'video-track', source: { type: 'video' } })],
      clipKeyframes: new Map(), selectedClipIds: new Set(), primarySelectedClipId: null, isExporting: false });
  });
  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('returns tool warnings for a Scale that Fit ignores and a zero-size bulge, none for normal values', async () => {
    const lens = data(await handleAddEffect({ clipId: 'video-clip', effectType: 'lens-correction', params: { distortion: -20, fitFullImage: true, scale: 140 } }, useTimelineStore.getState()));
    expect(lens.warnings?.join(' ')).toContain('Scale 140% is ignored while Fit Entire Photo is on');
    const bulge = data(await handleAddEffect({ clipId: 'video-clip', effectType: 'bulge', params: { amount: 2 } }, useTimelineStore.getState()));
    expect(bulge.warnings).toBeUndefined();
    const updated = data(await handleUpdateEffect({ clipId: 'video-clip', effectId: bulge.effectId, params: { radius: 0 } }, useTimelineStore.getState()));
    expect(updated.warnings?.[0]).toContain('radius: 0 leaves no area');
  });

  it('names clamped Fisheye values instead of normalizing them silently', () => {
    expect(fisheyeParameterWarnings({ strength: 3, fieldOfView: 140, samples: 12, edgeMode: 'wrap' })).toEqual([
      'strength: 3 is outside -1..1; using 1.',
      'edgeMode: "wrap" is not an option; using transparent.',
      'samples: 12 is not a whole number from 1 to 8; using 8.',
    ]);
    expect(fisheyeParameterWarnings({ strength: -.5, samples: 5 })).toEqual([]);
  });
  it('names unknown Shape and Frame Edges choices instead of falling back silently', async () => {
    const warnings = (type: string, params: Record<string, string | number>) => (getEffect(type) as EffectDefinition).paramWarnings!(params);
    expect(warnings('twirl', { radius: .5, shape: 'oval', edges: 'wrap' })).toEqual([
      'shape: "oval" is not an option; using circle.', 'edges: "wrap" is not an option; using mirror.']);
    expect(warnings('bulge', { amount: 2, radius: .5, edges: 'repeat' })).toEqual(['edges: "repeat" is not an option; using mirror.']);
    expect(warnings('wave', { edges: 'tile' })).toEqual(['edges: "tile" is not an option; using mirror.']);
    expect(warnings('wave', { edges: 'transparent' })).toEqual([]);
    const wave = data(await handleAddEffect({ clipId: 'video-clip', effectType: 'wave', params: { edges: 'tile' } }, useTimelineStore.getState()));
    expect(wave.warnings).toContain('edges: "tile" is not an option; using mirror.');
  });

  it('reports no fold for strong barrel removal at any composition size: the mapping never folds', async () => {
    // An optical centre near the left edge reaches much farther on a wide frame than on a tall one; neither folds.
    const lens = getEffect('lens-correction') as EffectDefinition;
    const params = (distortion: number) => ({ ...Object.fromEntries(Object.entries(lens.params).map(([id, schema]) => [id, schema.default])), centerX: .15, distortion }) as Record<string, number | string | boolean>;
    for (const distortion of [-30, -60, -100]) for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      // Nothing folds; the only note names the outer ring a straight line stretches instead of straightening.
      const notes = lens.paramWarnings!(params(distortion), width, height);
      expect(notes).toHaveLength(1); expect(notes[0]).toContain('stretched evenly and its lines are not straightened');
      expect(notes.join(' ')).not.toMatch(/fold/i);
    }
    const tall = { id: 'tall', name: 'Tall', width: 1080, height: 1920 } as never;
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...initialMediaState, activeCompositionId: 'tall', compositions: [tall],
      getActiveComposition: () => tall } as ReturnType<typeof useMediaStore.getState>);
    const added = data(await handleAddEffect({ clipId: 'video-clip', effectType: 'lens-correction', params: { centerX: .15, distortion: -80 } }, useTimelineStore.getState()));
    expect(added.warnings).toHaveLength(1);
    expect(added.warnings![0]).toContain('of the way to the frame corner the correction is stronger than the lens model allows');
  });
});
