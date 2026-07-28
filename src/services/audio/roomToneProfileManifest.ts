import type { AudioChannelLayout } from './audioArtifactTypes';

export const ROOM_TONE_PROFILE_MANIFEST_VERSION = 1 as const;

export interface RoomToneCandidate {
  start: number;
  end: number;
  rmsDb: number;
  variance: number;
  score: number;
}

export interface RoomToneNoiseFloor {
  rmsDbMedian: number;
  rmsDbP10: number;
  rmsDbP90: number;
}

export interface RoomToneProfileManifest {
  schemaVersion: typeof ROOM_TONE_PROFILE_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  // Ranked quiet regions usable as room-tone fill sources (best first).
  candidates: RoomToneCandidate[];
  noiseFloor: RoomToneNoiseFloor;
  bandLayout: 'third-octave';
  bandCentersHz: number[];
  // Average band energy in dB, same length/order as bandCentersHz.
  bandAverageDb: number[];
  sourceVoiceActivityArtifactId?: string;
}

export interface CreateRoomToneProfileManifestInput extends Omit<RoomToneProfileManifest, 'schemaVersion'> {
  schemaVersion?: typeof ROOM_TONE_PROFILE_MANIFEST_VERSION;
}

export function createRoomToneProfileManifest(
  input: CreateRoomToneProfileManifestInput,
): RoomToneProfileManifest {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  if (!Number.isFinite(input.duration) || input.duration < 0) {
    throw new Error('duration must be a non-negative finite number.');
  }
  if (input.bandLayout !== 'third-octave') {
    throw new Error(`Unsupported room tone band layout: ${String(input.bandLayout)}`);
  }
  if (input.bandCentersHz.length !== input.bandAverageDb.length) {
    throw new Error('bandCentersHz and bandAverageDb must have the same length.');
  }

  const candidates = input.candidates
    .map((candidate, index) => {
      if (!Number.isFinite(candidate.start) || !Number.isFinite(candidate.end)
        || candidate.end <= candidate.start) {
        throw new Error(`Room tone candidate at index ${index} must have a valid start/end range.`);
      }
      if (!Number.isFinite(candidate.rmsDb) || !Number.isFinite(candidate.variance)
        || !Number.isFinite(candidate.score)) {
        throw new Error(`Room tone candidate at index ${index} must have finite measurements.`);
      }
      return { ...candidate };
    })
    .toSorted((a, b) => b.score - a.score);

  return {
    schemaVersion: ROOM_TONE_PROFILE_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    candidates,
    noiseFloor: { ...input.noiseFloor },
    bandLayout: 'third-octave',
    bandCentersHz: [...input.bandCentersHz],
    bandAverageDb: [...input.bandAverageDb],
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
  };
}
