import { describe, expect, it } from 'vitest';

import {
  PHONE_VOLUME_MAX_PERCENT,
  clampPhoneFade,
  fadeKeyframesMatch,
  gainToPercent,
  gainToSliderDb,
  percentToGain,
  phoneVolumeLockedNote,
  phoneVolumeStatusText,
  planPhoneFadeKeyframes,
  readPhoneClipAudio,
  resolvePhoneAudioTargets,
  sliderDbToGain,
  summarisePhoneAudioReadings,
  volumePropertyOf,
} from '../../src/components/mobileSkin/audio/phoneAudioLevels';
import type { Keyframe } from '../../src/types/keyframes';
import type { Effect } from '../../src/types/timeline';

const volumeEffect = (volume: number, enabled = true): Effect => ({
  id: 'vol', name: 'audio-volume', type: 'audio-volume', enabled, params: { volume },
} as Effect);

const keyframe = (time: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe => ({
  id: `kf-${time}-${value}`, clipId: 'a', time, value, easing, property: volumePropertyOf('vol'),
});

describe('phone volume mapping', () => {
  it('maps the desktop range: silence at -60 dB, unity at 0 dB, +18 dB at 794 %', () => {
    expect(gainToSliderDb(0)).toBe(-60);
    expect(gainToSliderDb(1)).toBeCloseTo(0, 9);
    expect(sliderDbToGain(-60)).toBe(0);
    expect(sliderDbToGain(0)).toBe(1);
    expect(sliderDbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(gainToPercent(sliderDbToGain(18))).toBe(PHONE_VOLUME_MAX_PERCENT);
    expect(PHONE_VOLUME_MAX_PERCENT).toBe(794);
  });

  it('clamps typed percentages and says so', () => {
    expect(percentToGain(50)).toEqual({ gain: 0.5, clamped: false });
    expect(percentToGain(2000)).toEqual({ gain: 7.94, clamped: true });
    expect(percentToGain(-5)).toEqual({ gain: 0, clamped: true });
  });
});

describe('phone audio targets', () => {
  const tracks = [
    { id: 'v1', type: 'video' as const, locked: false },
    { id: 'a1', type: 'audio' as const, locked: false },
    { id: 'a2', type: 'audio' as const, locked: true },
  ];
  const clips = [
    { id: 'video', name: 'Video', trackId: 'v1', linkedClipId: 'video-audio' },
    { id: 'video-audio', name: 'Video audio', trackId: 'a1', linkedClipId: 'video' },
    { id: 'music', name: 'Music', trackId: 'a1' },
    { id: 'still', name: 'Still', trackId: 'v1' },
    { id: 'locked', name: 'Locked', trackId: 'a2' },
  ];

  it('uses audio clips and the linked sound of video clips, once each', () => {
    expect(resolvePhoneAudioTargets(['video', 'video-audio', 'music'], clips, tracks)).toEqual({
      clipIds: ['video-audio', 'music'], silent: [], locked: [],
    });
  });

  it('names locked clips left out of a mixed selection in the status and a note', () => {
    const targets = resolvePhoneAudioTargets(['music', 'locked', 'still'], clips, tracks);
    expect(targets).toEqual({ clipIds: ['music'], silent: ['Still'], locked: ['Locked'] });
    expect(phoneVolumeStatusText(['Music'], targets)).toBe('Music · 1 selected without sound · 1 on a locked track left out');
    expect(phoneVolumeLockedNote(targets)).toMatch(/^Left out: Locked \(its sound is on a locked track\)\. Unlock the track/);
    expect(phoneVolumeLockedNote({ clipIds: ['music'], locked: [] })).toBeNull();
    // With nothing left to change the sheet is blocked and explains that itself.
    expect(phoneVolumeLockedNote({ clipIds: [], locked: ['Locked'] })).toBeNull();
    expect(phoneVolumeStatusText([], { silent: [], locked: ['Locked'] })).toBe('No sound selected');
  });

  it('reports clips without sound and sound on locked tracks instead of dropping them silently', () => {
    expect(resolvePhoneAudioTargets(['still', 'locked'], clips, tracks)).toEqual({
      clipIds: [], silent: ['Still'], locked: ['Locked'],
    });
  });
});

describe('reading clip levels', () => {
  const clip = (effects: Effect[], muted?: boolean) => ({ duration: 4, effects, audioState: muted ? { muted } : undefined });

  it('reads unity gain without a volume effect', () => {
    expect(readPhoneClipAudio(clip([]), [])).toMatchObject({ volume: 1, fadeIn: 0, fadeOut: 0, muted: false, effectId: null, automation: false });
  });

  it('reads level, mute and bypass from the editor data', () => {
    expect(readPhoneClipAudio(clip([volumeEffect(0.5, false)], true), [])).toMatchObject({
      volume: 0.5, muted: true, bypassed: true, effectId: 'vol',
    });
  });

  it('recognises fade in, fade out, both and the desktop fade shape', () => {
    const effects = [volumeEffect(1)];
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(0.5, 0.25)])).toMatchObject({ volume: 0.25, fadeIn: 0.5, fadeOut: 0 });
    expect(readPhoneClipAudio(clip(effects), [keyframe(3, 1), keyframe(4, 0)])).toMatchObject({ volume: 1, fadeIn: 0, fadeOut: 1 });
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(1, 0.5), keyframe(3.5, 0.5), keyframe(4, 0)]))
      .toMatchObject({ volume: 0.5, fadeIn: 1, fadeOut: 0.5, automation: false });
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(2, 0.8), keyframe(4, 0)])).toMatchObject({ fadeIn: 2, fadeOut: 2 });
  });

  it('reads its own fades at silence (level 0) as fades, not as drawn keyframes', () => {
    const effects = [volumeEffect(0)];
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(1, 0)])).toMatchObject({ volume: 0, fadeIn: 1, fadeOut: 0, automation: false });
    expect(readPhoneClipAudio(clip(effects), [keyframe(3, 0), keyframe(4, 0)])).toMatchObject({ volume: 0, fadeIn: 0, fadeOut: 1, automation: false });
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(1, 0), keyframe(3, 0), keyframe(4, 0)]))
      .toMatchObject({ volume: 0, fadeIn: 1, fadeOut: 1, automation: false });
    // Silent keyframes only at both edges are no fade shape the sheet writes.
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(4, 0)]).automation).toBe(true);
  });

  it('treats other volume keyframes as automation it must not overwrite', () => {
    const effects = [volumeEffect(1)];
    expect(readPhoneClipAudio(clip(effects), [keyframe(1, 0.2), keyframe(2, 0.9)]).automation).toBe(true);
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(1, 0.5), keyframe(2, 0.9), keyframe(4, 0)]).automation).toBe(true);
    expect(readPhoneClipAudio(clip(effects), [keyframe(0, 0), keyframe(3, 1)]).automation).toBe(true);
  });

  it('summarises several clips and flags differences', () => {
    const one = readPhoneClipAudio(clip([volumeEffect(0.5)]), []);
    const two = readPhoneClipAudio({ ...clip([volumeEffect(1)]), duration: 2 }, []);
    expect(summarisePhoneAudioReadings([one, two])).toMatchObject({ levels: { volume: 0.5 }, mixed: true, shortestDuration: 2 });
  });
});

describe('fade keyframe plan', () => {
  it('plans nothing without fades', () => {
    expect(planPhoneFadeKeyframes({ volume: 0.5, fadeIn: 0, fadeOut: 0, muted: false }, 4).keyframes).toEqual([]);
  });

  it('plans fades from silence to the level with the desktop easings', () => {
    const plan = planPhoneFadeKeyframes({ volume: 0.5, fadeIn: 1, fadeOut: 0.5, muted: false }, 4);
    expect(plan.keyframes).toEqual([
      { time: 0, value: 0, easing: 'ease-out' },
      { time: 1, value: 0.5, easing: 'linear' },
      { time: 3.5, value: 0.5, easing: 'ease-in' },
      { time: 4, value: 0, easing: 'linear' },
    ]);
    expect(plan.clamped).toBe(false);
  });

  it('limits each fade to half the clip and merges the meeting keyframe', () => {
    const plan = planPhoneFadeKeyframes({ volume: 1, fadeIn: 3, fadeOut: 9, muted: false }, 4);
    expect(plan).toMatchObject({ fadeIn: 2, fadeOut: 2, clamped: true });
    expect(plan.keyframes).toEqual([
      { time: 0, value: 0, easing: 'ease-out' },
      { time: 2, value: 1, easing: 'ease-in' },
      { time: 4, value: 0, easing: 'linear' },
    ]);
    expect(clampPhoneFade(-1, 4)).toEqual({ seconds: 0, clamped: false });
  });

  it('round-trips fades at silence through the reader', () => {
    for (const levels of [
      { volume: 0, fadeIn: 1, fadeOut: 0, muted: false },
      { volume: 0, fadeIn: 0, fadeOut: 1.5, muted: false },
      { volume: 0, fadeIn: 2, fadeOut: 2, muted: false },
    ]) {
      const written = planPhoneFadeKeyframes(levels, 4).keyframes.map((entry, index) => ({ ...keyframe(entry.time, entry.value, entry.easing), id: `k${index}` }));
      expect(readPhoneClipAudio({ duration: 4, effects: [volumeEffect(0)] }, written))
        .toMatchObject({ volume: 0, fadeIn: levels.fadeIn, fadeOut: levels.fadeOut, automation: false });
    }
  });

  it('round-trips through the reader', () => {
    const levels = { volume: 0.3, fadeIn: 0.75, fadeOut: 1.25, muted: false };
    const plan = planPhoneFadeKeyframes(levels, 4);
    const written = plan.keyframes.map((entry, index) => ({ ...keyframe(entry.time, entry.value, entry.easing), id: `k${index}` }));
    expect(fadeKeyframesMatch(written, plan.keyframes)).toBe(true);
    expect(readPhoneClipAudio({ duration: 4, effects: [volumeEffect(0.3)] }, written)).toMatchObject({ volume: 0.3, fadeIn: 0.75, fadeOut: 1.25 });
  });
});
