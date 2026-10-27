import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPhoneClipAudioFromStore, writePhoneClipAudioLevels } from '../../src/components/mobileSkin/audio/phoneVolumeCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function seed(locked = false) {
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 'audio-1', type: 'audio', locked })],
    clips: [createMockClip({ id: 'tone', trackId: 'audio-1', startTime: 0, duration: 4, file: new File([], 'tone.wav', { type: 'audio/wav' }), effects: [] })],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    isExporting: false,
  });
}

const clip = () => useTimelineStore.getState().clips.find((candidate) => candidate.id === 'tone')!;

describe('setClipAudioMuted (editor store)', () => {
  beforeEach(() => seed());
  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map() }));

  it('sets and clears audioState.muted without touching the level', () => {
    useTimelineStore.getState().setClipAudioMuted('tone', true);
    expect(clip().audioState?.muted).toBe(true);
    useTimelineStore.getState().setClipAudioMuted('tone', false);
    expect(clip().audioState?.muted).toBeUndefined();
    expect(clip().effects).toEqual([]);
  });

  it('refuses clips on locked tracks', () => {
    seed(true);
    useTimelineStore.getState().setClipAudioMuted('tone', true);
    expect(clip().audioState?.muted).toBeUndefined();
  });
});

describe('phone volume writes', () => {
  beforeEach(() => seed());
  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map() }));

  it('leaves an untouched clip untouched', () => {
    writePhoneClipAudioLevels('tone', { volume: 1, fadeIn: 0, fadeOut: 0, muted: false });
    expect(clip().effects).toEqual([]);
    expect(useTimelineStore.getState().clipKeyframes.get('tone')).toBeUndefined();
  });

  it('writes the level to the desktop audio-volume effect and fades as its keyframes', () => {
    const result = writePhoneClipAudioLevels('tone', { volume: 0.5, fadeIn: 0.5, fadeOut: 3, muted: true });
    expect(result.fadesClamped).toBe(true);
    const effect = clip().effects.find((candidate) => candidate.type === 'audio-volume');
    expect(effect?.params.volume).toBe(0.5);
    const keyframes = useTimelineStore.getState().clipKeyframes.get('tone') ?? [];
    expect(keyframes.map((keyframe) => [keyframe.property, keyframe.time, keyframe.value])).toEqual([
      [`effect.${effect!.id}.volume`, 0, 0],
      [`effect.${effect!.id}.volume`, 0.5, 0.5],
      [`effect.${effect!.id}.volume`, 2, 0.5],
      [`effect.${effect!.id}.volume`, 4, 0],
    ]);
    expect(readPhoneClipAudioFromStore('tone')).toMatchObject({ volume: 0.5, fadeIn: 0.5, fadeOut: 2, muted: true });
  });

  it('removes the fades again and keeps the static level', () => {
    writePhoneClipAudioLevels('tone', { volume: 0.25, fadeIn: 1, fadeOut: 1, muted: false });
    writePhoneClipAudioLevels('tone', { volume: 0.25, fadeIn: 0, fadeOut: 0, muted: false });
    expect(useTimelineStore.getState().clipKeyframes.get('tone') ?? []).toEqual([]);
    expect(readPhoneClipAudioFromStore('tone')).toMatchObject({ volume: 0.25, fadeIn: 0, fadeOut: 0 });
  });

  it('switches a bypassed volume back on and says so', () => {
    writePhoneClipAudioLevels('tone', { volume: 0.5, fadeIn: 0, fadeOut: 0, muted: false });
    const effectId = clip().effects[0].id;
    useTimelineStore.getState().setClipEffectEnabled('tone', effectId, false);
    expect(writePhoneClipAudioLevels('tone', { volume: 0.4, fadeIn: 0, fadeOut: 0, muted: false }).reEnabled).toBe(true);
    expect(clip().effects[0]).toMatchObject({ enabled: true, params: { volume: 0.4 } });
  });

  it('keeps editing after the level reached silence with a fade (its own shape is no automation)', () => {
    writePhoneClipAudioLevels('tone', { volume: 0.5, fadeIn: 1, fadeOut: 0, muted: false });
    writePhoneClipAudioLevels('tone', { volume: 0, fadeIn: 1, fadeOut: 0, muted: false });
    expect(readPhoneClipAudioFromStore('tone')).toMatchObject({ volume: 0, fadeIn: 1, fadeOut: 0, automation: false });
    expect(() => writePhoneClipAudioLevels('tone', { volume: 0.8, fadeIn: 1, fadeOut: 0.5, muted: false })).not.toThrow();
    expect(readPhoneClipAudioFromStore('tone')).toMatchObject({ volume: 0.8, fadeIn: 1, fadeOut: 0.5, automation: false });
    // Done re-runs the final write: it must be accepted as well.
    expect(() => writePhoneClipAudioLevels('tone', { volume: 0.8, fadeIn: 1, fadeOut: 0.5, muted: false })).not.toThrow();
  });

  it('refuses to overwrite drawn volume automation', () => {
    writePhoneClipAudioLevels('tone', { volume: 1, fadeIn: 0.5, fadeOut: 0, muted: false });
    const property = `effect.${clip().effects[0].id}.volume` as const;
    useTimelineStore.getState().addKeyframe('tone', property, 0.3, 3, 'linear');
    expect(() => writePhoneClipAudioLevels('tone', { volume: 1, fadeIn: 0, fadeOut: 0, muted: false })).toThrow(/drawn volume keyframes/);
  });
});
