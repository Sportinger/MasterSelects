import { sha256ArrayBuffer } from '../../../../artifacts';
import type { JsonValue } from '../../../../signals';
import { createAudioAnalysisCacheKey } from '../../audioAnalysisManifestKeys';
import type { AudioArtifactStore } from '../../AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioChannelLayout } from '../../audioArtifactTypes';
import {
  SPEECH_MARKERS_PAYLOAD_VERSION,
  countSpeechMarkers,
  createSpeechMarkersManifest,
  encodeSpeechMarkersPayload,
  type SpeechMarker,
} from '../../speechMarkersManifest';

export const SPEECH_MARKERS_ANALYZER_VERSION =
  'masterselects.audio-intelligence.speech-markers@1.0.0';
export const SPEECH_MARKERS_PAYLOAD_MIME_TYPE =
  'application/vnd.masterselects.audio-speech-markers+json';

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export interface WriteSpeechMarkersArtifactInput {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  markers: readonly SpeechMarker[];
  sourceVoiceActivityArtifactId?: string;
  transcriptHash?: string;
  decoderId?: string;
  decoderVersion?: string;
}

async function deterministicArtifactId(cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return `audio:speech-markers:${hash}`;
}

export async function writeSpeechMarkersArtifact({
  artifactStore,
  mediaFileId,
  sourceFingerprint,
  clipAudioStateHash,
  sampleRate,
  channelLayout,
  duration,
  markers,
  sourceVoiceActivityArtifactId,
  transcriptHash,
  decoderId = DEFAULT_DECODER_ID,
  decoderVersion = DEFAULT_DECODER_VERSION,
}: WriteSpeechMarkersArtifactInput): Promise<AudioAnalysisArtifact> {
  const generatedAt = new Date().toISOString();
  const analyzerVersion = SPEECH_MARKERS_ANALYZER_VERSION;
  const cacheKey = createAudioAnalysisCacheKey({
    mediaFileId, sourceFingerprint, kind: 'speech-markers', analyzerVersion,
    channelLayout, sampleRate, duration, clipAudioStateHash,
  });
  const payloadBytes = encodeSpeechMarkersPayload({
    schemaVersion: SPEECH_MARKERS_PAYLOAD_VERSION,
    markers: [...markers],
  });
  const payloadRef = await artifactStore.putPayload(new Blob([payloadBytes], {
    type: SPEECH_MARKERS_PAYLOAD_MIME_TYPE,
  }), {
    mediaFileId,
    kind: 'speech-markers',
    sourceFingerprint,
    clipAudioStateHash,
    mimeType: SPEECH_MARKERS_PAYLOAD_MIME_TYPE,
    analyzerVersion,
    createdAt: generatedAt,
    metadata: {
      cacheKey,
      ...(sourceVoiceActivityArtifactId ? { sourceVoiceActivityArtifactId } : {}),
      ...(transcriptHash ? { transcriptHash } : {}),
    },
  });
  const manifest = createSpeechMarkersManifest({
    mediaFileId,
    sourceFingerprint,
    clipAudioStateHash,
    sampleRate,
    channelLayout,
    duration,
    markerCount: markers.length,
    counts: countSpeechMarkers(markers),
    payloadRef,
    sourceVoiceActivityArtifactId,
    transcriptHash,
  });
  const stored = await artifactStore.putAnalysisArtifact({
    id: await deterministicArtifactId(cacheKey),
    kind: 'speech-markers',
    mediaFileId,
    sourceFingerprint,
    clipAudioStateHash,
    decoderId,
    decoderVersion,
    analyzerVersion,
    sampleRate,
    channelLayout,
    duration,
    payloadRefs: [payloadRef],
    createdAt: Date.parse(generatedAt),
    stale: false,
    metadata: {
      analysisKind: 'speech-markers',
      cacheKey,
      ...(sourceVoiceActivityArtifactId ? { sourceVoiceActivityArtifactId } : {}),
      ...(transcriptHash ? { transcriptHash } : {}),
      speechMarkersManifest: manifest as unknown as JsonValue,
    },
  });
  return stored.artifact;
}
