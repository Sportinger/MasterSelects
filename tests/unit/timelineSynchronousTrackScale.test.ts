import { describe, expect, it } from 'vitest';

import { resolveSynchronousTrackScaleVideoHeight } from '../../src/components/timeline/hooks/useTimelineSectionLayout';

describe('synchronous timeline track scaling', () => {
  it('moves the divider with the complete video stack while room remains', () => {
    expect(resolveSynchronousTrackScaleVideoHeight(
      'video',
      260,
      100,
      400,
      4,
      2,
    )).toBe(260);
  });

  it('keeps the other section touchable when the scaled stack exceeds the viewport', () => {
    expect(resolveSynchronousTrackScaleVideoHeight(
      'video',
      600,
      100,
      400,
      4,
      2,
    )).toBe(368);
  });

  it('moves the divider upward when audio tracks are scaled together', () => {
    expect(resolveSynchronousTrackScaleVideoHeight(
      'audio',
      180,
      240,
      400,
      4,
      3,
    )).toBe(160);
  });
});
