import { sha256ArrayBuffer } from '../../../../artifacts';
import type { JsonValue } from '../../../../signals';
import { createAudioAnalysisCacheKey } from '../../audioAnalysisManifestKeys';
import type { AudioArtifactStore } from '../../AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioChannelLayout } from '../../audioArtifactTypes';
import {
  DENSE_CURVE_PAYLOAD_VERSION,
  encodeDenseCurvePayload,
  type DenseCurveValueEncoding,
} from '../../denseCurvePayload';
import {
  createProsodyContourManifest,
  type ProsodyCurveRef,
  type ProsodyMetric,
} from '../../prosodyContourManifest';
import type { ProsodyAnalysisResult } from './prosodyAnalysis';

const MIME_TYPE = 'application/vnd.masterselects.audio-dense-curve';
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const ANALYZER_BASE_VERSION = 'masterselects.audio-intelligence.prosody@1.1.0';
const textEncoder = new TextEncoder();

export interface WriteProsodyContourArtifactInput {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  analysisSampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  result: ProsodyAnalysisResult;
  sourceVoiceActivityArtifactId?: string;
  decoderId?: string;
  decoderVersion?: string;
}

async function deterministicArtifactId(cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return `audio:prosody-contour:${hash}`;
}

export async function writeProsodyContourArtifact(
  input: WriteProsodyContourArtifactInput,
): Promise<AudioAnalysisArtifact> {
  const analyzerVersion = `${ANALYZER_BASE_VERSION}#hop=${input.result.hopSeconds}`;
  const generatedAt = new Date().toISOString();
  const cacheKey = createAudioAnalysisCacheKey({
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    kind: 'prosody-contour',
    analyzerVersion,
    channelLayout: input.channelLayout,
    sampleRate: input.sampleRate,
    duration: input.duration,
    clipAudioStateHash: input.clipAudioStateHash,
  });
  const definitions: {
    metric: ProsodyMetric;
    encoding: DenseCurveValueEncoding;
    values: Float32Array;
  }[] = [
    { metric: 'f0-hz', encoding: 'hz', values: input.result.f0Hz },
    { metric: 'voicing', encoding: 'unit', values: input.result.voicing },
    { metric: 'energy-rms-db', encoding: 'db', values: input.result.energyRmsDb },
    { metric: 'speech-rate-sps', encoding: 'per-second', values: input.result.speechRateSps },
  ];

  const curves: ProsodyCurveRef[] = [];
  for (const definition of definitions) {
    const payload = encodeDenseCurvePayload({
      header: {
        schemaVersion: DENSE_CURVE_PAYLOAD_VERSION,
        metric: definition.metric,
        windowDuration: input.result.windowSeconds,
        hopDuration: input.result.hopSeconds,
        pointCount: definition.values.length,
        valueLayout: 'time-series',
        valueEncoding: definition.encoding,
      },
      values: definition.values,
    });
    const payloadRef = await input.artifactStore.putPayload(new Blob([payload], {
      type: MIME_TYPE,
    }), {
      mediaFileId: input.mediaFileId,
      kind: 'prosody-contour',
      sourceFingerprint: input.sourceFingerprint,
      clipAudioStateHash: input.clipAudioStateHash,
      mimeType: MIME_TYPE,
      analyzerVersion,
      createdAt: generatedAt,
      metadata: { cacheKey, metric: definition.metric },
    });
    curves.push({
      metric: definition.metric,
      windowDuration: input.result.windowSeconds,
      hopDuration: input.result.hopSeconds,
      pointCount: definition.values.length,
      payloadRef,
    });
  }

  const manifest = createProsodyContourManifest({
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    analysisSampleRate: input.analysisSampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    curves,
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
    summary: input.result.summary,
    wordEmphasis: input.result.wordEmphasis,
  });
  const artifactId = await deterministicArtifactId(cacheKey);
  const stored = await input.artifactStore.putAnalysisArtifact({
    id: artifactId,
    kind: 'prosody-contour',
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    decoderId: input.decoderId ?? DEFAULT_DECODER_ID,
    decoderVersion: input.decoderVersion ?? DEFAULT_DECODER_VERSION,
    analyzerVersion,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    payloadRefs: curves.map((curve) => curve.payloadRef),
    createdAt: Date.parse(generatedAt),
    stale: false,
    metadata: {
      analysisKind: 'prosody-contour',
      cacheKey,
      prosodyContourManifest: manifest as unknown as JsonValue,
    },
  });
  return stored.artifact;
}
