// Store writes of the phone Volume sheet. Every call SETS the absolute levels of one clip (level,
// fades, mute) through the editor's own actions - the desktop Volume tab's audio-volume effect,
// volume keyframes and setClipAudioMuted - so the result plays, exports and opens in /editor
// exactly like a desktop edit. Callers run it inside a phone edit session (one undo step).

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import {
  fadeKeyframesMatch,
  planPhoneFadeKeyframes,
  readPhoneClipAudio,
  volumePropertyOf,
  type PhoneAudioLevels,
  type PhoneClipAudioReading,
} from './phoneAudioLevels';

const log = Logger.create('PhoneVolume');
const LEVEL_TOLERANCE = 1e-9;

export function readPhoneClipAudioFromStore(clipId: string): PhoneClipAudioReading | null {
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  return clip ? readPhoneClipAudio(clip, state.clipKeyframes.get(clipId) ?? []) : null;
}

export interface PhoneLevelWriteResult {
  /** A fade was longer than half the clip and was shortened. */
  fadesClamped: boolean;
  /** The volume effect was bypassed in the full editor and has been switched back on. */
  reEnabled: boolean;
}

/**
 * Writes `levels` to one clip. Creates the audio-volume effect only when the level or a fade
 * needs it, so Done without a change leaves the clip untouched. Throws when the clip vanished.
 */
export function writePhoneClipAudioLevels(clipId: string, levels: PhoneAudioLevels): PhoneLevelWriteResult {
  const store = useTimelineStore.getState();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('the clip is no longer on the timeline');
  const reading = readPhoneClipAudio(clip, store.clipKeyframes.get(clipId) ?? []);
  if (reading.automation) throw new Error('this clip has drawn volume keyframes; edit them in the full editor');
  const plan = planPhoneFadeKeyframes(levels, clip.duration);
  const result: PhoneLevelWriteResult = { fadesClamped: plan.clamped, reEnabled: false };

  const needsEffect = reading.effectId !== null || Math.abs(levels.volume - 1) > LEVEL_TOLERANCE || plan.keyframes.length > 0;
  if (needsEffect) {
    const effectId = reading.effectId ?? store.addClipEffect(clipId, 'audio-volume');
    if (!effectId) throw new Error('the editor did not add a volume control to this clip');
    if (reading.bypassed) {
      store.setClipEffectEnabled(clipId, effectId, true);
      result.reEnabled = true;
    }
    const current = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)
      ?.effects.find((effect) => effect.id === effectId)?.params?.volume;
    if (typeof current !== 'number' || Math.abs(current - levels.volume) > LEVEL_TOLERANCE) {
      store.updateClipEffect(clipId, effectId, { volume: levels.volume });
    }
    const property = volumePropertyOf(effectId);
    const existing = (useTimelineStore.getState().clipKeyframes.get(clipId) ?? []).filter((keyframe) => keyframe.property === property);
    if (!fadeKeyframesMatch(existing, plan.keyframes)) {
      for (const keyframe of existing) useTimelineStore.getState().removeKeyframe(keyframe.id);
      for (const keyframe of plan.keyframes) {
        useTimelineStore.getState().addKeyframe(clipId, property, keyframe.value, keyframe.time, keyframe.easing);
      }
      const written = (useTimelineStore.getState().clipKeyframes.get(clipId) ?? []).filter((keyframe) => keyframe.property === property);
      if (!fadeKeyframesMatch(written, plan.keyframes)) {
        log.warn('Fade keyframes differ from the plan after writing', { clipId, planned: plan.keyframes, written });
        throw new Error('the editor did not accept the fades (is the track locked?)');
      }
    }
  }

  if (reading.muted !== levels.muted) {
    store.setClipAudioMuted(clipId, levels.muted);
    const muted = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)?.audioState?.muted === true;
    if (muted !== levels.muted) throw new Error('the editor did not change the mute state (is the track locked?)');
  }
  return result;
}

/** Writes the same levels to every target clip; collects what the UI should mention. */
export function writePhoneAudioLevels(clipIds: readonly string[], levels: PhoneAudioLevels): PhoneLevelWriteResult {
  const total: PhoneLevelWriteResult = { fadesClamped: false, reEnabled: false };
  for (const clipId of clipIds) {
    const result = writePhoneClipAudioLevels(clipId, levels);
    total.fadesClamped ||= result.fadesClamped;
    total.reEnabled ||= result.reEnabled;
  }
  return total;
}
