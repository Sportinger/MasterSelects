import { describe, expect, it } from 'vitest';
import {
  getTimelineClipCanvasPassiveDecorationBadges,
  hasTimelineClipCanvasPassiveDecorations,
} from '../../src/components/timeline/utils/timelineClipCanvasPassiveDecorations';

describe('timeline rule badge', () => {
  it('marks rule-placed clips and their manual corrections', () => {
    const clip = { id: 'c', duration: 2, trackType: 'video' as const };
    expect(hasTimelineClipCanvasPassiveDecorations(clip)).toBe(false);
    for (const [role, label] of [['rule', 'Rule'], ['corrected', 'Rule*']] as const) {
      const marked = { ...clip, compositionRuleRole: role };
      expect(hasTimelineClipCanvasPassiveDecorations(marked)).toBe(true);
      expect(getTimelineClipCanvasPassiveDecorationBadges(marked).map(badge => badge.label)).toContain(label);
    }
  });
});
