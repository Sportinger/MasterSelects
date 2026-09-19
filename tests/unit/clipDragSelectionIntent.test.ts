import { describe, expect, it } from 'vitest';
import {
  CLIP_DRAG_INTENT_THRESHOLD_PX,
  hasClipDragIntent,
  shouldDeselectClipOnPointerRelease,
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

  it('toggles an already-selected clip off on a plain click', () => {
    expect(shouldDeselectClipOnPointerRelease(true, false, false)).toBe(true);
    expect(shouldDeselectClipOnPointerRelease(true, true, false)).toBe(false);
    expect(shouldDeselectClipOnPointerRelease(false, false, false)).toBe(false);
  });

  it('preserves a preselected clip after dragging and clears only temporary drag selection', () => {
    expect(shouldDeselectClipOnPointerRelease(true, false, true)).toBe(false);
    expect(shouldDeselectClipOnPointerRelease(false, false, true)).toBe(true);
    expect(shouldDeselectClipOnPointerRelease(true, true, true)).toBe(false);
  });
});
