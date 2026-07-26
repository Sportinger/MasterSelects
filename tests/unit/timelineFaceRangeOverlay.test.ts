import { describe, expect, it } from 'vitest';
import {
  collectTimelineFaceRanges,
  getTimelineFaceIdentityColor,
  getTimelineFaceRangeRatios,
} from '../../src/components/timeline/utils/timelineFaceRangeOverlay';

describe('timeline face range overlay', () => {
  it('unifies overlapping appearances from anonymous people', () => {
    const ranges = collectTimelineFaceRanges({
      analysis: {
        faceAnalysis: {
          people: [
            { id: 'person-1', appearances: [{ start: 2, end: 5 }, { start: 9, end: 10 }] },
            { id: 'person-2', appearances: [{ start: 4.5, end: 7 }] },
          ],
        },
      },
    });

    expect(ranges).toEqual([
      { start: 2, end: 7 },
      { start: 9, end: 10 },
    ]);
  });

  it('maps trimmed and reversed source ranges into clip-local positions', () => {
    const ranges = [{ start: 2, end: 7 }, { start: 9, end: 10 }];

    const forward = getTimelineFaceRangeRatios(ranges, 3, 9, false);
    const reversed = getTimelineFaceRangeRatios(ranges, 3, 9, true);

    expect(forward[0]).toMatchObject({ start: 0, end: expect.closeTo(2 / 3) });
    expect(forward[1]).toEqual({ start: 1, end: 1 });
    expect(reversed[0]).toMatchObject({ start: expect.closeTo(1 / 3), end: 1 });
    expect(reversed[1]).toEqual({ start: 0, end: 0 });
  });

  it('uses sampled frame face counts when compact face analysis is unavailable', () => {
    const ranges = collectTimelineFaceRanges({
      analysis: {
        sampleInterval: 1000,
        frames: [
          { timestamp: 1, faceCount: 1 },
          { timestamp: 2, faceCount: 1 },
          { timestamp: 3, faceCount: 0 },
        ],
      },
    });

    expect(ranges).toEqual([{ start: 0.5, end: 2.5 }]);
  });

  it('assigns the same visual colour to one anonymous person everywhere', () => {
    expect(getTimelineFaceIdentityColor('person-1')).toEqual(getTimelineFaceIdentityColor('person-1'));
    expect(getTimelineFaceIdentityColor('person-1').rgb).toHaveLength(3);
  });
});
