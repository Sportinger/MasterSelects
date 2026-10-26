import { beforeEach, describe, expect, it } from 'vitest';
import { handleAddEffect } from '../../src/services/aiTools/handlers/effects';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

describe('addEffect for the Volume of an audio clip', () => {
  beforeEach(() => {
    useTimelineStore.setState({ ...initialTimelineState,
      tracks: [createMockTrack({ id: 'audio-track', type: 'audio' }), createMockTrack({ id: 'video-track', type: 'video' })],
      clips: [createMockClip({ id: 'music', trackId: 'audio-track', source: { type: 'audio' }, effects: [] }),
        createMockClip({ id: 'picture', trackId: 'video-track', source: { type: 'video' } })],
      clipKeyframes: new Map(), isExporting: false });
  });

  it('creates the Volume effect the Volume tab uses, once per clip, with its level', async () => {
    const first = await handleAddEffect({ clipId: 'music', effectType: 'audio-volume', params: { volume: 0.08 } }, useTimelineStore.getState());
    expect(first).toMatchObject({ success: true, data: { effectType: 'audio-volume', reused: false, params: { volume: 0.08 } } });
    const again = await handleAddEffect({ clipId: 'music', effectType: 'audio-volume' }, useTimelineStore.getState());
    expect(again).toMatchObject({ success: true, data: { effectId: (first.data as { effectId: string }).effectId, reused: true } });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'music')?.effects.filter(effect => effect.type === 'audio-volume')).toHaveLength(1);
  });

  it('refuses an audio effect on a clip without sound of its own', async () => {
    const result = await handleAddEffect({ clipId: 'picture', effectType: 'audio-volume' }, useTimelineStore.getState());
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/belongs to an audio clip/) });
  });
});
