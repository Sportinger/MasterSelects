import {
  DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  WAVEFORM_PACKED_PAYLOAD_VERSION,
  WAVEFORM_PYRAMID_MANIFEST_VERSION,
  WAVEFORM_STAT_PAYLOAD_VERSION,
  type WaveformPyramidData,
  type WaveformStatistic,
} from '../waveformPyramidManifest';
import { aggregateChannelStats, calculateChannelStats, normalizeBucketSizes } from './bucketMath';
import type {
  WaveformChannelStats,
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
}): Promise<WaveformLevelStats[]> {
  const workUnits = input.bucketSizes.length * input.buffer.numberOfChannels;
  let completedUnits = 0;
  const levels: WaveformLevelStats[] = input.bucketSizes.map(samplesPerBucket => ({
    samplesPerBucket,
    bucketDuration: samplesPerBucket / input.buffer.sampleRate,
    bucketCount: Math.ceil(input.buffer.length / samplesPerBucket),
    channels: [],
  }));

  for (let channelIndex = 0; channelIndex < input.buffer.numberOfChannels; channelIndex += 1) {
    const channelData = input.buffer.getChannelData(channelIndex);
    let previousStats: WaveformChannelStats | null = null;
    let previousSamplesPerBucket = 0;

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex];
      const samplesPerBucket = level.samplesPerBucket;
      input.emitProgress(input.context, {
        phase: 'analyzing',
        percent: 5 + (completedUnits / workUnits) * 70,
        timestamp: input.now(),
        levelIndex,
        channelIndex,
        samplesPerBucket,
        message: 'Analyzing waveform buckets',
      });
      input.throwIfCancelled(input.context.signal, input.context.jobId);

      let channelStats: WaveformChannelStats;

      if (
        previousStats !== null
        && previousSamplesPerBucket > 0
        && samplesPerBucket % previousSamplesPerBucket === 0
      ) {
        channelStats = await aggregateChannelStats(
          previousStats,
          previousSamplesPerBucket,
          input.buffer.length,
          samplesPerBucket,
          input.context,
          input.throwIfCancelled,
        );
      } else {
        channelStats = await calculateChannelStats(
          channelData,
          input.buffer.length,
          samplesPerBucket,
          channelIndex,
          input.context,
          input.throwIfCancelled,
        );
      }

      level.channels.push(channelStats);
      previousStats = channelStats;
      previousSamplesPerBucket = samplesPerBucket;
      completedUnits += 1;
    }
  }

  return levels;
}
