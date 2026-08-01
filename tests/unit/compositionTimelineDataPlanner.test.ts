import { describe, expect, it } from 'vitest';

import {
  createDefaultCompositionTimelineData,
} from '../../src/stores/mediaStore/slices/composition/timelineDataPlanner';

describe('composition timeline data planner', () => {
  it('locks an explicitly authored composition duration when requested', () => {
    const timeline = createDefaultCompositionTimelineData(6, { durationLocked: true });

    expect(timeline.duration).toBe(6);
    expect(timeline.durationLocked).toBe(true);
  });

  it('keeps the default auto-duration behavior when no lock is requested', () => {
    const timeline = createDefaultCompositionTimelineData(60);

    expect(timeline.duration).toBe(60);
    expect(timeline.durationLocked).toBeUndefined();
  });
});
