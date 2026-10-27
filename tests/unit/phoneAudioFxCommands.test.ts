import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isPhoneAudioFxOffered, phoneAudioFxGroups, phoneAudioFxMainParam, phoneAudioFxStartingPoint, readPhoneAudioParam,
} from '../../src/components/mobileSkin/audiofx/phoneAudioFxCatalog';
import {
  createPhoneAudioFxCommands, phoneAudioFxMoveIndex, readPhoneAudioFxStack,
} from '../../src/components/mobileSkin/audiofx/phoneAudioFxCommands';
import { getAllAudioEffects } from '../../src/engine/audio/AudioEffectRegistry';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function seed() {
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
    clips: [createMockClip({ id: 'tone', trackId: 'audio-1', startTime: 0, duration: 4, file: new File([], 'tone.wav', { type: 'audio/wav' }), effects: [] })],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    isExporting: false,
  });
}

const stack = () => readPhoneAudioFxStack('tone');

describe('phone audio effect catalog', () => {
  it('offers every registry audio effect except the level and the graph-only Audio Math', () => {
    const offered = phoneAudioFxGroups().flatMap((group) => group.effects.map((effect) => effect.id));
    const registry = getAllAudioEffects().map((effect) => effect.id).filter((id) => id !== 'audio-volume' && id !== 'audio-math');
    expect(offered.toSorted()).toEqual(registry.toSorted());
    expect(isPhoneAudioFxOffered('audio-volume')).toBe(false);
    expect(isPhoneAudioFxOffered('audio-math')).toBe(false);
    expect(isPhoneAudioFxOffered('audio-reverb')).toBe(true);
  });

  it('names a main value with the desktop range for the core effects', () => {
    expect(phoneAudioFxMainParam('audio-low-pass')).toMatchObject({ name: 'frequencyHz', min: 20, max: 22000, suffix: 'Hz', defaultValue: 22000 });
    expect(phoneAudioFxMainParam('audio-compressor')).toMatchObject({ name: 'thresholdDb', min: -80, max: 0 });
    expect(phoneAudioFxMainParam('audio-reverb')).toMatchObject({ name: 'mix', min: 0, max: 1 });
    expect(phoneAudioFxMainParam('audio-mono-sum')).toBeNull();
  });

  it('reads stored values and falls back to registry defaults', () => {
    expect(readPhoneAudioParam({ mix: 0.4 }, 'audio-reverb', 'mix')).toBe(0.4);
    expect(readPhoneAudioParam({}, 'audio-reverb', 'mix')).toBe(0);
    expect(readPhoneAudioParam({ mix: 'x' }, 'audio-reverb', 'decaySeconds')).toBe(1.2);
  });

  it('moves one step and refuses both ends', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(phoneAudioFxMoveIndex(list, 'b', -1)).toBe(0);
    expect(phoneAudioFxMoveIndex(list, 'b', 1)).toBe(2);
    expect(phoneAudioFxMoveIndex(list, 'a', -1)).toBeNull();
    expect(phoneAudioFxMoveIndex(list, 'c', 1)).toBeNull();
    expect(phoneAudioFxMoveIndex(list, 'x', 1)).toBeNull();
  });
});

describe('phone audio effect commands (editor store)', () => {
  beforeEach(() => seed());
  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map() }));

  it('adds through the desktop stack action with the phone starting point, toggles, moves and removes', async () => {
    const commands = createPhoneAudioFxCommands('tone');
    const compressor = await commands.add('audio-compressor');
    const lowPass = await commands.add('audio-low-pass');
    expect(stack().map((effect) => effect.descriptorId)).toEqual(['audio-compressor', 'audio-low-pass']);
    expect(stack()[0].params).toMatchObject(phoneAudioFxStartingPoint('audio-compressor')!);
    expect(stack()[1].params.frequencyHz).toBe(22000);

    await commands.setParam(lowPass!, 'frequencyHz', 800);
    expect(stack()[1].params.frequencyHz).toBe(800);
    await commands.setEnabled(compressor!, false);
    expect(stack()[0].enabled).toBe(false);
    await commands.move(lowPass!, -1);
    expect(stack().map((effect) => effect.id)).toEqual([lowPass, compressor]);
    await commands.remove(compressor!);
    expect(stack().map((effect) => effect.id)).toEqual([lowPass]);
    expect(await commands.add('audio-volume')).toBeNull();
  });

  it('normalize adds one peak normalize and re-enables an existing one instead of stacking', async () => {
    const commands = createPhoneAudioFxCommands('tone');
    const first = await commands.normalize();
    await commands.setEnabled(first!, false);
    const second = await commands.normalize();
    expect(second).toBe(first);
    expect(stack()).toHaveLength(1);
    expect(stack()[0]).toMatchObject({ descriptorId: 'audio-normalize', enabled: true });
    expect(stack()[0].params).toMatchObject({ mode: 'peak', targetPeakDb: -1 });
  });

  it('reports a clip without sound instead of failing silently', async () => {
    const commands = createPhoneAudioFxCommands(null);
    expect(await commands.add('audio-reverb')).toBeNull();
    expect(await commands.removeSilence({ thresholdDb: -50, minSilenceSeconds: 0.3, ripple: false })).toEqual({ kind: 'failed', message: 'Select a clip with sound first.' });
  });
});
