import type { TimelineWaveformPyramid, TimelineWaveformPyramidLevel } from './waveformLod';

export type AudioWaveformDiagnosticKind = 'clipping' | 'silence';
export type AudioWaveformDiagnosticSource = 'pyramid' | 'legacy';

export interface AudioWaveformDiagnosticBadge {
  kind: AudioWaveformDiagnosticKind;
  label: string;
  title: string;
  className: string;
}

export interface AudioWaveformDiagnostics {
  source: AudioWaveformDiagnosticSource;
  peak: number;
  rms: number;
  clippedSampleRatio: number;
  silentSampleRatio: number;
  clipping: boolean;
  silence: boolean;
  classNames: string[];
  badges: AudioWaveformDiagnosticBadge[];
}

export interface ResolveAudioWaveformDiagnosticsInput {
  waveform?: readonly number[];
  pyramid?: TimelineWaveformPyramid | null;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  gain?: number;
  maxPoints?: number;
  clippingThreshold?: number;
  clippingRatioThreshold?: number;
  silencePeakThreshold?: number;
  silenceRmsThreshold?: number;
  silenceRatioThreshold?: number;
}

const DEFAULT_MAX_DIAGNOSTIC_POINTS = 4096;
const DEFAULT_CLIPPING_THRESHOLD = 0.985;
const DEFAULT_CLIPPING_RATIO_THRESHOLD = 0.0025;
const DEFAULT_SILENCE_PEAK_THRESHOLD = 0.018;
const DEFAULT_SILENCE_RMS_THRESHOLD = 0.012;
const DEFAULT_SILENCE_RATIO_THRESHOLD = 0.96;
const LEGACY_ZERO_SILENCE_THRESHOLD = 0.0015;

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveFiniteOr(value: unknown, fallback: number): number {
  const resolved = finiteNumberOr(value, fallback);
  return resolved > 0 ? resolved : fallback;
}

function clamp01(value: unknown): number {
  const resolved = finiteNumberOr(value, 0);
  return Math.max(0, Math.min(1, Math.abs(resolved)));
}

function resolveRange(input: ResolveAudioWaveformDiagnosticsInput): { start: number; end: number; duration: number } | null {
  const duration = positiveFiniteOr(input.naturalDuration, 0);
  if (duration <= 0) return null;

  const start = Math.max(0, Math.min(duration, finiteNumberOr(input.inPoint, 0)));
  const end = Math.max(start, Math.min(duration, finiteNumberOr(input.outPoint, duration)));
  if (end <= start) return null;

  return { start, end, duration };
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

function formatPeak(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

function createDiagnostics(input: {
  source: AudioWaveformDiagnosticSource;
  peak: number;
  rms: number;
  clippedSampleRatio: number;
  silentSampleRatio: number;
  clippingReliable: boolean;
  silenceReliable: boolean;
  clippingThreshold: number;
  clippingRatioThreshold: number;
  silencePeakThreshold: number;
  silenceRmsThreshold: number;
  silenceRatioThreshold: number;
}): AudioWaveformDiagnostics | null {
  const peak = clamp01(input.peak);
  const rms = clamp01(input.rms);
  const clippedSampleRatio = Math.max(0, Math.min(1, finiteNumberOr(input.clippedSampleRatio, 0)));
  const silentSampleRatio = Math.max(0, Math.min(1, finiteNumberOr(input.silentSampleRatio, 0)));
  const clipping = input.clippingReliable
    && peak >= input.clippingThreshold
    && clippedSampleRatio >= input.clippingRatioThreshold;
  const silence = input.silenceReliable
    && peak <= input.silencePeakThreshold
    && rms <= input.silenceRmsThreshold
    && silentSampleRatio >= input.silenceRatioThreshold;

  if (!clipping && !silence) return null;

  const classNames: string[] = [];
  const badges: AudioWaveformDiagnosticBadge[] = [];

  if (clipping) {
    classNames.push('audio-diagnostic-clipping');
    badges.push({
      kind: 'clipping',
      label: 'CLIP',
      title: `Potential clipping: peak ${formatPeak(peak)}, ${formatPercent(clippedSampleRatio)} of analyzed buckets near full scale.`,
      className: 'clip-audio-diagnostic-badge-clipping',
    });
  }

  if (silence) {
    classNames.push('audio-diagnostic-silence');
    badges.push({
      kind: 'silence',
      label: 'SIL',
      title: `Near silence: RMS ${formatPeak(rms)}, ${formatPercent(silentSampleRatio)} of analyzed buckets below the silence threshold.`,
      className: 'clip-audio-diagnostic-badge-silence',
    });
  }

  return {
    source: input.source,
    peak,
    rms,
    clippedSampleRatio,
    silentSampleRatio,
    clipping,
    silence,
    classNames,
    badges,
  };
}

function getPyramidLevelBucketRange(
  level: TimelineWaveformPyramidLevel,
  startSeconds: number,
  endSeconds: number,
): { startBucket: number; endBucket: number; bucketCount: number } | null {
  if (!Number.isFinite(level.bucketDuration) || level.bucketDuration <= 0) return null;
  if (!Number.isFinite(level.bucketCount) || level.bucketCount <= 0) return null;

  const channelBucketCount = level.channels.reduce((minCount, channel) => Math.min(
    minCount,
    channel.min.length,
    channel.max.length,
    channel.rms.length,
    channel.peak.length,
  ), Number.POSITIVE_INFINITY);
  const maxBucketCount = Math.min(level.bucketCount, channelBucketCount);
  if (!Number.isFinite(maxBucketCount) || maxBucketCount <= 0) return null;

  const startBucket = Math.max(0, Math.min(maxBucketCount, Math.floor(startSeconds / level.bucketDuration)));
  const endBucket = Math.max(startBucket, Math.min(maxBucketCount, Math.ceil(endSeconds / level.bucketDuration)));
  if (endBucket <= startBucket) return null;

  return {
    startBucket,
    endBucket,
    bucketCount: endBucket - startBucket,
  };
}

function selectPyramidDiagnosticsLevel(
  pyramid: TimelineWaveformPyramid,
  range: { start: number; end: number },
  maxPoints: number,
): { level: TimelineWaveformPyramidLevel; range: { startBucket: number; endBucket: number; bucketCount: number } } | null {
  const levels = pyramid.levels
    .filter(level => level.channels.length > 0)
    .toSorted((a, b) => a.samplesPerBucket - b.samplesPerBucket);
  if (levels.length === 0) return null;

  let fallback: { level: TimelineWaveformPyramidLevel; range: { startBucket: number; endBucket: number; bucketCount: number } } | null = null;

  for (const level of levels) {
    const bucketRange = getPyramidLevelBucketRange(level, range.start, range.end);
    if (!bucketRange) continue;

    fallback = { level, range: bucketRange };
    if (bucketRange.bucketCount <= maxPoints) {
      return fallback;
    }
  }

  return fallback;
}

function resolvePyramidDiagnostics(
  input: ResolveAudioWaveformDiagnosticsInput,
  range: { start: number; end: number },
): AudioWaveformDiagnostics | null {
  const pyramid = input.pyramid;
  if (!pyramid) return null;

  const maxPoints = Math.max(64, Math.floor(positiveFiniteOr(input.maxPoints, DEFAULT_MAX_DIAGNOSTIC_POINTS)));
  const selected = selectPyramidDiagnosticsLevel(pyramid, range, maxPoints);
  if (!selected) return null;

  const gain = Math.max(0, Math.min(32, finiteNumberOr(input.gain, 1)));
  const clippingThreshold = Math.max(0.8, Math.min(1, finiteNumberOr(input.clippingThreshold, DEFAULT_CLIPPING_THRESHOLD)));
  const silencePeakThreshold = Math.max(0, Math.min(0.2, finiteNumberOr(input.silencePeakThreshold, DEFAULT_SILENCE_PEAK_THRESHOLD)));
  const silenceRmsThreshold = Math.max(0, Math.min(0.2, finiteNumberOr(input.silenceRmsThreshold, DEFAULT_SILENCE_RMS_THRESHOLD)));
  const clippingRatioThreshold = Math.max(0, Math.min(1, finiteNumberOr(input.clippingRatioThreshold, DEFAULT_CLIPPING_RATIO_THRESHOLD)));
  const silenceRatioThreshold = Math.max(0, Math.min(1, finiteNumberOr(input.silenceRatioThreshold, DEFAULT_SILENCE_RATIO_THRESHOLD)));
  const sampleStep = Math.max(1, Math.ceil(selected.range.bucketCount / maxPoints));

  let peak = 0;
  let squareSum = 0;
  let clippedCount = 0;
  let silentCount = 0;
  let count = 0;

  for (const channel of selected.level.channels) {
    for (let bucketIndex = selected.range.startBucket; bucketIndex < selected.range.endBucket; bucketIndex += sampleStep) {
      const bucketPeak = Math.min(1, clamp01(channel.peak[bucketIndex]) * gain);
      const bucketRms = Math.min(1, clamp01(channel.rms[bucketIndex]) * gain);

      peak = Math.max(peak, bucketPeak);
      squareSum += bucketRms * bucketRms;
      if (bucketPeak >= clippingThreshold) clippedCount += 1;
      if (bucketPeak <= silencePeakThreshold && bucketRms <= silenceRmsThreshold) silentCount += 1;
      count += 1;
    }
  }

  if (count === 0) return null;

  return createDiagnostics({
    source: 'pyramid',
    peak,
    rms: Math.sqrt(squareSum / count),
    clippedSampleRatio: clippedCount / count,
    silentSampleRatio: silentCount / count,
    clippingReliable: true,
    silenceReliable: true,
    clippingThreshold,
    clippingRatioThreshold,
    silencePeakThreshold,
    silenceRmsThreshold,
    silenceRatioThreshold,
  });
}

function resolveLegacyDiagnostics(
  input: ResolveAudioWaveformDiagnosticsInput,
  range: { start: number; end: number; duration: number },
): AudioWaveformDiagnostics | null {
  const waveform = input.waveform;
  if (!waveform || waveform.length === 0) return null;

  const startIndex = Math.max(0, Math.min(waveform.length, Math.floor((range.start / range.duration) * waveform.length)));
  const endIndex = Math.max(startIndex, Math.min(waveform.length, Math.ceil((range.end / range.duration) * waveform.length)));
  if (endIndex <= startIndex) return null;

  const maxPoints = Math.max(64, Math.floor(positiveFiniteOr(input.maxPoints, DEFAULT_MAX_DIAGNOSTIC_POINTS)));
  const sampleStep = Math.max(1, Math.ceil((endIndex - startIndex) / maxPoints));
  let peak = 0;
  let squareSum = 0;
  let silentCount = 0;
  let count = 0;

  for (let index = startIndex; index < endIndex; index += sampleStep) {
    const value = clamp01(waveform[index]);
    peak = Math.max(peak, value);
    squareSum += value * value;
    if (value <= LEGACY_ZERO_SILENCE_THRESHOLD) silentCount += 1;
    count += 1;
  }

  if (count === 0) return null;

  const rms = Math.sqrt(squareSum / count);
  const zeroSilenceRatio = silentCount / count;
  return createDiagnostics({
    source: 'legacy',
    peak,
    rms,
    clippedSampleRatio: 0,
    silentSampleRatio: zeroSilenceRatio,
    clippingReliable: false,
    silenceReliable: true,
    clippingThreshold: DEFAULT_CLIPPING_THRESHOLD,
    clippingRatioThreshold: 1,
    silencePeakThreshold: LEGACY_ZERO_SILENCE_THRESHOLD,
    silenceRmsThreshold: LEGACY_ZERO_SILENCE_THRESHOLD,
    silenceRatioThreshold: 0.995,
  });
}

export function resolveAudioWaveformDiagnostics(
  input: ResolveAudioWaveformDiagnosticsInput,
): AudioWaveformDiagnostics | null {
  const range = resolveRange(input);
  if (!range) return null;

  return resolvePyramidDiagnostics(input, range)
    ?? resolveLegacyDiagnostics(input, range);
}
