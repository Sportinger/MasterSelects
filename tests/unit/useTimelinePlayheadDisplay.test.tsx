import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playheadMocks = vi.hoisted(() => ({
  livePosition: 10,
  playbackSpeed: 1,
}));

vi.mock('../../src/services/layerBuilder', () => ({
  getPlayheadPosition: () => playheadMocks.livePosition,
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      playbackSpeed: playheadMocks.playbackSpeed,
      playheadPosition: playheadMocks.livePosition,
    }),
  },
}));

import { useTimelinePlayheadDisplay } from '../../src/components/timeline/hooks/useTimelinePlayheadDisplay';

function PlayheadHarness() {
  const playheadRef = useRef<HTMLDivElement>(null);
  useTimelinePlayheadDisplay({
    isDraggingPlayhead: false,
    isPlaying: true,
    playheadPosition: 10,
    playheadRef,
    scrollX: 0,
    timeToPixel: time => time * 10,
    trackHeaderWidth: 50,
  });
  return <div aria-label="Test playhead" ref={playheadRef} />;
}

describe('useTimelinePlayheadDisplay', () => {
  let scheduledFrame: FrameRequestCallback | null;

  beforeEach(() => {
    playheadMocks.livePosition = 10;
    playheadMocks.playbackSpeed = 1;
    scheduledFrame = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('applies the live playback position as a direct transform', () => {
    render(<PlayheadHarness />);
    const playhead = screen.getByLabelText('Test playhead');

    expect(playhead.style.left).toBe('50px');
    expect(playhead.style.transform).toBe('translate3d(99px, 0, 0)');

    playheadMocks.livePosition = 12;
    act(() => scheduledFrame?.(performance.now()));

    expect(playhead.style.transform).toBe('translate3d(119px, 0, 0)');
  });
});
