import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

describe('audio clip clipboard curves', () => {
  beforeEach(() => {
    useTimelineStore.setState({ tracks: DEFAULT_TRACKS, clips: [], clipKeyframes: new Map(), selectedClipIds: new Set() });
  });

  function copyAndPasteAudio() {
    const clip = createMockClip({
      id: 'source', trackId: 'audio-1', source: { type: 'audio' }, startTime: 4,
      effects: [{ id: 'volume', type: 'audio-volume', name: 'Volume', enabled: true, params: { volume: 0.75 } }],
      audioState: {
        muted: true,
        effectStack: [{ id: 'eq', descriptorId: 'audio-eq', enabled: true, params: { eq: { bands: [{ gainDb: 3 }] } } }],
        editStack: [{ id: 'region', type: 'gain', enabled: true, params: { gainDb: -3, timelineStart: 5, timelineEnd: 6 }, timeRange: { start: 1, end: 2 }, createdAt: 1 }],
        sourceAnalysisRefs: { waveformPyramidId: 'source-waveform' },
      },
    });
    const keys = [
      createMockKeyframe({ clipId: clip.id, property: 'effect.volume.volume', time: 1, value: 0.2, easing: 'bezier', handleOut: { x: 0.25, y: 0.4 } }),
      createMockKeyframe({ clipId: clip.id, property: 'effect.eq.eq.bands.0.gainDb', time: 2, value: 6 }),
    ];
    useTimelineStore.setState({ clips: [clip], selectedClipIds: new Set([clip.id]), clipKeyframes: new Map([[clip.id, keys]]) });
    useTimelineStore.getState().copyClips();
    const clipboardData = useTimelineStore.getState().clipboardData!;
    let id = 0;
    const paste = () => createPastedClipboardClipsPlan({
      clipboardData, playheadPosition: 20, tracks: DEFAULT_TRACKS, clipKeyframes: new Map(), timestamp: 1,
      createSuffix: () => `${id++}`,
    });
    return { clip, keys, clipboardData, paste };
  }

  it('retains mute, audio effects and region edits when copying and pasting a clip', () => {
    const { clip, paste } = copyAndPasteAudio();
    const pasted = paste().newClips[0];
    expect(pasted.audioState).toMatchObject({ muted: true, sourceAnalysisRefs: clip.audioState!.sourceAnalysisRefs });
    expect(pasted.audioState!.effectStack![0]).toMatchObject({ descriptorId: 'audio-eq', params: clip.audioState!.effectStack![0].params });
    expect(pasted.audioState!.editStack![0]).toMatchObject({ timeRange: { start: 1, end: 2 }, params: { timelineStart: 21, timelineEnd: 22, gainDb: -3 } });
    expect(pasted.audioState).not.toBe(clip.audioState);
  });

  it('retargets legacy and audio-stack automation to the new effect IDs', () => {
    const { keys, paste } = copyAndPasteAudio();
    const plan = paste();
    const pasted = plan.newClips[0];
    const pastedKeys = plan.newKeyframes.get(pasted.id)!;
    expect(pastedKeys[0].property).toBe(`effect.${pasted.effects[0].id}.volume`);
    expect(pastedKeys[0]).toMatchObject({ time: 1, value: 0.2, easing: 'bezier', handleOut: keys[0].handleOut });
    expect(pasted.audioState?.effectStack).toHaveLength(1);
    expect(pastedKeys[1].property).toBe(`effect.${pasted.audioState!.effectStack![0].id}.eq.bands.0.gainDb`);
    expect(pasted.audioState!.effectStack![0].id).not.toBe('eq');
  });

  it('keeps handles and effect parameters independent across repeated pastes', () => {
    const { clipboardData, paste } = copyAndPasteAudio();
    const first = paste();
    const second = paste();
    first.newKeyframes.get(first.newClips[0].id)![0].handleOut!.y = 0.9;
    expect(second.newKeyframes.get(second.newClips[0].id)![0].handleOut!.y).toBe(0.4);
    expect(clipboardData[0].keyframes![0].handleOut!.y).toBe(0.4);
    expect(first.newClips[0].audioState?.effectStack?.[0].params)
      .not.toBe(second.newClips[0].audioState?.effectStack?.[0].params);
  });
});
