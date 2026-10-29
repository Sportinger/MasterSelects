import { describe, expect, it } from 'vitest';
import {
  assertAudioVideoSync,
  compareFrameSequence,
  describeSequenceProblems,
  expectedSourceFrames,
  findClicks,
} from '../playwright/assertions/fastExportOracle';

// The oracle of the Fast export journeys (tests/playwright/export/fast).

describe('Fast export oracle', () => {
  it('maps output frames to the nearest source frame with ties going to the later one', () => {
    const cfr = Array.from({ length: 90 }, (_, frame) => frame / 30);
    expect(expectedSourceFrames({ outputFrames: 30, outputFps: 30, sourceStart: 1, sourceTimestamps: cfr }))
      .toEqual(Array.from({ length: 30 }, (_, frame) => 30 + frame));
    // Gap after frame 2, frame 4 delayed by a quarter frame: frame 3's time is nearer frame 2.
    const vfr = [0, 1, 2, 4.25, 5, 6].map(frame => frame / 30);
    expect(expectedSourceFrames({ outputFrames: 6, outputFps: 30, sourceStart: 0, sourceTimestamps: vfr }))
      .toEqual([0, 1, 2, 2, 3, 4]);
    // An exact tie picks the later sample.
    expect(expectedSourceFrames({ outputFrames: 1, outputFps: 30, sourceStart: 1.5 / 30, sourceTimestamps: [0, 1 / 30, 2 / 30] }))
      .toEqual([2]);
    expect(expectedSourceFrames({ outputFrames: 3, outputFps: 30, sourceStart: 0, speed: 2, sourceTimestamps: cfr })).toEqual([0, 2, 4]);
  });

  it('names every differing frame', () => {
    const problems = compareFrameSequence([0, 1, 3, null], [0, 1, 2, 3, 4]);
    expect(problems).toEqual([
      { outputFrame: 2, expected: 2, actual: 3 },
      { outputFrame: 3, expected: 3, actual: null },
      { outputFrame: 4, expected: 4, actual: null },
    ]);
    expect(describeSequenceProblems(problems)).toMatch(/3 frame\(s\) differ: frame 2: expected 2, got 3/);
  });

  it('finds one click per loud burst, shifted by the audio start', () => {
    const rate = 1000;
    const samples = new Float32Array(3000);
    for (const second of [0, 1, 2]) for (let i = 0; i < 10; i += 1) samples[second * rate + i] = i % 2 ? 0.8 : -0.8;
    expect(findClicks(samples, rate)).toEqual([0, 1, 2]);
    expect(findClicks(samples, rate, 0.02).map(time => Number(time.toFixed(3)))).toEqual([0.02, 1.02, 2.02]);
  });

  it('pairs flashes with their nearest click and rejects an offset beyond the tolerance', () => {
    expect(assertAudioVideoSync({ flashTimes: [0, 1, 2], clickTimes: [0.01, 1.01, 2.0] }, 1 / 30, 3).map(o => Number(o.toFixed(3))))
      .toEqual([0.01, 0.01, 0]);
    expect(() => assertAudioVideoSync({ flashTimes: [0, 1], clickTimes: [0.1, 1.1] }, 1 / 30, 2)).toThrow(/exceeds 33.3 ms/);
    expect(() => assertAudioVideoSync({ flashTimes: [0], clickTimes: [0] }, 1 / 30, 2)).toThrow(/Only 1 flash\/click pairs/);
    expect(() => assertAudioVideoSync({ flashTimes: [0], clickTimes: null }, 1 / 30, 1)).toThrow(/no audio track/);
  });
});
