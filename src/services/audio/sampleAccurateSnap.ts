export type ZeroCrossingPreference = 'nearest' | 'before' | 'after';

export interface SnapSourceTimeToZeroCrossingOptions {
  maxDistanceSeconds?: number;
  prefer?: ZeroCrossingPreference;
  channel?: number;
}

export interface SnapSourceTimeToLowDiscontinuityOptions {
  maxDistanceSeconds?: number;
}

export interface ZeroCrossingSnapCacheEntry {
  channelData: Float32Array;
  sampleRate: number;
}

const DEFAULT_MAX_DISTANCE_SECONDS = 0.01;
const MAX_CACHE_ENTRIES = 4;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function crossingTimeForPair(data: Float32Array, index: number, sampleRate: number): number | null {
  const left = data[index];
  const right = data[index + 1];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (left === 0) return index / sampleRate;
  if (right === 0) return (index + 1) / sampleRate;
  if (left > 0 === right > 0) return null;
  return (index + left / (left - right)) / sampleRate;
}

export function findNearestZeroCrossing(
  data: Float32Array,
  sampleRate: number,
  sourceTime: number,
  maxDistanceSeconds: number,
  prefer: ZeroCrossingPreference = 'nearest',
): number | null {
  if (data.length < 2) return null;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (!Number.isFinite(sourceTime) || sourceTime < 0) return null;
  if (!Number.isFinite(maxDistanceSeconds) || maxDistanceSeconds <= 0) return null;
  if (sourceTime > (data.length - 1) / sampleRate) return null;

  const lastPairIndex = data.length - 2;
  const centerPair = clampInt(Math.floor(sourceTime * sampleRate), 0, lastPairIndex);
  const pairRadius = Math.ceil(maxDistanceSeconds * sampleRate) + 1;
  const firstPair = Math.max(0, centerPair - pairRadius);
  const lastPair = Math.min(lastPairIndex, centerPair + pairRadius);

  let bestTime: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let pair = firstPair; pair <= lastPair; pair += 1) {
    const crossingTime = crossingTimeForPair(data, pair, sampleRate);
    if (crossingTime === null) continue;
    if (prefer === 'before' && crossingTime > sourceTime) continue;
    if (prefer === 'after' && crossingTime < sourceTime) continue;
    const distance = Math.abs(crossingTime - sourceTime);
    if (distance > maxDistanceSeconds) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = crossingTime;
    }
  }

  return bestTime;
}

export function snapSourceTimeToZeroCrossing(
  buffer: AudioBuffer,
  sourceTime: number,
  opts: SnapSourceTimeToZeroCrossingOptions = {},
): number | null {
  const channelCount = buffer.numberOfChannels;
  if (!Number.isInteger(channelCount) || channelCount <= 0) return null;
  const channel = clampInt(opts.channel ?? 0, 0, channelCount - 1);
  return findNearestZeroCrossing(
    buffer.getChannelData(channel),
    buffer.sampleRate,
    sourceTime,
    opts.maxDistanceSeconds ?? DEFAULT_MAX_DISTANCE_SECONDS,
    opts.prefer ?? 'nearest',
  );
}

/**
 * Finds a sample boundary that is quiet across every channel. A per-channel
 * zero crossing is not sufficient for stereo material because the other
 * channel can still be near a peak at that instant. The small distance term
 * keeps the phonetic boundary authoritative while preferring a low-amplitude,
 * low-jump sample when one is available nearby.
 */
export function findLowestDiscontinuitySample(
  channels: readonly Float32Array[],
  sampleRate: number,
  sourceTime: number,
  maxDistanceSeconds: number,
): number | null {
  if (channels.length === 0 || channels.some((channel) => channel.length < 2)) return null;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (!Number.isFinite(sourceTime) || sourceTime < 0) return null;
  if (!Number.isFinite(maxDistanceSeconds) || maxDistanceSeconds <= 0) return null;

  const usableLength = Math.min(...channels.map((channel) => channel.length));
  const sourceSample = sourceTime * sampleRate;
  if (sourceSample > usableLength - 1) return null;

  const radius = Math.max(1, Math.ceil(maxDistanceSeconds * sampleRate));
  const center = clampInt(Math.round(sourceSample), 0, usableLength - 1);
  const first = Math.max(0, center - radius);
  const last = Math.min(usableLength - 1, center + radius);
  let bestSample = center;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let sample = first; sample <= last; sample += 1) {
    let peak = 0;
    let mean = 0;
    let jump = 0;
    let valid = true;
    for (const channel of channels) {
      const value = channel[sample];
      if (!Number.isFinite(value)) {
        valid = false;
        break;
      }
      const magnitude = Math.abs(value);
      peak = Math.max(peak, magnitude);
      mean += magnitude;
      if (sample > 0) {
        const previous = channel[sample - 1];
        if (!Number.isFinite(previous)) {
          valid = false;
          break;
        }
        jump += Math.abs(value - previous);
      }
    }
    if (!valid) continue;

    mean /= channels.length;
    jump /= channels.length;
    const distance = Math.abs(sample - sourceSample) / radius;
    const score = peak + mean * 0.25 + jump * 0.05 + distance * 0.02;
    if (score < bestScore) {
      bestScore = score;
      bestSample = sample;
    }
  }

  return Number.isFinite(bestScore) ? bestSample / sampleRate : null;
}

export function snapSourceTimeToLowDiscontinuity(
  buffer: AudioBuffer,
  sourceTime: number,
  opts: SnapSourceTimeToLowDiscontinuityOptions = {},
): number | null {
  if (!Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels <= 0) return null;
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  );
  return findLowestDiscontinuitySample(
    channels,
    buffer.sampleRate,
    sourceTime,
    opts.maxDistanceSeconds ?? DEFAULT_MAX_DISTANCE_SECONDS,
  );
}

class ZeroCrossingSnapCache {
  private readonly entries = new Map<string, ZeroCrossingSnapCacheEntry>();

  get(key: string): ZeroCrossingSnapCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, value: ZeroCrossingSnapCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  clear(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(key);
  }
}

export const zeroCrossingSnapCache = new ZeroCrossingSnapCache();
