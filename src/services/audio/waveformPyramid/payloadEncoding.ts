import { sha256ArrayBuffer } from '../../../artifacts';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import type {
  AudioAnalysisArtifactKind,
  AudioAnalysisWarning,
  AudioArtifactRef,
} from '../audioArtifactTypes';
import {
  WAVEFORM_PACKED_PAYLOAD_VERSION,
  encodeWaveformPyramidPackedPayload,
  type WaveformPyramidData,
  type WaveformPyramidLevelManifest,
} from '../waveformPyramidManifest';
import type { WaveformPyramidAnalysisContext } from './waveformPyramidAnalysisTypes';

export const WAVEFORM_PACKED_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.waveform-pyramid-packed';

const textEncoder = new TextEncoder();

export async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export async function storeWaveformPyramidPayloads(input: {
  artifactStore: AudioArtifactStore;
  request: {
    kind?: Extract<AudioAnalysisArtifactKind, 'waveform-pyramid' | 'processed-waveform-pyramid'>;
    mediaFileId: string;
    sourceFingerprint: string;
    clipAudioStateHash?: string;
  };
  analyzerVersion: string;
  generatedAt: string;
  context: WaveformPyramidAnalysisContext;
  pyramid: WaveformPyramidData;
  now: () => string;
  emitProgress: (context: WaveformPyramidAnalysisContext, update: {
    phase: 'storing-payloads';
    percent: number;
    timestamp: string;
    message: string;
  }) => void;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<{
  levels: WaveformPyramidLevelManifest[];
  payloadRefs: AudioArtifactRef[];
  packedPayload: AudioArtifactRef;
  warnings: AudioAnalysisWarning[];
}> {
  input.emitProgress(input.context, {
    phase: 'storing-payloads',
    percent: 86,
    timestamp: input.now(),
    message: 'Storing packed waveform pyramid payload',
  });
  input.throwIfCancelled(input.context.signal, input.context.jobId);

  const packedPayload = await input.artifactStore.putPayload(
    encodeWaveformPyramidPackedPayload(input.pyramid),
    {
      mediaFileId: input.request.mediaFileId,
      kind: input.request.kind ?? 'waveform-pyramid',
      sourceFingerprint: input.request.sourceFingerprint,
      clipAudioStateHash: input.request.clipAudioStateHash,
      mimeType: WAVEFORM_PACKED_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion: input.analyzerVersion,
      createdAt: input.generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.context.cacheKey}`],
      metadata: {
        cacheKey: input.context.cacheKey,
        payloadLayout: 'packed-pyramid',
        packedPayloadVersion: WAVEFORM_PACKED_PAYLOAD_VERSION,
        levelCount: input.pyramid.levels.length,
        channelCount: input.pyramid.levels[0]?.channels.length ?? 0,
      },
    },
  );
  const levels: WaveformPyramidLevelManifest[] = input.pyramid.levels.map(level => ({
    samplesPerBucket: level.samplesPerBucket,
    bucketDuration: level.bucketDuration,
    bucketCount: level.bucketCount,
    channels: level.channels.map(channel => ({
      channelIndex: channel.channelIndex,
    })),
  }));

  return {
    levels,
    payloadRefs: [packedPayload],
    packedPayload,
    warnings: [],
  };
}
