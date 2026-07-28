import { blobToArrayBuffer, sha256ArrayBuffer } from '../../../artifacts';
import type { JsonValue, SignalMetadata } from '../../../signals';
import {
  createAudioAnalysisCacheKey,
  isAudioAnalysisArtifactStaleForInput,
  type AudioAnalysisCacheKeyInput,
} from '../audioAnalysisManifestKeys';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioChannelLayout } from '../audioArtifactTypes';
import {
  AUDIO_SPAN_LIST_PAYLOAD_VERSION,
  VOICE_ACTIVITY_MANIFEST_VERSION,
  createVoiceActivityManifest,
  decodeAudioSpanListPayload,
  encodeAudioSpanListPayload,
  float32ToSpans,
  spansToFloat32,
  type AudioSpan,
  type VoiceActivityConfig,
} from '../voiceActivityManifest';
import {
  decodeTranscriptTimingPayload,
  payloadToTimings,
  type AlignedWordTiming,
} from '../transcriptTimingManifest';
import { TRANSCRIPT_TIMING_ANALYZER_VERSION } from './alignment/transcriptTimingWriter';
import { requireAudioIntelligenceModel } from './audioIntelligenceModelCatalog';
import { AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE } from './audioIntelligenceTypes';
import { SPEECH_MARKERS_ANALYZER_VERSION } from './speechMarkers/speechMarkersWriter';
import { ROOM_TONE_PROFILE_ANALYZER_VERSION } from './roomTone/roomToneWriter';

export const AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION =
  'masterselects.audio-intelligence.vad@1.0.0+silero-v5.1.2';
export const AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.audio-span-list';
export const PROSODY_ANALYZER_BASE_VERSION = 'masterselects.audio-intelligence.prosody@1.1.0';

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export interface AudioPersistenceContext {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  duration: number;
  channelLayout: AudioChannelLayout;
  sourceChannelLayout: AudioChannelLayout;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export function createAudioIntelligenceVadAnalyzerVersion(
  config: VoiceActivityConfig,
  baseVersion = AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION,
): string {
  const model = requireAudioIntelligenceModel('silero-vad');
  return [
    baseVersion,
    `manifest=v${VOICE_ACTIVITY_MANIFEST_VERSION}`,
    `payload=v${AUDIO_SPAN_LIST_PAYLOAD_VERSION}`,
    `model=${model.id}@${model.version}`,
    `threshold=${config.threshold}`,
    `negThreshold=${config.negThreshold}`,
    `minSpeechMs=${config.minSpeechMs}`,
    `minSilenceMs=${config.minSilenceMs}`,
    `padMs=${config.padMs}`,
    `frame=${config.frameSamples}`,
    `rate=${AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE}`,
    'channels=mono-ch0',
  ].join(';');
}

export function prosodyAnalyzerVersion(hopSeconds: number): string {
  return `${PROSODY_ANALYZER_BASE_VERSION}#hop=${hopSeconds}`;
}

export function analysisCacheInput(
  context: AudioPersistenceContext,
  kind: AudioAnalysisCacheKeyInput['kind'],
  sourceFingerprint: string,
  analyzerVersion: string,
): AudioAnalysisCacheKeyInput {
  return {
    mediaFileId: context.mediaFileId,
    sourceFingerprint,
    kind,
    analyzerVersion,
    channelLayout: context.channelLayout,
    sampleRate: context.sampleRate,
    duration: context.duration,
    clipAudioStateHash: context.clipAudioStateHash,
  };
}

export async function findFreshAudioArtifact(
  context: AudioPersistenceContext,
  kind: AudioAnalysisCacheKeyInput['kind'],
  sourceFingerprint: string,
  analyzerVersion: string,
): Promise<AudioAnalysisArtifact | undefined> {
  const artifacts = await context.artifactStore.listAnalysisArtifacts(context.mediaFileId, kind);
  const input = analysisCacheInput(context, kind, sourceFingerprint, analyzerVersion);
  return artifacts.find(artifact => !isAudioAnalysisArtifactStaleForInput(artifact, input));
}

function summarizeSpans(spans: readonly AudioSpan[], duration: number) {
  const speechSeconds = spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);
  return {
    speechSeconds,
    speechRatio: duration > 0 ? Math.min(1, speechSeconds / duration) : 0,
    segmentCount: spans.length,
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return `${prefix}:${await sha256ArrayBuffer(buffer)}`;
}

export async function writeVoiceActivityArtifact(
  context: AudioPersistenceContext,
  input: {
    segments: readonly AudioSpan[];
    config: VoiceActivityConfig;
    analyzerVersion: string;
    generatedAt: string;
    checkCancelled?: () => void;
  },
): Promise<AudioAnalysisArtifact> {
  const cacheInput = analysisCacheInput(
    context,
    'voice-activity',
    context.sourceFingerprint,
    input.analyzerVersion,
  );
  const cacheKey = createAudioAnalysisCacheKey(cacheInput);
  const payloadBytes = encodeAudioSpanListPayload({
    header: {
      schemaVersion: AUDIO_SPAN_LIST_PAYLOAD_VERSION,
      kind: 'voice-activity-segments',
      spanCount: input.segments.length,
      valueLayout: 'span-major',
      valueEncoding: 'start-end-confidence-f32',
      timeUnit: 'seconds',
    },
    values: spansToFloat32(input.segments),
  });
  const payloadRef = await context.artifactStore.putPayload(new Blob([payloadBytes], {
    type: AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
  }), {
    mediaFileId: context.mediaFileId,
    kind: 'voice-activity',
    sourceFingerprint: context.sourceFingerprint,
    clipAudioStateHash: context.clipAudioStateHash,
    mimeType: AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
    analyzerVersion: input.analyzerVersion,
    createdAt: input.generatedAt,
    metadata: { cacheKey },
  });
  input.checkCancelled?.();
  const model = requireAudioIntelligenceModel('silero-vad');
  const manifest = createVoiceActivityManifest({
    mediaFileId: context.mediaFileId,
    sourceFingerprint: context.sourceFingerprint,
    clipAudioStateHash: context.clipAudioStateHash,
    sampleRate: context.sampleRate,
    analysisSampleRate: AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
    channelLayout: context.channelLayout,
    duration: context.duration,
    model: { id: model.id, version: model.version },
    config: input.config,
    segmentCount: input.segments.length,
    segmentsPayloadRef: payloadRef,
    summary: summarizeSpans(input.segments, context.duration),
  });
  const stored = await context.artifactStore.putAnalysisArtifact({
    id: await deterministicHashId('audio:voice-activity', cacheKey),
    kind: 'voice-activity',
    mediaFileId: context.mediaFileId,
    sourceFingerprint: context.sourceFingerprint,
    clipAudioStateHash: context.clipAudioStateHash,
    decoderId: context.decoderId ?? DEFAULT_DECODER_ID,
    decoderVersion: context.decoderVersion ?? DEFAULT_DECODER_VERSION,
    analyzerVersion: input.analyzerVersion,
    sampleRate: context.sampleRate,
    channelLayout: context.channelLayout,
    duration: context.duration,
    payloadRefs: [payloadRef],
    createdAt: Date.parse(input.generatedAt),
    stale: false,
    metadata: {
      ...(context.metadata ?? {}),
      analysisKind: 'voice-activity',
      cacheKey,
      sourceChannelLayout: context.sourceChannelLayout as unknown as JsonValue,
      voiceActivityManifest: manifest as unknown as JsonValue,
    },
  });
  input.checkCancelled?.();
  return stored.artifact;
}

async function readFirstPayload(
  store: AudioArtifactStore,
  artifact: AudioAnalysisArtifact,
): Promise<ArrayBuffer> {
  const ref = artifact.payloadRefs[0];
  if (!ref) throw new Error(`${artifact.kind} artifact ${artifact.id} has no payload.`);
  const blob = await store.getPayload(ref.artifactId);
  if (!blob) throw new Error(`${artifact.kind} payload ${ref.artifactId} is unavailable.`);
  return blobToArrayBuffer(blob);
}

export async function readVoiceActivitySegments(
  store: AudioArtifactStore,
  artifact: AudioAnalysisArtifact,
): Promise<AudioSpan[]> {
  const payload = decodeAudioSpanListPayload(await readFirstPayload(store, artifact));
  return float32ToSpans(payload.values);
}

export async function readAlignedWordTimings(
  store: AudioArtifactStore,
  artifact: AudioAnalysisArtifact,
): Promise<AlignedWordTiming[]> {
  return payloadToTimings(decodeTranscriptTimingPayload(await readFirstPayload(store, artifact)));
}

export const AUDIO_INTELLIGENCE_STAGE_ANALYZERS = {
  alignment: TRANSCRIPT_TIMING_ANALYZER_VERSION,
  speechMarkers: SPEECH_MARKERS_ANALYZER_VERSION,
  roomTone: ROOM_TONE_PROFILE_ANALYZER_VERSION,
} as const;
