import { describe, expect, it } from 'vitest';
import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_WIDTH,
} from '../../src/types/sceneCutAnalysis';
import {
  getSceneCutCompletenessError,
  isCurrentSceneCutAnalysis,
  SceneCutDetector,
} from '../../src/services/sceneCutDetection/sceneCutDetector';
import { convertMediaFiles } from '../../src/services/project/projectMediaSerialization';
import type { MediaFile } from '../../src/stores/mediaStore';

const PIXEL_COUNT = SCENE_CUT_ANALYSIS_WIDTH * SCENE_CUT_ANALYSIS_HEIGHT;

function solidFrame(red: number, green: number, blue: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PIXEL_COUNT * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return data;
}

function checkerFrame(offsetX: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PIXEL_COUNT * 4);
  for (let y = 0; y < SCENE_CUT_ANALYSIS_HEIGHT; y += 1) {
    for (let x = 0; x < SCENE_CUT_ANALYSIS_WIDTH; x += 1) {
      const value = (Math.floor((x + offsetX) / 8) + Math.floor(y / 8)) % 2 === 0
        ? 28
        : 224;
      const offset = (y * SCENE_CUT_ANALYSIS_WIDTH + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function interviewShot(subjectLeft: number, red: number, green: number, blue: number): Uint8ClampedArray {
  const data = solidFrame(18, 24, 30);
  for (let y = 12; y < SCENE_CUT_ANALYSIS_HEIGHT - 12; y += 1) {
    for (let x = subjectLeft; x < subjectLeft + 48; x += 1) {
      const offset = (y * SCENE_CUT_ANALYSIS_WIDTH + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
    }
  }
  return data;
}

function pushStableFrames(
  detector: SceneCutDetector,
  frame: Uint8ClampedArray,
  count: number,
  startFrame = 0,
): void {
  for (let index = 0; index < count; index += 1) {
    const frameNumber = startFrame + index;
    detector.pushFrame(frame, frameNumber / 30, frameNumber);
  }
}

describe('SceneCutDetector', () => {
  it('keeps an unchanged sequence free of cuts', () => {
    const detector = new SceneCutDetector();
    pushStableFrames(detector, solidFrame(30, 40, 50), 20);

    const result = detector.complete(20 / 30);

    expect(result.sourceFrameCount).toBe(20);
    expect(result.cuts).toEqual([]);
    expect(result.analysisWidth).toBe(160);
    expect(result.analysisHeight).toBe(90);
  });

  it('places a hard cut on the first frame of the new shot', () => {
    const detector = new SceneCutDetector();
    const before = solidFrame(8, 12, 16);
    const after = solidFrame(235, 210, 180);
    pushStableFrames(detector, before, 8);
    pushStableFrames(detector, after, 8, 8);

    const result = detector.complete(16 / 30);

    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].frameNumber).toBe(8);
    expect(result.cuts[0].timestamp).toBeCloseTo(8 / 30, 6);
    expect(result.cuts[0].changedRatio).toBeGreaterThan(0.99);
  });

  it('detects a shot/reverse-shot cut when most of the background is unchanged', () => {
    const detector = new SceneCutDetector();
    const before = interviewShot(20, 128, 90, 62);
    const after = interviewShot(92, 112, 78, 58);
    pushStableFrames(detector, before, 8);
    pushStableFrames(detector, after, 8, 8);

    const result = detector.complete(16 / 30);

    expect(result.cuts.map((cut) => cut.frameNumber)).toEqual([8]);
    expect(result.cuts[0].changedRatio).toBeLessThan(0.45);
  });

  it('suppresses a one-frame flash that returns to the previous shot', () => {
    const detector = new SceneCutDetector();
    const shot = solidFrame(24, 28, 32);
    const flash = solidFrame(255, 255, 255);
    pushStableFrames(detector, shot, 8);
    detector.pushFrame(flash, 8 / 30, 8);
    pushStableFrames(detector, shot, 8, 9);

    const result = detector.complete(17 / 30);

    expect(result.cuts).toEqual([]);
  });

  it('does not classify a small translated checkerboard as a cut', () => {
    const detector = new SceneCutDetector();
    const original = checkerFrame(0);
    const translated = checkerFrame(1);
    pushStableFrames(detector, original, 8);
    pushStableFrames(detector, translated, 8, 8);

    const result = detector.complete(16 / 30);

    expect(result.cuts).toEqual([]);
  });

  it('motion-compensates an eight-pixel fast pan', () => {
    const detector = new SceneCutDetector();
    const original = checkerFrame(0);
    const translated = checkerFrame(8);
    pushStableFrames(detector, original, 8);
    pushStableFrames(detector, translated, 8, 8);

    const result = detector.complete(16 / 30);

    expect(result.cuts).toEqual([]);
  });

  it('detects a cut near the beginning before adaptive history is full', () => {
    const detector = new SceneCutDetector();
    const before = solidFrame(4, 8, 12);
    const after = solidFrame(240, 190, 80);
    pushStableFrames(detector, before, 2);
    pushStableFrames(detector, after, 4, 2);

    const result = detector.complete(6 / 30);

    expect(result.cuts.map((cut) => cut.frameNumber)).toEqual([2]);
  });

  it('keeps two short but persistent shots as adjacent real cuts', () => {
    const detector = new SceneCutDetector();
    pushStableFrames(detector, solidFrame(10, 20, 30), 7);
    pushStableFrames(detector, solidFrame(220, 180, 40), 2, 7);
    pushStableFrames(detector, solidFrame(30, 70, 220), 4, 9);

    const result = detector.complete(13 / 30);

    expect(result.cuts.map((cut) => cut.frameNumber)).toEqual([7, 9]);
  });

  it('does not emit an unconfirmed final-frame flash', () => {
    const detector = new SceneCutDetector();
    const shot = solidFrame(18, 24, 30);
    pushStableFrames(detector, shot, 8);
    detector.pushFrame(solidFrame(255, 255, 255), 8 / 30, 8);

    const result = detector.complete(9 / 30);

    expect(result.cuts).toEqual([]);
  });

  it('does not turn a gradual dissolve into a hard cut', () => {
    const detector = new SceneCutDetector();
    for (let frameNumber = 0; frameNumber < 24; frameNumber += 1) {
      const value = Math.round((frameNumber / 23) * 255);
      detector.pushFrame(
        solidFrame(value, value, value),
        frameNumber / 30,
        frameNumber,
      );
    }

    const result = detector.complete(24 / 30);

    expect(result.cuts).toEqual([]);
  });

  it('uses presentation timestamps without assuming a constant frame rate', () => {
    const detector = new SceneCutDetector();
    const before = solidFrame(12, 18, 26);
    const after = solidFrame(210, 40, 150);
    const timestamps = [0, 0.04, 0.083, 0.125, 0.2, 0.238, 0.31, 0.365];
    timestamps.slice(0, 5).forEach((timestamp, frameNumber) => {
      detector.pushFrame(before, timestamp, frameNumber);
    });
    timestamps.slice(5).forEach((timestamp, index) => {
      detector.pushFrame(after, timestamp, index + 5);
    });

    const result = detector.complete(0.4);

    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].timestamp).toBe(0.238);
    expect(result.cuts[0].frameNumber).toBe(5);
  });

  it('invalidates cached analysis when the source fingerprint changes', () => {
    const detector = new SceneCutDetector();
    pushStableFrames(detector, solidFrame(20, 30, 40), 4);
    const analysis = detector.complete(
      4 / 30,
      4,
      { size: 1024, lastModified: 1234 },
    );

    expect(isCurrentSceneCutAnalysis(analysis, {
      size: 1024,
      lastModified: 1234,
    })).toBe(true);
    expect(isCurrentSceneCutAnalysis(analysis, {
      size: 2048,
      lastModified: 1234,
    })).toBe(false);
  });

  it('rejects incomplete decode passes instead of caching frame-inexact results', () => {
    expect(getSceneCutCompletenessError(
      { sourceFrameCount: 99 },
      {
        decodeErrors: 0,
        expectedFrameCount: 100,
        skippedSamplesBeforeFirstKeyframe: 0,
      },
    )).toContain('99/100');
    expect(getSceneCutCompletenessError(
      { sourceFrameCount: 100 },
      {
        decodeErrors: 1,
        expectedFrameCount: 100,
        skippedSamplesBeforeFirstKeyframe: 0,
      },
    )).toContain('could not be decoded');
    expect(getSceneCutCompletenessError(
      { sourceFrameCount: 100 },
      {
        decodeErrors: 0,
        expectedFrameCount: 100,
        skippedSamplesBeforeFirstKeyframe: 0,
      },
    )).toBeNull();
  });

  it('persists the source-level cut index in project media metadata', () => {
    const detector = new SceneCutDetector();
    pushStableFrames(detector, solidFrame(10, 20, 30), 6);
    pushStableFrames(detector, solidFrame(220, 180, 40), 4, 6);
    const analysis = detector.complete(
      10 / 30,
      10,
      { size: 4096, lastModified: 5678 },
    );
    const mediaFile: MediaFile = {
      id: 'media-scene-cuts',
      name: 'shots.mp4',
      type: 'video',
      parentId: null,
      createdAt: 123,
      url: 'blob:shots',
      filePath: 'shots.mp4',
      sceneCutStatus: 'ready',
      sceneCutProgress: 100,
      sceneCutAnalysis: analysis,
    };

    const serialized = convertMediaFiles([mediaFile])[0];

    expect(serialized.sceneCutAnalysis).toEqual(analysis);
    expect(serialized.sceneCutAnalysis).not.toBe(analysis);
  });
});
