import { describe, expect, it } from 'vitest';
import {
  CLIP_DRAG_INTENT_THRESHOLD_PX,
  hasClipDragIntent,
} from '../../src/components/timeline/utils/clipDragSelectionIntent';

describe('clip drag intent', () => {
  it('keeps stationary and small pointer jitter as an ordinary click', () => {
    expect(hasClipDragIntent(100, 50, 100, 50)).toBe(false);
    expect(hasClipDragIntent(
      100,
      50,
      100 + CLIP_DRAG_INTENT_THRESHOLD_PX - 0.1,
      50,
    )).toBe(false);
    expect(hasClipDragIntent(100, 50, 103, 53)).toBe(false);
  });

  it('recognizes deliberate movement as drag intent', () => {
    expect(hasClipDragIntent(
      100,
      50,
      100 + CLIP_DRAG_INTENT_THRESHOLD_PX,
      50,
    )).toBe(true);
    expect(hasClipDragIntent(
      100,
      50,
      100,
      50 + CLIP_DRAG_INTENT_THRESHOLD_PX,
    )).toBe(true);
    expect(hasClipDragIntent(100, 50, 105, 54)).toBe(true);
  });
});
