import { describe, expect, it } from 'vitest';
import { preparedTemporalMemory, preparedTemporalWindow, type PreparedTemporalWindowInput } from '../../src/effects/time/preparedTemporalWindow';

const base: PreparedTemporalWindowInput = {
  localTime: 2, duration: 5, horizon: 2, direction: 'past', samples: 3,
  sourceTimeAt: time => 10 + time * 2,
};

describe('prepared temporal window', () => {
  it('converts output delays through trim and playback speed after holding at clip boundaries', () => {
    expect(preparedTemporalWindow(base).map(sample => sample.sourceTime)).toEqual([14, 12, 10]);
    expect(preparedTemporalWindow({ ...base, localTime: 0.5 }).map(sample => sample.sourceTime)).toEqual([11, 10, 10]);
    expect(preparedTemporalWindow({ ...base, localTime: 4.5, direction: 'future' }).map(sample => sample.sourceTime)).toEqual([19, 20, 20]);
  });
  it('uses the same timing resolver for reverse and nonlinear speed ramps', () => {
    expect(preparedTemporalWindow({ ...base, sourceTimeAt: time => 20 - time * 2 }).map(sample => sample.sourceTime)).toEqual([16, 18, 20]);
    expect(preparedTemporalWindow({ ...base, sourceTimeAt: time => 10 + time * time }).map(sample => sample.sourceTime)).toEqual([14, 11, 10]);
  });
  it('defines future and symmetric windows independently of prior playback', () => {
    const future = preparedTemporalWindow({ ...base, direction: 'future' });
    expect(future.map(sample => sample.outputTime)).toEqual([2, 3, 4]);
    expect(preparedTemporalWindow({ ...base, direction: 'symmetric' }).map(sample => sample.outputTime)).toEqual([1, 2, 3]);
    preparedTemporalWindow({ ...base, localTime: 0 });
    expect(preparedTemporalWindow({ ...base, direction: 'future' })).toEqual(future);
    expect(preparedTemporalWindow({ ...base, horizon: 0 }).map(sample => sample.sourceTime)).toEqual([14, 14, 14]);
  });
  it('accounts for CPU frames, full GPU atlas and metadata before allocation', () => {
    const memory = preparedTemporalMemory(640, 360, 32, 96 * 1024 * 1024);
    expect(memory.totalBytes).toBe(640 * 360 * 4 * 96 + 65 * 16);
    expect(() => preparedTemporalMemory(1920, 1080, 64, 128 * 1024 * 1024)).toThrow(/budget/);
    expect(() => preparedTemporalWindow({ ...base, samples: 65 })).toThrow(/samples/);
    expect(() => preparedTemporalWindow({ ...base, sourceTimeAt: () => NaN })).toThrow(/timestamp/);
  });
});
