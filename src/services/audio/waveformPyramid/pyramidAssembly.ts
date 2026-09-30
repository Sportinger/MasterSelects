import {
  DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  WAVEFORM_PACKED_PAYLOAD_VERSION,
  WAVEFORM_PYRAMID_MANIFEST_VERSION,
  WAVEFORM_STAT_PAYLOAD_VERSION,
  type WaveformPyramidData,
  type WaveformStatistic,
} from '../waveformPyramidManifest';
import { normalizeBucketSizes } from './bucketMath';
import { analyzeWaveformInWorker } from './WaveformWorkerClient';
import type { WaveformWorkerResult } from './waveformWorkerProtocol';
import type {
  WaveformLevelStats,
  WaveformPyramidAnalysisContext,
} from './waveformPyramidAnalysisTypes';

export const WAVEFORM_STATISTICS = ['min', 'max', 'rms', 'peak'] as const satisfies readonly WaveformStatistic[];

export function createWaveformPyramidAnalyzerVersion(
  bucketSizes: readonly number[] = DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  baseVersion: string,
): string {
  const levels = normalizeBucketSizes(bucketSizes).join(',');
  return [
    baseVersion,
    `manifest=v${WAVEFORM_PYRAMID_MANIFEST_VERSION}`,
    `packedPayload=v${WAVEFORM_PACKED_PAYLOAD_VERSION}`,
    `legacyPayload=v${WAVEFORM_STAT_PAYLOAD_VERSION}`,
    `stats=${WAVEFORM_STATISTICS.join(',')}`,
    `levels=${levels}`,
  ].join(';');
}

export function createPyramidDataFromLevelStats(
  sampleRate: number,
  duration: number,
  levels: readonly WaveformLevelStats[],
): WaveformPyramidData {
  return {
    sampleRate,
    duration,
    levels: levels.map(level => ({
      samplesPerBucket: level.samplesPerBucket,
      bucketDuration: level.bucketDuration,
      bucketCount: level.bucketCount,
      channels: level.channels.map(channel => ({
        channelIndex: channel.channelIndex,
        min: channel.min,
        max: channel.max,
        rms: channel.rms,
        peak: channel.peak,
      })),
    })),
  };
}

export async function generateWaveformLevelStats(input: {
  buffer: AudioBuffer;
  bucketSizes: readonly number[];
  context: WaveformPyramidAnalysisContext;
  now: () => string;
  emitProgress: (context: WaveformPyramidAnalysisContext, update: {
    phase: 'analyzing';
    percent: number;
    timestamp: string;
    levelIndex: number;
    channelIndex: number;
    samplesPerBucket: number;
    message: string;
  }) => void;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<WaveformWorkerResult> {
  input.throwIfCancelled(input.context.signal, input.context.jobId);
  const result = await analyzeWaveformInWorker(input.buffer, {
    bucketSizes: input.bucketSizes,
    signal: input.context.signal,
    onAnalysisProgress: progress => input.emitProgress(input.context, {
      phase: 'analyzing', percent: progress.percent, timestamp: input.now(),
      levelIndex: progress.levelIndex, channelIndex: progress.channelIndex,
      samplesPerBucket: progress.samplesPerBucket, message: 'Analyzing waveform buckets',
    }),
  });
  input.throwIfCancelled(input.context.signal, input.context.jobId);
  return result;
}
