import { beforeEach, describe, expect, it } from 'vitest';
import {
  findLowestDiscontinuitySample,
  findNearestZeroCrossing,
  snapSourceTimeToLowDiscontinuity,
  snapSourceTimeToZeroCrossing,
  zeroCrossingSnapCache,
} from '../../../src/services/audio/sampleAccurateSnap';

const SAMPLE_RATE = 1000;
const FREQUENCY = 50;
const PHASE = Math.PI / 4;

function crossingTime(k: number): number {
  return (k - 0.25) / (2 * FREQUENCY);
}

function createSineData(durationSeconds = 2): Float32Array {
  const data = new Float32Array(Math.round(durationSeconds * SAMPLE_RATE) + 1);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.sin(2 * Math.PI * FREQUENCY * (i / SAMPLE_RATE) + PHASE);
  }
  return data;
}

function createMockAudioBuffer(channels: Float32Array[]): AudioBuffer {
  return {
    sampleRate: SAMPLE_RATE,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    duration: (channels[0]?.length ?? 0) / SAMPLE_RATE,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('findNearestZeroCrossing', () => {
  const data = createSineData();

  it('returns the interpolated time of the nearest zero crossing', () => {
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, 0.02, 0.01)).toBeCloseTo(crossingTime(2), 6);
  });

  it('interpolates crossings between samples with sub-microsecond accuracy', () => {
    for (let k = 1; k <= 5; k += 1) {
      const expected = crossingTime(k);
      const result = findNearestZeroCrossing(data, SAMPLE_RATE, expected + 0.001, 0.01);
      expect(result).not.toBeNull();
      expect(Math.abs((result as number) - expected)).toBeLessThan(1e-6);
    }
  });

  it('respects prefer before and after directionality', () => {
    const sourceTime = 0.026;
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, sourceTime, 0.01, 'nearest')).toBeCloseTo(crossingTime(3), 6);
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, sourceTime, 0.01, 'before')).toBeCloseTo(crossingTime(2), 6);
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, sourceTime, 0.01, 'after')).toBeCloseTo(crossingTime(3), 6);
  });

  it('returns null when no crossing lies within maxDistanceSeconds', () => {
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, 0.022, 0.004)).toBeNull();
  });

  it('returns null for a signal without sign changes', () => {
    const flat = new Float32Array(100).fill(0.5);
    expect(findNearestZeroCrossing(flat, SAMPLE_RATE, 0.05, 0.02)).toBeNull();
  });

  it('treats an exact zero sample as a crossing', () => {
    const exact = new Float32Array([1, 0, -1, -1]);
    expect(findNearestZeroCrossing(exact, SAMPLE_RATE, 0.002, 0.005)).toBeCloseTo(0.001, 9);
  });

  it('returns null for invalid inputs', () => {
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, Number.NaN, 0.01)).toBeNull();
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, -0.5, 0.01)).toBeNull();
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, 100, 0.01)).toBeNull();
    expect(findNearestZeroCrossing(data, 0, 0.02, 0.01)).toBeNull();
    expect(findNearestZeroCrossing(data, Number.POSITIVE_INFINITY, 0.02, 0.01)).toBeNull();
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, 0.02, 0)).toBeNull();
    expect(findNearestZeroCrossing(data, SAMPLE_RATE, 0.02, Number.NaN)).toBeNull();
    expect(findNearestZeroCrossing(new Float32Array(1), SAMPLE_RATE, 0, 0.01)).toBeNull();
  });
});

describe('snapSourceTimeToZeroCrossing', () => {
  const sine = createSineData();
  const flat = new Float32Array(sine.length).fill(0.5);

  it('snaps using channel 0 by default with a 10 ms window', () => {
    const buffer = createMockAudioBuffer([sine, flat]);
    expect(snapSourceTimeToZeroCrossing(buffer, 0.02, {})).toBeCloseTo(crossingTime(2), 6);
  });

  it('reads the requested channel', () => {
    const buffer = createMockAudioBuffer([flat, sine]);
    expect(snapSourceTimeToZeroCrossing(buffer, 0.02, {})).toBeNull();
    expect(snapSourceTimeToZeroCrossing(buffer, 0.02, { channel: 1 })).toBeCloseTo(crossingTime(2), 6);
  });

  it('forwards maxDistanceSeconds and prefer options', () => {
    const buffer = createMockAudioBuffer([sine]);
    expect(snapSourceTimeToZeroCrossing(buffer, 0.022, { maxDistanceSeconds: 0.004 })).toBeNull();
    expect(snapSourceTimeToZeroCrossing(buffer, 0.026, { prefer: 'before' })).toBeCloseTo(crossingTime(2), 6);
  });
});

describe('multi-channel low-discontinuity snapping', () => {
  it('chooses the quiet shared sample instead of a zero crossing on only one channel', () => {
    const left = new Float32Array(40).fill(0.6);
    const right = new Float32Array(40).fill(0.6);
    left[10] = 0;
    right[10] = 0.9;
    left[12] = 0.01;
    right[12] = -0.01;

    expect(findLowestDiscontinuitySample([left, right], SAMPLE_RATE, 0.01, 0.005))
      .toBeCloseTo(0.012, 9);
    expect(snapSourceTimeToLowDiscontinuity(
      createMockAudioBuffer([left, right]),
      0.01,
      { maxDistanceSeconds: 0.005 },
    )).toBeCloseTo(0.012, 9);
  });

  it('keeps an already silent boundary at the requested sample', () => {
    const silent = new Float32Array(40);
    expect(findLowestDiscontinuitySample([silent, silent], SAMPLE_RATE, 0.017, 0.005))
      .toBeCloseTo(0.017, 9);
  });

  it('fails closed for invalid multi-channel inputs', () => {
    expect(findLowestDiscontinuitySample([], SAMPLE_RATE, 0.01, 0.005)).toBeNull();
    expect(findLowestDiscontinuitySample([new Float32Array(1)], SAMPLE_RATE, 0, 0.005)).toBeNull();
    expect(findLowestDiscontinuitySample([new Float32Array(10)], 0, 0.005, 0.005)).toBeNull();
  });
});

describe('zeroCrossingSnapCache', () => {
  const entry = (sampleRate: number) => ({ channelData: new Float32Array(4), sampleRate });

  beforeEach(() => {
    zeroCrossingSnapCache.clear();
  });

  it('evicts the oldest entry beyond four entries', () => {
    zeroCrossingSnapCache.set('a', entry(1));
    zeroCrossingSnapCache.set('b', entry(2));
    zeroCrossingSnapCache.set('c', entry(3));
    zeroCrossingSnapCache.set('d', entry(4));
    zeroCrossingSnapCache.set('e', entry(5));

    expect(zeroCrossingSnapCache.get('a')).toBeUndefined();
    expect(zeroCrossingSnapCache.get('b')?.sampleRate).toBe(2);
    expect(zeroCrossingSnapCache.get('e')?.sampleRate).toBe(5);
  });

  it('refreshes recency on get', () => {
    zeroCrossingSnapCache.set('a', entry(1));
    zeroCrossingSnapCache.set('b', entry(2));
    zeroCrossingSnapCache.set('c', entry(3));
    zeroCrossingSnapCache.set('d', entry(4));
    zeroCrossingSnapCache.get('a');
    zeroCrossingSnapCache.set('e', entry(5));

    expect(zeroCrossingSnapCache.get('a')?.sampleRate).toBe(1);
    expect(zeroCrossingSnapCache.get('b')).toBeUndefined();
  });

  it('clears a single key or all keys', () => {
    zeroCrossingSnapCache.set('a', entry(1));
    zeroCrossingSnapCache.set('b', entry(2));

    zeroCrossingSnapCache.clear('a');
    expect(zeroCrossingSnapCache.get('a')).toBeUndefined();
    expect(zeroCrossingSnapCache.get('b')?.sampleRate).toBe(2);

    zeroCrossingSnapCache.clear();
    expect(zeroCrossingSnapCache.get('b')).toBeUndefined();
  });
});
