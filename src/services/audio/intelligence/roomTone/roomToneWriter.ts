import type { JsonValue } from '../../../../signals';
import type { AudioArtifactStore } from '../../AudioArtifactStore';
import {
  createAudioArtifactId,
  type AudioAnalysisArtifact,
  type AudioChannelLayout,
} from '../../audioArtifactTypes';
import { createRoomToneProfileManifest } from '../../roomToneProfileManifest';
import type { RoomToneProfileResult } from './roomToneProfiler';

export const ROOM_TONE_PROFILE_ANALYZER_VERSION =
  'masterselects.audio-intelligence.room-tone@1.0.0';

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';

export interface WriteRoomToneProfileArtifactInput {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  result: RoomToneProfileResult;
  sourceVoiceActivityArtifactId?: string;
  decoderId?: string;
  decoderVersion?: string;
}

export async function writeRoomToneProfileArtifact({
  artifactStore,
  mediaFileId,
  sourceFingerprint,
  clipAudioStateHash,
  sampleRate,
  channelLayout,
  duration,
  result,
  sourceVoiceActivityArtifactId,
  decoderId = DEFAULT_DECODER_ID,
  decoderVersion = DEFAULT_DECODER_VERSION,
}: WriteRoomToneProfileArtifactInput): Promise<AudioAnalysisArtifact> {
  const manifest = createRoomToneProfileManifest({
    mediaFileId,
    sourceFingerprint,
    clipAudioStateHash,
    sampleRate,
    channelLayout,
    duration,
    candidates: result.candidates,
    noiseFloor: result.noiseFloor,
    bandLayout: 'third-octave',
    bandCentersHz: result.bandCentersHz,
    bandAverageDb: result.bandAverageDb,
    sourceVoiceActivityArtifactId,
  });
  const stored = await artifactStore.putAnalysisArtifact({
    id: createAudioArtifactId(
      'room-tone-profile', mediaFileId, sourceFingerprint, clipAudioStateHash,
    ),
    kind: 'room-tone-profile',
    mediaFileId,
    sourceFingerprint,
    clipAudioStateHash,
    decoderId,
    decoderVersion,
    analyzerVersion: ROOM_TONE_PROFILE_ANALYZER_VERSION,
    sampleRate,
    channelLayout,
    duration,
    payloadRefs: [],
    createdAt: Date.now(),
    stale: false,
    metadata: {
      analysisKind: 'room-tone-profile',
      roomToneProfileManifest: manifest as unknown as JsonValue,
    },
  });
  return stored.artifact;
}
