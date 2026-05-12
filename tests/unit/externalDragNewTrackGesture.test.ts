import { describe, expect, it } from 'vitest';
import {
  getNextVideoNewTrackGestureState,
  initialVideoNewTrackGestureState,
} from '../../src/components/timeline/utils/externalDragNewTrackGesture';

describe('externalDragNewTrackGesture', () => {
  it('does not offer a new video track when entering the timeline from above', () => {
    const enteredFromAbove = getNextVideoNewTrackGestureState(initialVideoNewTrackGestureState, {
      clientY: 108,
      timelineTop: 100,
      isAudio: false,
    });

    const movingDown = getNextVideoNewTrackGestureState(enteredFromAbove, {
      clientY: 120,
      timelineTop: 100,
      isAudio: false,
    });

    expect(enteredFromAbove.isOffered).toBe(false);
    expect(movingDown.isOffered).toBe(false);
  });

  it('offers a new video track when dragged upward against the top edge', () => {
    const lowerOnTimeline = getNextVideoNewTrackGestureState(initialVideoNewTrackGestureState, {
      clientY: 160,
      timelineTop: 100,
      isAudio: false,
    });

    const upwardNearTop = getNextVideoNewTrackGestureState(lowerOnTimeline, {
      clientY: 128,
      timelineTop: 100,
      isAudio: false,
    });

    expect(upwardNearTop.isOffered).toBe(true);
  });

  it('does not offer a video track for audio-only drags', () => {
    const lowerOnTimeline = getNextVideoNewTrackGestureState(initialVideoNewTrackGestureState, {
      clientY: 160,
      timelineTop: 100,
      isAudio: true,
    });

    const upwardNearTop = getNextVideoNewTrackGestureState(lowerOnTimeline, {
      clientY: 128,
      timelineTop: 100,
      isAudio: true,
    });

    expect(upwardNearTop.isOffered).toBe(false);
  });
});
