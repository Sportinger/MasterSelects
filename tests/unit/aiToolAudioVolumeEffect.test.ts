import { beforeEach, describe, expect, it } from 'vitest';
import { handleAddEffect, handleUpdateEffect } from '../../src/services/aiTools/handlers/effects';
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

  it('stores numeric text as a number and reports the change like other effect mutations', async () => {
    const result = await handleAddEffect({ clipId: 'music', effectType: 'audio-volume', params: { volume: '0.5' } }, useTimelineStore.getState());
    expect(result).toMatchObject({ success: true, data: { params: { volume: 0.5 }, updatedParams: ['volume'], entities: { created: [{ kind: 'effect' }] } } });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'music')?.effects[0]?.params.volume).toBe(0.5);
  });

  it('refuses unknown names and wrong types before anything is created', async () => {
    const unknown = await handleAddEffect({ clipId: 'music', effectType: 'audio-volume', params: { volumee: 0.2 } }, useTimelineStore.getState());
    expect(unknown).toMatchObject({ success: false, error: expect.stringMatching(/Unknown parameter for audio-volume: volumee\. Valid: volume/) });
    const wrongType = await handleAddEffect({ clipId: 'music', effectType: 'audio-volume', params: { volume: 'loud' } }, useTimelineStore.getState());
    expect(wrongType).toMatchObject({ success: false, error: expect.stringMatching(/volume: "loud" is not a finite number/) });
    const eqBand = await handleAddEffect({ clipId: 'music', effectType: 'audio-eq', params: { band1k: true } }, useTimelineStore.getState());
    expect(eqBand).toMatchObject({ success: false, error: expect.stringMatching(/band1k: true is not a finite number/) });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'music')?.effects).toEqual([]);
  });

  it('accepts an EQ path into the stored bands and refuses a path that does not exist', async () => {
    const added = await handleAddEffect({ clipId: 'music', effectType: 'audio-eq', params: { band1k: 3 } }, useTimelineStore.getState());
    expect(added).toMatchObject({ success: true, data: { params: { band1k: 3 } } });
    const effectId = (added.data as { effectId: string }).effectId;
    const missing = await handleUpdateEffect({ clipId: 'music', effectId, params: { 'eq.audible.nothing.gainDb': 2 } }, useTimelineStore.getState());
    expect(missing).toMatchObject({ success: false, error: expect.stringMatching(/Unknown parameter for audio-eq: eq\.audible\.nothing\.gainDb/) });
    const updated = await handleUpdateEffect({ clipId: 'music', effectId, params: { volume: 1, band2k: '-4' } }, useTimelineStore.getState());
    expect(updated).toMatchObject({ success: false, error: expect.stringMatching(/Unknown parameter for audio-eq: volume/) });
    const fine = await handleUpdateEffect({ clipId: 'music', effectId, params: { band2k: '-4' } }, useTimelineStore.getState());
    expect(fine).toMatchObject({ success: true, data: { updatedParams: ['band2k'], entities: { updated: [{ kind: 'effect', id: effectId }] } } });
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'music')?.effects[0]?.params.band2k).toBe(-4);
  });

  it('refuses an audio effect on a clip without sound of its own', async () => {
    const result = await handleAddEffect({ clipId: 'picture', effectType: 'audio-volume' }, useTimelineStore.getState());
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/belongs to an audio clip/) });
  });
});
