import type {
  WaveformChannelStats,
  WaveformPyramidAnalysisContext,
} from './waveformPyramidAnalysisTypes';

const ANALYSIS_YIELD_SAMPLE_BUDGET = 262_144;

function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

export function normalizeBucketSizes(bucketSizes: readonly number[]): number[] {
  const normalized = [...new Set(bucketSizes)]
    .toSorted((a, b) => a - b);

  if (normalized.length === 0) {
    throw new Error('Waveform pyramid generation requires at least one bucket size.');
  }

  for (const samplesPerBucket of normalized) {
    if (!Number.isInteger(samplesPerBucket) || samplesPerBucket < 1) {
      throw new Error('Waveform pyramid bucket sizes must be positive integers.');
    }
  }

  return normalized;
}

export async function calculateChannelStats(
  data: Float32Array,
  bufferLength: number,
  samplesPerBucket: number,
  channelIndex: number,
  context: WaveformPyramidAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): Promise<WaveformChannelStats> {
  const bucketCount = Math.ceil(bufferLength / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  const rms = new Float32Array(bucketCount);
  const peak = new Float32Array(bucketCount);
  let samplesSinceYield = 0;

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    throwIfCancelled(context.signal, context.jobId);

    const start = bucketIndex * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, bufferLength, data.length);
    let bucketMin = Number.POSITIVE_INFINITY;
    let bucketMax = Number.NEGATIVE_INFINITY;
    let bucketPeak = 0;
    let squareSum = 0;
    const count = Math.max(0, end - start);

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = safeSample(data[sampleIndex] ?? 0);
      bucketMin = Math.min(bucketMin, sample);
      bucketMax = Math.max(bucketMax, sample);
      bucketPeak = Math.max(bucketPeak, Math.abs(sample));
      squareSum += sample * sample;
    }

    min[bucketIndex] = count > 0 ? bucketMin : 0;
    max[bucketIndex] = count > 0 ? bucketMax : 0;
    rms[bucketIndex] = count > 0 ? Math.sqrt(squareSum / count) : 0;
    peak[bucketIndex] = bucketPeak;
    samplesSinceYield += count;

    if (samplesSinceYield >= ANALYSIS_YIELD_SAMPLE_BUDGET) {
      await yieldToMainThread();
      samplesSinceYield = 0;
      throwIfCancelled(context.signal, context.jobId);
    }
  }

  return { channelIndex, min, max, rms, peak };
}

export async function aggregateChannelStats(
  source: WaveformChannelStats,
  sourceSamplesPerBucket: number,
  bufferLength: number,
  samplesPerBucket: number,
  context: WaveformPyramidAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): Promise<WaveformChannelStats> {
  const bucketCount = Math.ceil(bufferLength / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  const rms = new Float32Array(bucketCount);
  const peak = new Float32Array(bucketCount);
  let sourceBucketsSinceYield = 0;

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    throwIfCancelled(context.signal, context.jobId);

    const startSample = bucketIndex * samplesPerBucket;
    const endSample = Math.min(startSample + samplesPerBucket, bufferLength);
    const startSourceBucket = Math.floor(startSample / sourceSamplesPerBucket);
    const endSourceBucket = Math.ceil(endSample / sourceSamplesPerBucket);
    let bucketMin = Number.POSITIVE_INFINITY;
    let bucketMax = Number.NEGATIVE_INFINITY;
    let bucketPeak = 0;
    let squareSum = 0;
    let sampleCount = 0;

    for (let sourceBucketIndex = startSourceBucket; sourceBucketIndex < endSourceBucket; sourceBucketIndex += 1) {
      const sourceStart = sourceBucketIndex * sourceSamplesPerBucket;
      const sourceEnd = Math.min(sourceStart + sourceSamplesPerBucket, bufferLength);
      const sourceSampleCount = Math.max(0, sourceEnd - sourceStart);
      if (sourceSampleCount <= 0) continue;

      const sourceMin = safeSample(source.min[sourceBucketIndex] ?? 0);
      const sourceMax = safeSample(source.max[sourceBucketIndex] ?? 0);
      const sourcePeak = Math.abs(safeSample(source.peak[sourceBucketIndex] ?? 0));
      const sourceRms = Math.abs(safeSample(source.rms[sourceBucketIndex] ?? 0));

      bucketMin = sampleCount === 0 ? sourceMin : Math.min(bucketMin, sourceMin);
      bucketMax = sampleCount === 0 ? sourceMax : Math.max(bucketMax, sourceMax);
      bucketPeak = Math.max(bucketPeak, sourcePeak, Math.abs(sourceMin), Math.abs(sourceMax));
      squareSum += sourceRms * sourceRms * sourceSampleCount;
      sampleCount += sourceSampleCount;
      sourceBucketsSinceYield += 1;
    }

    min[bucketIndex] = sampleCount > 0 ? bucketMin : 0;
    max[bucketIndex] = sampleCount > 0 ? bucketMax : 0;
    rms[bucketIndex] = sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0;
    peak[bucketIndex] = bucketPeak;

    if (sourceBucketsSinceYield >= ANALYSIS_YIELD_SAMPLE_BUDGET) {
      await yieldToMainThread();
      sourceBucketsSinceYield = 0;
      throwIfCancelled(context.signal, context.jobId);
    }
  }

  return {
    channelIndex: source.channelIndex,
    min,
    max,
    rms,
    peak,
  };
}
