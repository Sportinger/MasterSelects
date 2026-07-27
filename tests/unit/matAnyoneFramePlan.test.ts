import { describe, expect, it } from 'vitest';
import {
  getMatAnyoneFramePlan,
  type MatAnyoneClipLike,
} from '../../src/components/panels/sam2/MatAnyoneFileHelpers';

function clip(overrides: Partial<MatAnyoneClipLike> = {}): MatAnyoneClipLike {
  return {
    id: 'video-1',
    name: 'Source',
    startTime: 10,
    duration: 5,
    inPoint: 2,
    outPoint: 7,
    speed: 1,
    source: {
      type: 'video',
      nativeDecoder: { fps: 30, width: 1920, height: 1080 },
    },
    ...overrides,
  };
}

describe('MatAnyone frame plan', () => {
  it('starts inference on the frame where the mask was made', () => {
    const plan = getMatAnyoneFramePlan(clip(), 12);
    expect(plan.startFrame).toBe(120);
    expect(plan.endFrame).toBe(210);
    expect(plan.timelineStartTime).toBe(12);
    expect(plan.timelineDuration).toBe(3);
  });

  it('keeps a constant-speed result aligned on the timeline', () => {
    const plan = getMatAnyoneFramePlan(clip({ duration: 2.5, speed: 2 }), 11);
    expect(plan.sourceStartTime).toBe(4);
    expect(plan.sourceSpeed).toBe(2);
    expect(plan.timelineStartTime).toBe(11);
    expect(plan.timelineDuration).toBe(1.5);
  });

  it('rejects reversed clips and stale mask times', () => {
    expect(() => getMatAnyoneFramePlan(clip({ reversed: true }), 11)).toThrow(/forward playback/i);
    expect(() => getMatAnyoneFramePlan(clip(), 9)).toThrow(/outside the selected clip/i);
  });
});
