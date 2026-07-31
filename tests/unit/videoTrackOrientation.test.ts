import { describe, expect, it } from 'vitest';

import {
  getOrientedVideoDimensions,
  getVideoTrackRotation,
} from '../../src/engine/webcodecs/videoTrackOrientation';

describe('video track orientation', () => {
  it.each([
    [[65536, 0, 0, 0, 65536], 0],
    [[0, 65536, 0, -65536, 0], 90],
    [[-65536, 0, 0, 0, -65536], 180],
    [[0, -65536, 0, 65536, 0], 270],
  ] as const)('reads the MP4 track matrix %#', (matrix, expected) => {
    expect(getVideoTrackRotation({ matrix })).toBe(expected);
  });

  it('swaps decoded dimensions for quarter-turn tracks', () => {
    expect(getOrientedVideoDimensions(1024, 576, 90)).toEqual({
      width: 576,
      height: 1024,
    });
  });
});
