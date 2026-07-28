import { sha256ArrayBuffer } from '../../../../artifacts';
import type { JsonValue } from '../../../../signals';
import type { TranscriptAlignmentMethod } from '../../../../types/clipMetadata';
import type { AudioArtifactStore } from '../../AudioArtifactStore';
import { createAudioAnalysisCacheKey } from '../../audioAnalysisManifestKeys';
import type { AudioAnalysisArtifact, AudioChannelLayout } from '../../audioArtifactTypes';
import {
  createTranscriptTimingFingerprint,
  createTranscriptTimingManifest,
  encodeTranscriptTimingPayload,
  timingsToPayload,
  type AlignedWordTiming,
} from '../../transcriptTimingManifest';

export const TRANSCRIPT_TIMING_ANALYZER_VERSION =
  'masterselects.audio-intelligence.alignment@1.0.0';
export const TRANSCRIPT_TIMING_PAYLOAD_MIME_TYPE =
  'application/vnd.masterselects.transcript-timing';

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';

export interface WriteTranscriptTimingInput {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  audioFingerprint: string;
  transcriptHash: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  timings: readonly AlignedWordTiming[];
  method: TranscriptAlignmentMethod;
  sourceVoiceActivityArtifactId?: string;
  decoderId?: string;
  decoderVersion?: string;
}

async function deterministicArtifactId(cacheKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(cacheKey);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return `audio:transcript-timing:${await sha256ArrayBuffer(buffer)}`;
}

export async function writeTranscriptTimingArtifact(
  input: WriteTranscriptTimingInput,
): Promise<AudioAnalysisArtifact> {
  const sourceFingerprint = createTranscriptTimingFingerprint(
    input.audioFingerprint,
    input.transcriptHash,
  );
  const cacheKey = createAudioAnalysisCacheKey({
    mediaFileId: input.mediaFileId,
    sourceFingerprint,
    kind: 'transcript-timing',
    analyzerVersion: TRANSCRIPT_TIMING_ANALYZER_VERSION,
    channelLayout: input.channelLayout,
    sampleRate: input.sampleRate,
    duration: input.duration,
    clipAudioStateHash: input.clipAudioStateHash,
  });
  const createdAt = new Date().toISOString();
  const payloadBytes = encodeTranscriptTimingPayload(
    timingsToPayload(input.timings, input.method),
  );
  const payloadRef = await input.artifactStore.putPayload(
    new Blob([payloadBytes], { type: TRANSCRIPT_TIMING_PAYLOAD_MIME_TYPE }),
    {
      mediaFileId: input.mediaFileId,
      kind: 'transcript-timing',
      sourceFingerprint,
      clipAudioStateHash: input.clipAudioStateHash,
      mimeType: TRANSCRIPT_TIMING_PAYLOAD_MIME_TYPE,
      analyzerVersion: TRANSCRIPT_TIMING_ANALYZER_VERSION,
      createdAt,
      metadata: { cacheKey },
    },
  );

  const refinedWordCount = input.timings.filter(timing => timing.confidence > 0.3).length;
  const manifest = createTranscriptTimingManifest({
    mediaFileId: input.mediaFileId,
    sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    method: input.method,
    transcriptHash: input.transcriptHash,
    wordCount: input.timings.length,
    timingsPayloadRef: payloadRef,
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
    summary: {
      meanShiftMs: 0,
      refinedWordRatio: input.timings.length > 0
        ? refinedWordCount / input.timings.length
        : 0,
    },
  });
  const stored = await input.artifactStore.putAnalysisArtifact({
    id: await deterministicArtifactId(cacheKey),
    kind: 'transcript-timing',
    mediaFileId: input.mediaFileId,
    sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    decoderId: input.decoderId ?? DEFAULT_DECODER_ID,
    decoderVersion: input.decoderVersion ?? DEFAULT_DECODER_VERSION,
    analyzerVersion: TRANSCRIPT_TIMING_ANALYZER_VERSION,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    payloadRefs: [payloadRef],
    createdAt: Date.parse(createdAt),
    stale: false,
    metadata: {
      analysisKind: 'transcript-timing',
      cacheKey,
      transcriptTimingManifest: manifest as unknown as JsonValue,
    },
  });
  return stored.artifact;
}
