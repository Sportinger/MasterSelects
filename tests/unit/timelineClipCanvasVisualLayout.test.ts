import { describe, expect, it } from 'vitest';
import { getTimelineClipCanvasVisualPreviewHeight } from '../../src/components/timeline/utils/timelineClipCanvasVisualLayout';

describe('timeline clip canvas visual layout', () => {
  it('reserves the lower quarter of a default video clip for color and title', () => {
    expect(getTimelineClipCanvasVisualPreviewHeight(68)).toBe(51);
  });

  it('keeps a readable title strip when the video track is compact', () => {
    expect(getTimelineClipCanvasVisualPreviewHeight(48)).toBe(34);
  });

  it('handles non-drawable heights without producing invalid geometry', () => {
    expect(getTimelineClipCanvasVisualPreviewHeight(0)).toBe(0);
    expect(getTimelineClipCanvasVisualPreviewHeight(Number.NaN)).toBe(0);
  });
});
