import { AUDIO_EQ_BAND_PARAMS } from '../../../engine/audio/AudioEffectRegistry';
import { clampAudioPan, finiteNumber, volumeDbToLinearGain } from '../../../engine/audio/audioMath';
import type { TimelineTrack } from '../../nodeGraph/clipGraphProjectionDomain';
import { getRuntimeTrackVolumeDbOverride } from '../runtimeAudioParamOverrides';
import type { AudioRouteEffectSettings } from './routeSettingsModel';

export function createNeutralEffectSettings(): AudioRouteEffectSettings {
  return {
    volume: 1,
    eqGains: new Array(AUDIO_EQ_BAND_PARAMS.length).fill(0),
    processors: [],
  };
}

export function mergeEffectSettings(
  target: AudioRouteEffectSettings,
  source: AudioRouteEffectSettings,
): void {
  target.volume *= source.volume;
  for (let index = 0; index < target.eqGains.length; index += 1) {
    target.eqGains[index] += source.eqGains[index] ?? 0;
  }
  target.processors.push(...source.processors);
}

export function getTrackAudioMuted(track: TimelineTrack): boolean {
  return track.audioState?.muted ?? track.muted === true;
}

export function getTrackAudioSolo(track: TimelineTrack): boolean {
  return track.audioState?.solo ?? track.solo === true;
}

/**
 * Tracks that produce audible output. MIDI tracks (issue #182) play through the
 * synth, so for mute/solo they form one group with audio tracks: soloing a MIDI
 * track must silence audio tracks and vice versa (issue #260). Score tracks
 * (issue #366) join the same group so their header M/S buttons behave like the
 * other musical lanes, even though they emit no audio yet. Video solo stays a
 * separate, visual-only group.
 */
export function isAudibleTrack(track: Pick<TimelineTrack, 'type'>): boolean {
  return track.type === 'audio' || track.type === 'midi' || track.type === 'score';
}

/** True when any audible (audio or MIDI) track is soloed. */
export function hasAnyAudibleSolo(tracks: readonly TimelineTrack[]): boolean {
  return tracks.some(track => isAudibleTrack(track) && getTrackAudioSolo(track));
}

export function getTrackVolumeDb(track: TimelineTrack): number {
  const runtimeVolumeDb = getRuntimeTrackVolumeDbOverride(track.id);
  if (runtimeVolumeDb !== undefined) return runtimeVolumeDb;
  return finiteNumber(track.audioState?.volumeDb, 0);
}

export function getTrackPan(track: TimelineTrack): number {
  return clampAudioPan(track.audioState?.pan);
}

export function getTrackLinearVolume(track: TimelineTrack): number {
  return volumeDbToLinearGain(getTrackVolumeDb(track));
}

export function getTrackSendReturnGain(track: TimelineTrack, trackVolume: number): number {
  return (track.audioState?.sends ?? []).reduce((total, send) => {
    if (send.enabled === false) return total;
    const sendGain = volumeDbToLinearGain(send.gainDb);
    const faderGain = send.preFader ? 1 : trackVolume;
    return total + sendGain * faderGain;
  }, 0);
}
