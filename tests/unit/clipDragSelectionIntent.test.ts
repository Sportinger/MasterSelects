import { describe, expect, it } from 'vitest';
import {
  CLIP_DRAG_INTENT_THRESHOLD_PX,
  hasClipDragIntent,
} from '../../src/components/timeline/utils/clipDragSelectionIntent';

describe('clip drag selection intent', () => {
  it('keeps a stationary Shift gesture available for selection toggling', () => {
    expect(hasClipDragIntent(100, 50, 100, 50)).toBe(false);
    expect(hasClipDragIntent(
      100,
      50,
      100 + CLIP_DRAG_INTENT_THRESHOLD_PX - 0.1,
      50,
    )).toBe(false);
  });

  it('recognizes horizontal or vertical movement as drag intent', () => {
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
  });
});
