export interface WaveformColumn {
  peak: number;
  rms: number;
  min: number;
  max: number;
}

export interface TimelineWaveformPyramidLevel {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: Array<{
    channelIndex: number;
    min: ArrayLike<number>;
    max: ArrayLike<number>;
    rms: ArrayLike<number>;
    peak: ArrayLike<number>;
  }>;
}

export interface TimelineWaveformPyramid {
  sampleRate: number;
  duration: number;
  levels: TimelineWaveformPyramidLevel[];
}

export type WaveformLodSource = 'pyramid' | 'legacy-aggregate' | 'legacy-interpolated';

export interface WaveformLodResult {
  columns: WaveformColumn[];
  source: WaveformLodSource;
  pixelsPerSecond: number;
  selectedSamplesPerBucket?: number;
  sourceSamplesPerSecond?: number;
}

export interface BuildWaveformLodInput {
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  pyramid?: TimelineWaveformPyramid | null;
  width: number;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  pixelsPerSecond?: number;
  channelIndex?: number;
}

export interface WaveformDisplayTransformOptions {
  targetPeak?: number;
  minReferencePeak?: number;
  maxGain?: number;
}

export const MAX_WAVEFORM_LOD_COLUMNS = 16_384;

function clampAbs01(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.abs(value)));
}

function clampSigned01(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function signedSoftLimit(value: number, gain: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.tanh(Math.abs(value) * gain);
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getColumnCount(width: number): number {
  return Math.max(1, Math.min(MAX_WAVEFORM_LOD_COLUMNS, Math.floor(width)));
}

function sanitizeWaveformColumn(column: WaveformColumn): WaveformColumn {
  const min = clampSigned01(column.min);
  const max = clampSigned01(column.max);
  const rms = clampAbs01(column.rms);
  const peak = Math.max(clampAbs01(column.peak), Math.abs(min), Math.abs(max));

  return { min, max, rms, peak };
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.min(
    sortedValues.length - 1,
    Math.round((sortedValues.length - 1) * ratio),
  ));
  return sortedValues[index] ?? 0;
}

function normalizeTimeRange(
  inPoint: number,
  outPoint: number,
  naturalDuration: number,
): { start: number; end: number; duration: number } {
  const duration = positiveFinite(naturalDuration, 0);
  const start = Math.max(0, Math.min(duration, Number.isFinite(inPoint) ? inPoint : 0));
  const end = Math.max(start, Math.min(duration, Number.isFinite(outPoint) ? outPoint : duration));

  return { start, end, duration };
}

function sampleWaveformLinear(waveform: readonly number[], position: number): number {
  if (waveform.length === 0) return 0;
  if (waveform.length === 1) return clampAbs01(waveform[0]);

  const clampedPosition = Math.max(0, Math.min(waveform.length - 1, position));
  const lowerIndex = Math.floor(clampedPosition);
  const upperIndex = Math.min(waveform.length - 1, lowerIndex + 1);
  const mix = clampedPosition - lowerIndex;
  const lower = clampAbs01(waveform[lowerIndex]);
  const upper = clampAbs01(waveform[upperIndex]);
  return lower + (upper - lower) * mix;
}

function legacyColumnFromPeak(peak: number): WaveformColumn {
  const normalizedPeak = clampAbs01(peak);
  return {
    peak: normalizedPeak,
    rms: normalizedPeak,
    min: -normalizedPeak,
    max: normalizedPeak,
  };
}

function buildLegacyColumns(
  waveform: readonly number[],
  width: number,
  pixelsPerSecond: number,
  range: { start: number; end: number; duration: number },
): WaveformLodResult | null {
  if (waveform.length === 0 || range.duration <= 0) return null;

  const columnCount = getColumnCount(width);
  const startRatio = range.start / range.duration;
  const endRatio = range.end / range.duration;
  const startSample = Math.floor(startRatio * waveform.length);
  const endSample = Math.ceil(endRatio * waveform.length);
  const visibleWaveform = waveform.slice(startSample, endSample);

  if (visibleWaveform.length === 0) return null;

  const columns: WaveformColumn[] = [];
  const isZoomedBeyondLegacyResolution = columnCount > visibleWaveform.length;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    if (isZoomedBeyondLegacyResolution) {
      const position = columnCount <= 1
        ? 0
        : (columnIndex / (columnCount - 1)) * Math.max(0, visibleWaveform.length - 1);
      columns.push(legacyColumnFromPeak(sampleWaveformLinear(visibleWaveform, position)));
      continue;
    }

    const start = Math.floor((columnIndex / columnCount) * visibleWaveform.length);
    const end = Math.max(start + 1, Math.ceil(((columnIndex + 1) / columnCount) * visibleWaveform.length));
    let peak = 0;
    let squareSum = 0;
    let count = 0;

    for (let sampleIndex = start; sampleIndex < end && sampleIndex < visibleWaveform.length; sampleIndex += 1) {
      const sample = clampAbs01(visibleWaveform[sampleIndex]);
      peak = Math.max(peak, sample);
      squareSum += sample * sample;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(squareSum / count) : 0;
    columns.push({
      peak,
      rms,
      min: -peak,
      max: peak,
    });
  }

  return {
    columns,
    source: isZoomedBeyondLegacyResolution ? 'legacy-interpolated' : 'legacy-aggregate',
    pixelsPerSecond,
    sourceSamplesPerSecond: waveform.length / range.duration,
  };
}

function selectPyramidLevel(
  pyramid: TimelineWaveformPyramid,
  pixelsPerSecond: number,
): TimelineWaveformPyramidLevel | null {
  if (!Number.isFinite(pyramid.sampleRate) || pyramid.sampleRate <= 0) return null;
  if (!pyramid.levels.length) return null;

  const targetSamplesPerPixel = pyramid.sampleRate / positiveFinite(pixelsPerSecond, 1);
  const sortedLevels = pyramid.levels.toSorted((a, b) => a.samplesPerBucket - b.samplesPerBucket);

  return sortedLevels.find((level) => level.samplesPerBucket >= targetSamplesPerPixel)
    ?? sortedLevels[sortedLevels.length - 1]
    ?? null;
}

function getPyramidLevelChannel(
  level: TimelineWaveformPyramidLevel,
  channelIndex: number,
): TimelineWaveformPyramidLevel['channels'][number] | null {
  return level.channels.find((channel) => channel.channelIndex === channelIndex)
    ?? level.channels[0]
    ?? null;
}

function aggregatePyramidBuckets(
  channel: TimelineWaveformPyramidLevel['channels'][number],
  startBucket: number,
  endBucket: number,
): WaveformColumn {
  let min = 0;
  let max = 0;
  let peak = 0;
  let squareSum = 0;
  let count = 0;

  for (let bucketIndex = startBucket; bucketIndex < endBucket; bucketIndex += 1) {
    const bucketMin = clampSigned01(channel.min[bucketIndex]);
    const bucketMax = clampSigned01(channel.max[bucketIndex]);
    const bucketPeak = clampAbs01(channel.peak[bucketIndex]);
    const bucketRms = clampAbs01(channel.rms[bucketIndex]);

    min = count === 0 ? bucketMin : Math.min(min, bucketMin);
    max = count === 0 ? bucketMax : Math.max(max, bucketMax);
    peak = Math.max(peak, bucketPeak, Math.abs(bucketMin), Math.abs(bucketMax));
    squareSum += bucketRms * bucketRms;
    count += 1;
  }

  return {
    min,
    max,
    peak,
    rms: count > 0 ? Math.sqrt(squareSum / count) : 0,
  };
}

function buildPyramidColumns(
  pyramid: TimelineWaveformPyramid,
  width: number,
  pixelsPerSecond: number,
  range: { start: number; end: number; duration: number },
  channelIndex: number,
): WaveformLodResult | null {
  if (range.duration <= 0 || range.end <= range.start) return null;

  const level = selectPyramidLevel(pyramid, pixelsPerSecond);
  if (!level || !Number.isFinite(level.bucketDuration) || level.bucketDuration <= 0) return null;

  const channel = getPyramidLevelChannel(level, channelIndex);
  if (!channel) return null;

  const columnCount = getColumnCount(width);
  const maxBucketCount = Math.min(
    level.bucketCount,
    channel.min.length,
    channel.max.length,
    channel.rms.length,
    channel.peak.length,
  );
  const rangeStartBucket = Math.max(0, Math.floor(range.start / level.bucketDuration));
  const rangeEndBucket = Math.min(maxBucketCount, Math.ceil(range.end / level.bucketDuration));
  const visibleBucketCount = Math.max(1, rangeEndBucket - rangeStartBucket);
  const columns: WaveformColumn[] = [];

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const startBucket = rangeStartBucket + Math.floor((columnIndex / columnCount) * visibleBucketCount);
    const endBucket = rangeStartBucket + Math.max(
      Math.floor((columnIndex / columnCount) * visibleBucketCount) + 1,
      Math.ceil(((columnIndex + 1) / columnCount) * visibleBucketCount),
    );
    columns.push(aggregatePyramidBuckets(
      channel,
      Math.max(0, Math.min(maxBucketCount, startBucket)),
      Math.max(0, Math.min(maxBucketCount, endBucket)),
    ));
  }

  return {
    columns,
    source: 'pyramid',
    pixelsPerSecond,
    selectedSamplesPerBucket: level.samplesPerBucket,
    sourceSamplesPerSecond: pyramid.sampleRate / level.samplesPerBucket,
  };
}

export function buildWaveformLod(input: BuildWaveformLodInput): WaveformLodResult | null {
  if (!Number.isFinite(input.width) || input.width <= 0) return null;
  if (!Number.isFinite(input.naturalDuration) || input.naturalDuration <= 0) return null;

  const range = normalizeTimeRange(input.inPoint, input.outPoint, input.naturalDuration);
  const width = Math.max(1, Math.floor(input.width));
  const fallbackPixelsPerSecond = width / Math.max(0.001, range.end - range.start);
  const pixelsPerSecond = positiveFinite(input.pixelsPerSecond ?? fallbackPixelsPerSecond, fallbackPixelsPerSecond);

  if (input.pyramid) {
    const pyramidResult = buildPyramidColumns(
      input.pyramid,
      width,
      pixelsPerSecond,
      range,
      input.channelIndex ?? 0,
    );
    if (pyramidResult) return pyramidResult;
  }

  const legacyWaveform = input.channelIndex !== undefined
    ? input.waveformChannels?.[input.channelIndex] ?? input.waveform
    : input.waveform;

  return buildLegacyColumns(legacyWaveform ?? [], width, pixelsPerSecond, range);
}

export function smoothWaveformColumns(
  columns: readonly WaveformColumn[],
  radius: number,
  strength = 1,
): WaveformColumn[] {
  const normalizedRadius = Math.max(0, Math.floor(radius));
  const normalizedStrength = Math.max(0, Math.min(1, strength));

  if (normalizedRadius <= 0 || normalizedStrength <= 0 || columns.length < 3) {
    return columns.map((column) => ({ ...column }));
  }

  return columns.map((column, index) => {
    let min = 0;
    let max = 0;
    let peak = 0;
    let rms = 0;
    let weightSum = 0;

    for (let offset = -normalizedRadius; offset <= normalizedRadius; offset += 1) {
      const sourceIndex = Math.max(0, Math.min(columns.length - 1, index + offset));
      const source = columns[sourceIndex];
      const weight = normalizedRadius + 1 - Math.abs(offset);
      min += source.min * weight;
      max += source.max * weight;
      peak += source.peak * weight;
      rms += source.rms * weight;
      weightSum += weight;
    }

    const averaged = {
      min: min / weightSum,
      max: max / weightSum,
      peak: peak / weightSum,
      rms: rms / weightSum,
    };
    const smoothedMin = column.min + (averaged.min - column.min) * normalizedStrength;
    const smoothedMax = column.max + (averaged.max - column.max) * normalizedStrength;
    const smoothedRms = column.rms + (averaged.rms - column.rms) * normalizedStrength;
    const smoothedPeak = column.peak + (averaged.peak - column.peak) * normalizedStrength;

    return {
      min: smoothedMin,
      max: smoothedMax,
      rms: Math.max(0, smoothedRms),
      peak: Math.max(smoothedPeak, Math.abs(smoothedMin), Math.abs(smoothedMax)),
    };
  });
}

export function normalizeWaveformColumnsForDisplay(
  columns: readonly WaveformColumn[],
  options: WaveformDisplayTransformOptions = {},
): WaveformColumn[] {
  const targetPeak = positiveFinite(options.targetPeak ?? 0.72, 0.72);
  const minReferencePeak = positiveFinite(options.minReferencePeak ?? 0.035, 0.035);
  const maxGain = positiveFinite(options.maxGain ?? 18, 18);
  const sanitizedColumns = columns.map(sanitizeWaveformColumn);
  const peaks = sanitizedColumns
    .map((column) => Math.max(column.peak, Math.abs(column.min), Math.abs(column.max)))
    .filter((peak) => peak > 0.0001)
    .toSorted((a, b) => a - b);

  if (peaks.length === 0) {
    return sanitizedColumns;
  }

  const maxPeak = peaks[peaks.length - 1] ?? 0;
  const referencePeak = Math.max(
    percentile(peaks, 0.85),
    maxPeak * 0.28,
    minReferencePeak,
  );
  const gain = Math.max(1, Math.min(maxGain, targetPeak / referencePeak));

  return sanitizedColumns.map((column) => {
    const min = signedSoftLimit(column.min, gain);
    const max = signedSoftLimit(column.max, gain);
    const rms = Math.tanh(Math.max(0, column.rms) * gain * 0.8);
    const peak = Math.max(
      Math.tanh(Math.max(0, column.peak) * gain),
      Math.abs(min),
      Math.abs(max),
    );

    return { min, max, rms, peak };
  });
}
