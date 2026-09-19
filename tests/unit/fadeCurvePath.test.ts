import { describe, expect, it } from 'vitest';
import { buildFadeCurvePath } from '../../src/components/timeline/utils/fadeCurvePath';
import { applyTimelineTrimFadePreview } from '../../src/components/timeline/utils/timelineTrimFadePreview';

const extractPathNumbers = (path: string): number[] => (
  path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
);

describe('fade curve path builder', () => {
  it('retimes the clip-painted opacity curve during an active edge trim', () => {
    const preview = applyTimelineTrimFadePreview({
      keyframes: [0, 1, 4, 6, 8].map((time, index) => ({
        id: `opacity-${index}`,
        time,
        value: index % 2,
        easing: 'linear',
      })),
      clipDuration: 8,
      isAudioClip: false,
    }, {
      id: 'clip-a',
      startTime: 5,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      source: { type: 'video', naturalDuration: 20 },
    }, {
      clipId: 'clip-a',
      edge: 'left',
      originalStartTime: 5,
      originalDuration: 8,
      originalInPoint: 0,
      originalOutPoint: 8,
      startX: 0,
      currentX: 20,
      altKey: false,
      snapIndicatorTime: null,
      isSnapping: false,
      appliedDelta: 2,
    });

    expect(preview.clipDuration).toBe(6);
    expect(preview.keyframes.map((keyframe) => keyframe.time)).toEqual([0, 1, 2, 4, 6]);
  });

  it('builds the same cubic path shape for linear keyframes used by DOM and canvas', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1, value: 1, easing: 'linear' },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    const curveNumbers = extractPathNumbers(path?.curvePath ?? '');
    expect(curveNumbers).toHaveLength(8);
    expect(curveNumbers).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(40, 6),
      expect.closeTo(20 / 3, 6),
      expect.closeTo(80 / 3, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(20, 6),
      expect.closeTo(0, 6),
    ]);
    expect(path?.fillPath).toBe(`${path?.curvePath} L 20 40 L 0 40 Z`);
    expect(path?.points).toEqual([
      { x: 0, y: 40 },
      { x: 20, y: 0 },
    ]);
  });

  it('preserves custom bezier handles', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'bezier', handleOut: { x: 0.5, y: 0.25 } },
        { time: 2, value: 1, easing: 'linear', handleIn: { x: -0.5, y: -0.25 } },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    expect(path?.curvePath).toContain('C 10 30, 30 10, 40 0');
  });

  it('updates from an incoming handle before the outgoing handle is customized', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 2, value: 1, easing: 'bezier', handleIn: { x: -0.25, y: -0.75 } },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    expect(extractPathNumbers(path?.curvePath ?? '')).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(40, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(80 / 3, 6),
      expect.closeTo(35, 6),
      expect.closeTo(30, 6),
      expect.closeTo(40, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it('updates from an outgoing handle before the incoming handle is customized', () => {
    const path = buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'bezier', handleOut: { x: 0.25, y: 0.75 } },
        { time: 2, value: 1, easing: 'linear' },
      ],
      clipDuration: 4,
      width: 80,
      height: 40,
    });

    expect(extractPathNumbers(path?.curvePath ?? '')).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(40, 6),
      expect.closeTo(5, 6),
      expect.closeTo(10, 6),
      expect.closeTo(80 / 3, 6),
      expect.closeTo(40 / 3, 6),
      expect.closeTo(40, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it('skips invalid geometry or incomplete keyframes', () => {
    expect(buildFadeCurvePath({
      keyframes: [{ time: 0, value: 0, easing: 'linear' }],
      clipDuration: 4,
      width: 80,
      height: 40,
    })).toBeNull();
    expect(buildFadeCurvePath({
      keyframes: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1, value: 1, easing: 'linear' },
      ],
      clipDuration: 0,
      width: 80,
      height: 40,
    })).toBeNull();
  });
});
