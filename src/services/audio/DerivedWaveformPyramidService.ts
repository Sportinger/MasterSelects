import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import type { Keyframe, TimelineClip } from '../../types';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import {
  type ClipAudioEditOperation,
} from '../../types';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type { AudioAnalysisArtifact } from './audioArtifactTypes';
import {
  createCurrentAudioArtifactStore,
  primeTimelineWaveformPyramidCache,
} from './timelineWaveformPyramidCache';
import {
  collectProcessedAnalysisClipAudioEffectInstances,
  collectRenderableClipAudioEditOperations,
  createProcessedClipAudioStateHash,
} from './processedWaveformEligibility';
import {
  WaveformPyramidGenerator,
  type WaveformPyramidGenerationProgress,
  type WaveformPyramidGenerationResult,
} from './WaveformPyramidGenerator';

const DERIVED_PROCESSED_WAVEFORM_GENERATOR_VERSION = 'masterselects.derived-processed-waveform-pyramid@1.0.0';
const DERIVED_PROCESSED_WAVEFORM_DECODER_ID = 'masterselects.derived-waveform-pyramid';
const DERIVED_PROCESSED_WAVEFORM_DECODER_VERSION = '1.0.0';

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

export type DerivedProcessedWaveformGenerationPhase =
  | 'preparing'
  | 'deriving'
  | 'storing'
  | 'complete';

export interface DerivedProcessedWaveformGenerationProgress {
  phase: DerivedProcessedWaveformGenerationPhase;
  percent: number;
  message?: string;
  waveform?: WaveformPyramidGenerationProgress;
}

export interface DerivedProcessedWaveformPyramidRequest {
  clip: TimelineClip;
  sourcePyramid: TimelineWaveformPyramid;
  sourceFingerprint: string;
  mediaFileId?: string;
  keyframes?: readonly Keyframe[];
  signal?: AbortSignal;
  onProgress?: (progress: DerivedProcessedWaveformGenerationProgress) => void;
}

export interface DerivedProcessedWaveformPyramidResult {
  clipAudioStateHash: string;
  waveform: number[];
  pyramid: TimelineWaveformPyramid;
  audioAnalysisRefs: MediaFileAudioAnalysisRefs;
  generated: WaveformPyramidGenerationResult;
  artifact: AudioAnalysisArtifact;
}

export interface DerivedProcessedWaveformPyramidServiceOptions {
  artifactStore?: AudioArtifactStore;
  waveformGenerator?: WaveformPyramidGenerator;
}

function emitProgress(
  onProgress: ((progress: DerivedProcessedWaveformGenerationProgress) => void) | undefined,
  progress: DerivedProcessedWaveformGenerationProgress,
): void {
  onProgress?.(progress);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Derived processed waveform generation cancelled.', 'AbortError');
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasEnabledSpectralLayer(clip: TimelineClip): boolean {
  return (clip.audioState?.spectralLayers ?? []).some(layer => layer.enabled !== false);
}

function hasSpeedProcessing(clip: TimelineClip, keyframes: readonly Keyframe[]): boolean {
  return Math.abs((clip.speed ?? 1) - 1) > 0.001 ||
    keyframes.some(keyframe => keyframe.property === 'speed');
}

function isDerivableEditOperation(operation: ClipAudioEditOperation): operation is ClipAudioEditOperation & {
  type: DerivedWaveformOperationType;
} {
  if (operation.enabled === false) return true;
  if (!DERIVABLE_AUDIO_EDIT_TYPES.has(operation.type)) return false;
  if (operation.type === 'delete-silence' && operation.params.compactTimeline === true) return false;
  return true;
}

export function canDeriveProcessedWaveformPyramid(
  clip: TimelineClip,
  keyframes: readonly Keyframe[] = [],
): boolean {
  if (hasSpeedProcessing(clip, keyframes)) return false;
  if (hasEnabledSpectralLayer(clip)) return false;
  if (collectProcessedAnalysisClipAudioEffectInstances(clip, keyframes).length > 0) return false;
  return collectRenderableClipAudioEditOperations(clip).every(isDerivableEditOperation);
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
  clip: TimelineClip,
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
  clip: TimelineClip,
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
  clip: TimelineClip,
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

function clonePyramid(pyramid: TimelineWaveformPyramid): TimelineWaveformPyramid {
  return {
    sampleRate: pyramid.sampleRate,
    duration: pyramid.duration,
    levels: pyramid.levels.map(level => ({
      samplesPerBucket: level.samplesPerBucket,
      bucketDuration: level.bucketDuration,
      bucketCount: level.bucketCount,
      channels: level.channels.map(cloneChannel),
    })),
  };
}

function deriveProcessedPyramidFromSource(
  sourcePyramid: TimelineWaveformPyramid,
  clip: TimelineClip,
): TimelineWaveformPyramid {
  const derived = clonePyramid(deriveClipLocalSourcePyramid(sourcePyramid, clip));
  for (const operation of collectRenderableClipAudioEditOperations(clip)) {
    applyEditOperationToPyramid(derived, clip, operation);
  }
  if (clip.reversed === true) {
    reverseWholePyramid(derived);
  }
  return derived;
}

function generateLegacyWaveformFromPyramid(
  pyramid: TimelineWaveformPyramid,
  samplesPerSecond = 50,
): number[] {
  const sampleCount = Math.max(200, Math.min(10000, Math.floor(pyramid.duration * samplesPerSecond)));
  const firstLevel = pyramid.levels[0];
  if (!firstLevel || firstLevel.bucketCount <= 0 || firstLevel.channels.length === 0) {
    return new Array(sampleCount).fill(0);
  }

  const waveform: number[] = [];
  let max = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const start = Math.floor((index / sampleCount) * firstLevel.bucketCount);
    const end = Math.max(start + 1, Math.ceil(((index + 1) / sampleCount) * firstLevel.bucketCount));
    let peak = 0;
    for (const channel of firstLevel.channels) {
      for (let bucket = start; bucket < end && bucket < firstLevel.bucketCount; bucket += 1) {
        peak = Math.max(peak, Math.abs(finiteNumber(channel.peak[bucket], 0)));
      }
    }
    waveform.push(clamp01(peak));
    max = Math.max(max, peak);
  }

  return max > 0 ? waveform.map(value => clamp01(value / max)) : waveform;
}

export class DerivedProcessedWaveformPyramidService {
  private readonly artifactStore: AudioArtifactStore;
  private readonly waveformGenerator: WaveformPyramidGenerator;

  constructor(options: DerivedProcessedWaveformPyramidServiceOptions = {}) {
    this.artifactStore = options.artifactStore ?? createCurrentAudioArtifactStore();
    this.waveformGenerator = options.waveformGenerator ?? new WaveformPyramidGenerator({
      artifactStore: this.artifactStore,
      analyzerVersion: DERIVED_PROCESSED_WAVEFORM_GENERATOR_VERSION,
    });
  }

  async generate(
    request: DerivedProcessedWaveformPyramidRequest,
  ): Promise<DerivedProcessedWaveformPyramidResult> {
    const {
      clip,
      sourcePyramid,
      sourceFingerprint,
      keyframes = [],
      signal,
      onProgress,
    } = request;
    const mediaFileId = request.mediaFileId ?? clip.mediaFileId ?? clip.source?.mediaFileId ?? clip.id;
    const clipAudioStateHash = createProcessedClipAudioStateHash(clip, { keyframes });

    emitProgress(onProgress, {
      phase: 'preparing',
      percent: 0,
      message: 'Preparing derived processed waveform',
    });
    throwIfAborted(signal);

    if (!canDeriveProcessedWaveformPyramid(clip, keyframes)) {
      throw new Error('Clip audio state is not eligible for derived processed waveform generation.');
    }

    const pyramid = deriveProcessedPyramidFromSource(sourcePyramid, clip);
    emitProgress(onProgress, {
      phase: 'deriving',
      percent: 62,
      message: 'Derived processed waveform from source pyramid',
    });
    throwIfAborted(signal);

    const generated = await this.waveformGenerator.storePyramid({
      kind: 'processed-waveform-pyramid',
      mediaFileId,
      sourceFingerprint,
      pyramid,
      clipAudioStateHash,
      decoderId: DERIVED_PROCESSED_WAVEFORM_DECODER_ID,
      decoderVersion: DERIVED_PROCESSED_WAVEFORM_DECODER_VERSION,
      metadata: {
        sourceClipId: clip.id,
        sourceClipName: clip.name,
        sourceInPoint: clip.inPoint,
        sourceOutPoint: clip.outPoint,
        timelineDuration: clip.duration,
        timelineSpeed: clip.speed ?? 1,
        reversed: clip.reversed === true,
        preservesPitch: clip.preservesPitch !== false,
        derivedFromSourcePyramid: true,
      },
    }, {
      signal,
      onProgress: waveform => emitProgress(onProgress, {
        phase: waveform.phase === 'complete' ? 'complete' : 'storing',
        percent: 62 + Math.round(waveform.percent * 0.38),
        waveform,
        message: waveform.message,
      }),
    });

    primeTimelineWaveformPyramidCache([
      generated.artifact.id,
      generated.artifact.manifestRef.artifactId,
      generated.analysisRef.artifactId,
    ], pyramid);

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Derived processed waveform ready',
    });

    return {
      clipAudioStateHash,
      waveform: generateLegacyWaveformFromPyramid(pyramid),
      pyramid,
      audioAnalysisRefs: {
        processedWaveformPyramidId: generated.artifact.manifestRef.artifactId,
      },
      generated,
      artifact: generated.artifact,
    };
  }
}
