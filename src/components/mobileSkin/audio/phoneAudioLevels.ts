// Pure model of the phone Volume sheet: which clips carry the sound of a selection, how the
// clip level, mute and fades are read from the editor's own data, and which volume keyframes a
// set of phone levels means. No store access here (tested on its own in phoneAudioLevels.test.ts).
//
// Editor data used (the same the desktop Volume tab, fade handles and export read):
// - level: the clip's `audio-volume` effect, param `volume` (linear gain, 1 = 0 dB);
// - fades: keyframes on `effect.<id>.volume`, 0 at the clip edge and the level at the fade end
//   (desktop fade handles use the same shape with level 1);
// - mute: `clip.audioState.muted`.

import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

/** Slider and numeric range of the desktop Volume row: silence (-60 dB) to +18 dB. */
export const PHONE_VOLUME_SILENCE_DB = -60;
export const PHONE_VOLUME_MAX_DB = 18;
/** +18 dB as a percentage of unity gain (794 %). */
export const PHONE_VOLUME_MAX_PERCENT = Math.round(10 ** (PHONE_VOLUME_MAX_DB / 20) * 100);
/** Fades shorter than this are "no fade" (same epsilon as the desktop fade keyframe plan). */
export const PHONE_FADE_EPSILON = 0.01;
const TIME_TOLERANCE = 0.01;
const VALUE_TOLERANCE = 1e-3;

export type PhoneFadeEasing = 'linear' | 'ease-in' | 'ease-out';

export interface PhoneAudioLevels {
  /** Linear gain, 0 = silence, 1 = unchanged. */
  volume: number;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export interface PhoneClipAudioReading extends PhoneAudioLevels {
  /** Id of the clip's audio-volume effect, null when the clip has none yet (unity gain). */
  effectId: string | null;
  /** The volume effect exists but is bypassed in the full editor: the level is not applied. */
  bypassed: boolean;
  /** Volume keyframes that are not a plain fade in/out (drawn automation): the sheet cannot edit them. */
  automation: boolean;
  duration: number;
}

export interface PhoneFadeKeyframe {
  time: number;
  value: number;
  easing: PhoneFadeEasing;
}

export const DEFAULT_PHONE_AUDIO_LEVELS: PhoneAudioLevels = { volume: 1, fadeIn: 0, fadeOut: 0, muted: false };

// ---------------------------------------------------------------------------
// Level <-> slider / percent
// ---------------------------------------------------------------------------

export function gainToSliderDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return PHONE_VOLUME_SILENCE_DB;
  return Math.max(PHONE_VOLUME_SILENCE_DB, Math.min(PHONE_VOLUME_MAX_DB, 20 * Math.log10(gain)));
}

export function sliderDbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= PHONE_VOLUME_SILENCE_DB) return 0;
  return 10 ** (Math.min(PHONE_VOLUME_MAX_DB, db) / 20);
}

export function gainToPercent(gain: number): number {
  return Number.isFinite(gain) ? Math.max(0, Math.round(gain * 100)) : 100;
}

/** Percent entry to gain; clamped to the phone range (0..794 %) with a flag so the UI can say so. */
export function percentToGain(percent: number): { gain: number; clamped: boolean } {
  if (!Number.isFinite(percent)) return { gain: 1, clamped: true };
  const bounded = Math.max(0, Math.min(PHONE_VOLUME_MAX_PERCENT, percent));
  return { gain: bounded / 100, clamped: bounded !== percent };
}

export function formatGainDb(gain: number): string {
  if (!Number.isFinite(gain) || gain <= 0) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db > 0.05 ? '+' : ''}${db.toFixed(1)} dB`;
}

// ---------------------------------------------------------------------------
// Targets: which clips carry the sound of the selection
// ---------------------------------------------------------------------------

export interface PhoneAudioTargets {
  /** Audio clip ids (an audio clip itself, or the linked audio of a video clip), deduplicated. */
  clipIds: string[];
  /** Selected clips without sound, by name. */
  silent: string[];
  /** Selected clips whose sound sits on a locked track. */
  locked: string[];
}

type TargetClip = Pick<TimelineClip, 'id' | 'name' | 'trackId' | 'linkedClipId'>;
type TargetTrack = Pick<TimelineTrack, 'id' | 'type' | 'locked'>;

export function resolvePhoneAudioTargets(
  selectedIds: readonly string[],
  clips: readonly TargetClip[],
  tracks: readonly TargetTrack[],
): PhoneAudioTargets {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const trackOf = (clip: TargetClip) => tracks.find((track) => track.id === clip.trackId);
  const result: PhoneAudioTargets = { clipIds: [], silent: [], locked: [] };
  for (const id of selectedIds) {
    const clip = byId.get(id);
    if (!clip) continue;
    let audio: TargetClip | undefined;
    if (trackOf(clip)?.type === 'audio') audio = clip;
    else if (clip.linkedClipId) {
      const linked = byId.get(clip.linkedClipId);
      if (linked && trackOf(linked)?.type === 'audio') audio = linked;
    }
    if (!audio) {
      result.silent.push(clip.name);
      continue;
    }
    if (trackOf(audio)?.locked) {
      if (!result.locked.includes(clip.name)) result.locked.push(clip.name);
      continue;
    }
    if (!result.clipIds.includes(audio.id)) result.clipIds.push(audio.id);
  }
  return result;
}

/** One status line for the sheet; clips left out (no sound, locked track) are counted, never dropped silently. */
export function phoneVolumeStatusText(names: readonly string[], targets: Pick<PhoneAudioTargets, 'silent' | 'locked'>): string {
  if (names.length === 0) return 'No sound selected';
  const parts = [names.length === 1 ? names[0] : `${names.length} clips with sound`];
  if (targets.silent.length > 0) parts.push(`${targets.silent.length} selected without sound`);
  if (targets.locked.length > 0) parts.push(`${targets.locked.length} on a locked track left out`);
  return parts.join(' · ');
}

/**
 * Note naming the selected clips whose sound is on a locked track, when other clips are still
 * changed (with no target left, the sheet is blocked and says so instead). Null when none.
 */
export function phoneVolumeLockedNote(targets: Pick<PhoneAudioTargets, 'clipIds' | 'locked'>): string | null {
  if (targets.locked.length === 0 || targets.clipIds.length === 0) return null;
  const count = targets.locked.length;
  return `Left out: ${targets.locked.join(', ')} (${count === 1 ? 'its sound is' : 'their sound is'} on a locked track). `
    + 'Unlock the track in the full editor to change it too.';
}

// ---------------------------------------------------------------------------
// Reading the levels of one clip
// ---------------------------------------------------------------------------

const near = (left: number, right: number, tolerance: number) => Math.abs(left - right) <= tolerance;

export function volumePropertyOf(effectId: string): Keyframe['property'] {
  return `effect.${effectId}.volume` as Keyframe['property'];
}

type ReadableClip = Pick<TimelineClip, 'duration' | 'effects' | 'audioState'>;

/**
 * Reads level, fades and mute. Fade shapes recognised: [0, L] (fade in), [L, 0] (fade out),
 * [0, L, L, 0] and [0, L, 0] (both fades meeting in the middle). Anything else is automation.
 * L may be 0 (silence): the sheet itself writes that shape when a fade is set and the level is
 * pulled to the bottom, and it must read it back as its own fade, not as drawn keyframes.
 */
export function readPhoneClipAudio(clip: ReadableClip, keyframes: readonly Keyframe[]): PhoneClipAudioReading {
  const effect = clip.effects.find((candidate) => candidate.type === 'audio-volume');
  const staticVolume = typeof effect?.params?.volume === 'number' && Number.isFinite(effect.params.volume)
    ? effect.params.volume
    : 1;
  const base: PhoneClipAudioReading = {
    volume: staticVolume,
    fadeIn: 0,
    fadeOut: 0,
    muted: clip.audioState?.muted === true,
    effectId: effect?.id ?? null,
    bypassed: effect ? effect.enabled === false : false,
    automation: false,
    duration: clip.duration,
  };
  if (!effect) return base;
  const property = volumePropertyOf(effect.id);
  const own = keyframes.filter((keyframe) => keyframe.property === property).toSorted((a, b) => a.time - b.time);
  if (own.length === 0) return base;

  const duration = clip.duration;
  const first = own[0];
  const last = own[own.length - 1];
  const startsSilent = own.length >= 2 && near(first.time, 0, TIME_TOLERANCE) && near(first.value, 0, VALUE_TOLERANCE);
  const endsSilent = own.length >= 2 && near(last.time, duration, TIME_TOLERANCE) && near(last.value, 0, VALUE_TOLERANCE);
  const plateau = own.slice(startsSilent ? 1 : 0, endsSilent ? own.length - 1 : own.length);
  const level = plateau[0]?.value;
  const flat = plateau.length >= 1 && plateau.length <= 2 && level !== undefined && level >= -VALUE_TOLERANCE
    && plateau.every((keyframe) => near(keyframe.value, level, VALUE_TOLERANCE));
  if (!flat || (!startsSilent && !endsSilent)) return { ...base, automation: true };
  // A fade-in plateau keyframe must sit in the first half, a fade-out one in the second half.
  const fadeIn = startsSilent ? plateau[0].time : 0;
  const fadeOut = endsSilent ? duration - plateau[plateau.length - 1].time : 0;
  if (fadeIn > duration / 2 + TIME_TOLERANCE || fadeOut > duration / 2 + TIME_TOLERANCE) return { ...base, automation: true };
  if (plateau.length === 2 && (!startsSilent || !endsSilent)) return { ...base, automation: true };
  return { ...base, volume: Math.max(0, level), fadeIn, fadeOut };
}

/** Levels shown for several clips: the first clip's reading (the sheet then sets all of them alike). */
export function summarisePhoneAudioReadings(readings: readonly PhoneClipAudioReading[]): {
  levels: PhoneAudioLevels; mixed: boolean; automation: boolean; bypassed: boolean; shortestDuration: number;
} {
  const first = readings[0];
  if (!first) return { levels: DEFAULT_PHONE_AUDIO_LEVELS, mixed: false, automation: false, bypassed: false, shortestDuration: 0 };
  const same = (reading: PhoneClipAudioReading) => near(reading.volume, first.volume, VALUE_TOLERANCE)
    && near(reading.fadeIn, first.fadeIn, TIME_TOLERANCE) && near(reading.fadeOut, first.fadeOut, TIME_TOLERANCE)
    && reading.muted === first.muted;
  return {
    levels: { volume: first.volume, fadeIn: first.fadeIn, fadeOut: first.fadeOut, muted: first.muted },
    mixed: !readings.every(same),
    automation: readings.some((reading) => reading.automation),
    bypassed: readings.some((reading) => reading.bypassed),
    shortestDuration: Math.min(...readings.map((reading) => reading.duration)),
  };
}

// ---------------------------------------------------------------------------
// Writing: the volume keyframes a set of levels means
// ---------------------------------------------------------------------------

/** Each fade is limited to half the clip (like the desktop fade handles). */
export function clampPhoneFade(seconds: number, duration: number): { seconds: number; clamped: boolean } {
  const limit = Math.max(0, duration / 2);
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return value > limit ? { seconds: limit, clamped: true } : { seconds: value, clamped: false };
}

export function planPhoneFadeKeyframes(levels: PhoneAudioLevels, duration: number): {
  keyframes: PhoneFadeKeyframe[]; fadeIn: number; fadeOut: number; clamped: boolean;
} {
  const fadeIn = clampPhoneFade(levels.fadeIn, duration);
  const fadeOut = clampPhoneFade(levels.fadeOut, duration);
  const keyframes: PhoneFadeKeyframe[] = [];
  const hasIn = fadeIn.seconds > PHONE_FADE_EPSILON;
  const hasOut = fadeOut.seconds > PHONE_FADE_EPSILON;
  // Easing per segment start, mirroring the desktop fade keyframe plan (fadeKeyframePlan.ts).
  if (hasIn) keyframes.push({ time: 0, value: 0, easing: 'ease-out' }, { time: fadeIn.seconds, value: levels.volume, easing: 'linear' });
  if (hasOut) {
    const outStart = duration - fadeOut.seconds;
    if (!(hasIn && near(outStart, fadeIn.seconds, 1e-6))) keyframes.push({ time: outStart, value: levels.volume, easing: 'ease-in' });
    else keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1], easing: 'ease-in' };
    keyframes.push({ time: duration, value: 0, easing: 'linear' });
  }
  return {
    keyframes,
    fadeIn: hasIn ? fadeIn.seconds : 0,
    fadeOut: hasOut ? fadeOut.seconds : 0,
    clamped: fadeIn.clamped || fadeOut.clamped,
  };
}

/** True when the existing volume keyframes already equal the plan (no write needed). */
export function fadeKeyframesMatch(existing: readonly Pick<Keyframe, 'time' | 'value' | 'easing'>[], planned: readonly PhoneFadeKeyframe[]): boolean {
  if (existing.length !== planned.length) return false;
  const sorted = existing.toSorted((a, b) => a.time - b.time);
  return sorted.every((keyframe, index) => near(keyframe.time, planned[index].time, 1e-6)
    && near(keyframe.value, planned[index].value, 1e-9)
    && (keyframe.easing ?? 'linear') === planned[index].easing);
}
