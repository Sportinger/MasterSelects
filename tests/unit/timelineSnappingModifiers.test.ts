import { describe, expect, it } from 'vitest';
import { isTimelineSnappingActive } from '../../src/components/timeline/utils/timelineSnappingModifiers';

describe('timeline snapping modifiers', () => {
  it('uses the persistent toggle when no modifier is held', () => {
    expect(isTimelineSnappingActive(true, {})).toBe(true);
    expect(isTimelineSnappingActive(false, {})).toBe(false);
  });

  it('temporarily enables snapping with Shift and lets Alt win as the bypass', () => {
    expect(isTimelineSnappingActive(false, { shiftKey: true })).toBe(true);
    expect(isTimelineSnappingActive(true, { altKey: true })).toBe(false);
    expect(isTimelineSnappingActive(false, { shiftKey: true, altKey: true })).toBe(false);
  });
});
