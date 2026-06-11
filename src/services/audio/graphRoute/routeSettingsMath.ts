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
