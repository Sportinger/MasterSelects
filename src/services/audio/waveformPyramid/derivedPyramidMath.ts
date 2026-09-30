import type { TimelineWaveformPyramid } from '../../../components/timeline/utils/waveformLod';
import type { ClipAudioEditOperation } from '../../../types/audio';

export interface DerivedWaveformClipRange { inPoint: number; outPoint: number; duration: number; reversed?: boolean }

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

type DerivedWaveformOperationType = Extract<
  ClipAudioEditOperation['type'],
  | 'silence'
  | 'gain'
  | 'cut'
  | 'insert-silence'
  | 'delete-silence'
  | 'reverse'
  | 'invert-polarity'
  | 'swap-channels'
  | 'split-stereo'
>;

const DERIVABLE_AUDIO_EDIT_TYPES = new Set<ClipAudioEditOperation['type']>([
  'silence',
  'gain',
  'cut',
  'insert-silence',
  'delete-silence',
  'reverse',
  'invert-polarity',
  'swap-channels',
  'split-stereo',
]);

export function isDerivableEditOperation(operation: ClipAudioEditOperation): operation is ClipAudioEditOperation & {
  type: DerivedWaveformOperationType;
} {
  if (operation.enabled === false) return true;
  if (!DERIVABLE_AUDIO_EDIT_TYPES.has(operation.type)) return false;
  if (operation.type === 'delete-silence' && operation.params.compactTimeline === true) return false;
  return true;
}

function cloneChannel(channel: TimelineWaveformPyramid['levels'][number]['channels'][number]) {
  return {
    channelIndex: channel.channelIndex,
    min: Float32Array.from(channel.min),
    max: Float32Array.from(channel.max),
    rms: Float32Array.from(channel.rms),
    peak: Float32Array.from(channel.peak),
  };
}

function aggregateSourceBuckets(
  channel: TimelineWaveformPyramid['levels'][number]['channels'][number],
  level: TimelineWaveformPyramid['levels'][number],
  startSeconds: number,
  endSeconds: number,
) {
  const maxBucketCount = Math.min(
    level.bucketCount,
    channel.min.length,
    channel.max.length,
    channel.rms.length,
    channel.peak.length,
  );
  const startBucket = Math.max(0, Math.floor(startSeconds / level.bucketDuration));
  const endBucket = Math.min(maxBucketCount, Math.ceil(endSeconds / level.bucketDuration));
  let min = 0;
  let max = 0;
  let rmsSquareSum = 0;
  let peak = 0;
  let weightSum = 0;

  for (let bucket = startBucket; bucket < endBucket; bucket += 1) {
    const bucketStart = bucket * level.bucketDuration;
    const bucketEnd = bucketStart + level.bucketDuration;
    const weight = Math.max(0, Math.min(endSeconds, bucketEnd) - Math.max(startSeconds, bucketStart));
    if (weight <= 0) continue;

    const bucketMin = finiteNumber(channel.min[bucket], 0);
    const bucketMax = finiteNumber(channel.max[bucket], 0);
    const bucketRms = Math.abs(finiteNumber(channel.rms[bucket], 0));
    const bucketPeak = Math.abs(finiteNumber(channel.peak[bucket], 0));
    min = weightSum === 0 ? bucketMin : Math.min(min, bucketMin);
    max = weightSum === 0 ? bucketMax : Math.max(max, bucketMax);
    peak = Math.max(peak, bucketPeak, Math.abs(bucketMin), Math.abs(bucketMax));
    rmsSquareSum += bucketRms * bucketRms * weight;
    weightSum += weight;
  }

  return {
    min: weightSum > 0 ? min : 0,
    max: weightSum > 0 ? max : 0,
    rms: weightSum > 0 ? Math.sqrt(rmsSquareSum / weightSum) : 0,
    peak,
  };
}

function deriveClipLocalSourcePyramid(
  sourcePyramid: TimelineWaveformPyramid,
  clip: DerivedWaveformClipRange,
): TimelineWaveformPyramid {
  const sourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const sourceEnd = Math.max(sourceStart, finiteNumber(clip.outPoint, sourceStart + clip.duration));
  const duration = Math.max(0.001, sourceEnd - sourceStart);

  return {
    sampleRate: sourcePyramid.sampleRate,
    duration,
    levels: sourcePyramid.levels.map(level => {
      const bucketCount = Math.max(1, Math.ceil((duration * sourcePyramid.sampleRate) / level.samplesPerBucket));
      return {
        samplesPerBucket: level.samplesPerBucket,
        bucketDuration: level.bucketDuration,
        bucketCount,
        channels: level.channels.map(sourceChannel => {
          const channel = {
            channelIndex: sourceChannel.channelIndex,
            min: new Float32Array(bucketCount),
            max: new Float32Array(bucketCount),
            rms: new Float32Array(bucketCount),
            peak: new Float32Array(bucketCount),
          };

          for (let bucket = 0; bucket < bucketCount; bucket += 1) {
            const startSeconds = sourceStart + bucket * level.bucketDuration;
            const endSeconds = Math.min(sourceEnd, startSeconds + level.bucketDuration);
            const stat = aggregateSourceBuckets(sourceChannel, level, startSeconds, endSeconds);
            channel.min[bucket] = stat.min;
            channel.max[bucket] = stat.max;
            channel.rms[bucket] = stat.rms;
            channel.peak[bucket] = stat.peak;
          }

          return channel;
        }),
      };
    }),
  };
}

function getPyramidChannelIndexes(pyramid: TimelineWaveformPyramid): number[] {
  return pyramid.levels[0]?.channels.map(channel => channel.channelIndex) ?? [];
}

function getOperationChannelIndexes(
  operation: ClipAudioEditOperation,
  pyramid: TimelineWaveformPyramid,
): number[] {
  const available = new Set(getPyramidChannelIndexes(pyramid));
  const source = operation.channelMask?.length
    ? operation.channelMask
    : [...available];
  const unique = new Set<number>();
  for (const channelIndex of source) {
    if (available.has(channelIndex)) {
      unique.add(channelIndex);
    }
  }
  return [...unique];
}

function getBucketRange(
  operation: ClipAudioEditOperation,
  clip: DerivedWaveformClipRange,
  level: TimelineWaveformPyramid['levels'][number],
): { start: number; end: number } {
  if (!operation.timeRange) {
    return { start: 0, end: level.bucketCount };
  }

  const sourceStart = Math.min(operation.timeRange.start, operation.timeRange.end);
  const sourceEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const localStartSeconds = Math.max(0, sourceStart - clipSourceStart);
  const localEndSeconds = Math.max(localStartSeconds, sourceEnd - clipSourceStart);
  return {
    start: Math.max(0, Math.min(level.bucketCount, Math.floor(localStartSeconds / level.bucketDuration))),
    end: Math.max(0, Math.min(level.bucketCount, Math.ceil(localEndSeconds / level.bucketDuration))),
  };
}

function zeroRange(
  channel: ReturnType<typeof cloneChannel>,
  start: number,
  end: number,
): void {
  channel.min.fill(0, start, end);
  channel.max.fill(0, start, end);
  channel.rms.fill(0, start, end);
  channel.peak.fill(0, start, end);
}

function getRegionGainEnvelope(
  bucket: number,
  level: TimelineWaveformPyramid['levels'][number],
  start: number,
  end: number,
  fadeInSeconds: number,
  fadeOutSeconds: number,
): number {
  const localSeconds = Math.max(0, (bucket + 0.5 - start) * level.bucketDuration);
  const durationSeconds = Math.max(level.bucketDuration, (end - start) * level.bucketDuration);
  const fadeIn = fadeInSeconds > 0 ? Math.min(1, localSeconds / fadeInSeconds) : 1;
  const fadeOut = fadeOutSeconds > 0 ? Math.min(1, (durationSeconds - localSeconds) / fadeOutSeconds) : 1;
  return Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut)));
}

function applyGainStatsRange(
  channel: ReturnType<typeof cloneChannel>,
  level: TimelineWaveformPyramid['levels'][number],
  operation: ClipAudioEditOperation,
  start: number,
  end: number,
): void {
  const gainDb = Math.max(-120, Math.min(24, finiteNumber(operation.params.gainDb, 0)));
  if (Math.abs(gainDb) <= 0.01) return;

  const targetGain = gainDb <= -96 ? 0 : 10 ** (gainDb / 20);
  const fadeInSeconds = Math.max(0, finiteNumber(operation.params.fadeInSeconds, 0));
  const fadeOutSeconds = Math.max(0, finiteNumber(operation.params.fadeOutSeconds, 0));

  for (let bucket = start; bucket < end; bucket += 1) {
    const envelope = getRegionGainEnvelope(bucket, level, start, end, fadeInSeconds, fadeOutSeconds);
    const gain = 1 + (targetGain - 1) * envelope;
    channel.min[bucket] = (channel.min[bucket] ?? 0) * gain;
    channel.max[bucket] = (channel.max[bucket] ?? 0) * gain;
    channel.rms[bucket] = Math.abs(channel.rms[bucket] ?? 0) * gain;
    channel.peak[bucket] = Math.abs(channel.peak[bucket] ?? 0) * gain;
  }
}

function reverseStatsRange(
  channel: ReturnType<typeof cloneChannel>,
  start: number,
  end: number,
): void {
  channel.min.subarray(start, end).reverse();
  channel.max.subarray(start, end).reverse();
  channel.rms.subarray(start, end).reverse();
  channel.peak.subarray(start, end).reverse();
}

function invertPolarityRange(
  channel: ReturnType<typeof cloneChannel>,
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index += 1) {
    const min = channel.min[index] ?? 0;
    const max = channel.max[index] ?? 0;
    channel.min[index] = -max;
    channel.max[index] = -min;
  }
}

function shiftRightFillSilence(
  channel: ReturnType<typeof cloneChannel>,
  start: number,
  count: number,
): void {
  if (count <= 0 || start >= channel.peak.length) return;
  const boundedCount = Math.min(count, channel.peak.length - start);
  for (const values of [channel.min, channel.max, channel.rms, channel.peak]) {
    values.copyWithin(start + boundedCount, start, values.length - boundedCount);
    values.fill(0, start, start + boundedCount);
  }
}

function shiftLeftFillSilence(
  channel: ReturnType<typeof cloneChannel>,
  start: number,
  count: number,
): void {
  if (count <= 0 || start >= channel.peak.length) return;
  const boundedCount = Math.min(count, channel.peak.length - start);
  for (const values of [channel.min, channel.max, channel.rms, channel.peak]) {
    values.copyWithin(start, start + boundedCount);
    values.fill(0, values.length - boundedCount);
  }
}

function copyStatsRange(
  source: ReturnType<typeof cloneChannel>,
  target: ReturnType<typeof cloneChannel>,
  start: number,
  end: number,
): void {
  target.min.set(source.min.subarray(start, end), start);
  target.max.set(source.max.subarray(start, end), start);
  target.rms.set(source.rms.subarray(start, end), start);
  target.peak.set(source.peak.subarray(start, end), start);
}

function swapStatsRange(
  left: ReturnType<typeof cloneChannel>,
  right: ReturnType<typeof cloneChannel>,
  start: number,
  end: number,
): void {
  for (const statistic of ['min', 'max', 'rms', 'peak'] as const) {
    const leftValues = left[statistic];
    const rightValues = right[statistic];
    for (let index = start; index < end; index += 1) {
      const value = leftValues[index] ?? 0;
      leftValues[index] = rightValues[index] ?? 0;
      rightValues[index] = value;
    }
  }
}

function applyEditOperationToPyramid(
  pyramid: TimelineWaveformPyramid,
  clip: DerivedWaveformClipRange,
  operation: ClipAudioEditOperation,
): void {
  if (operation.enabled === false || !isDerivableEditOperation(operation)) return;

  for (const level of pyramid.levels) {
    const channelsByIndex = new Map(level.channels.map(channel => [channel.channelIndex, channel]));
    const range = getBucketRange(operation, clip, level);
    const start = Math.max(0, Math.min(level.bucketCount, range.start));
    const end = Math.max(start, Math.min(level.bucketCount, range.end));
    const channelIndexes = getOperationChannelIndexes(operation, pyramid);
    const channels = channelIndexes
      .map(channelIndex => channelsByIndex.get(channelIndex))
      .filter((channel): channel is ReturnType<typeof cloneChannel> => Boolean(channel));

    if (channels.length === 0) continue;

    switch (operation.type) {
      case 'gain':
        channels.forEach(channel => applyGainStatsRange(channel, level, operation, start, end));
        break;
      case 'silence':
      case 'cut':
        channels.forEach(channel => zeroRange(channel, start, end));
        break;
      case 'reverse':
        channels.forEach(channel => reverseStatsRange(channel, start, end));
        break;
      case 'invert-polarity':
        channels.forEach(channel => invertPolarityRange(channel, start, end));
        break;
      case 'swap-channels': {
        if (level.channels.length < 2) break;
        const left = channels[0] ?? level.channels[0];
        const right = channels[1] ?? level.channels.find(channel => channel.channelIndex !== left.channelIndex);
        if (right) {
          swapStatsRange(left, right, start, end);
        }
        break;
      }
      case 'split-stereo': {
        const sourceChannelIndex = Math.max(
          0,
          Math.round(finiteNumber(operation.params.sourceChannel, channels[0]?.channelIndex ?? 0)),
        );
        const source = channelsByIndex.get(sourceChannelIndex);
        if (!source) break;
        const sourceCopy = cloneChannel(source);
        channels.forEach(channel => copyStatsRange(sourceCopy, channel, start, end));
        break;
      }
      case 'insert-silence': {
        const requestedSeconds = finiteNumber(operation.params.durationSeconds, 0);
        const requestedBuckets = requestedSeconds > 0
          ? Math.round(requestedSeconds / level.bucketDuration)
          : Math.max(1, end - start);
        channels.forEach(channel => shiftRightFillSilence(channel, start, requestedBuckets));
        break;
      }
      case 'delete-silence':
        channels.forEach(channel => shiftLeftFillSilence(channel, start, Math.max(0, end - start)));
        break;
    }
  }
}

function reverseWholePyramid(pyramid: TimelineWaveformPyramid): void {
  for (const level of pyramid.levels) {
    level.channels.forEach(channel => reverseStatsRange(channel as ReturnType<typeof cloneChannel>, 0, level.bucketCount));
  }
}

export function deriveProcessedPyramidFromSource(
  sourcePyramid: TimelineWaveformPyramid,
  clip: DerivedWaveformClipRange,
  operations: readonly ClipAudioEditOperation[],
): TimelineWaveformPyramid {
  const derived = deriveClipLocalSourcePyramid(sourcePyramid, clip);
  for (const operation of operations) {
    applyEditOperationToPyramid(derived, clip, operation);
  }
  if (clip.reversed === true) {
    reverseWholePyramid(derived);
  }
  return derived;
}

