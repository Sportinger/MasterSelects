import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playheadMocks = vi.hoisted(() => ({
  livePosition: 10,
  playbackSpeed: 1,
  isDraggingPlayhead: false,
  internalPosition: null as number | null,
  listeners: new Set<() => void>(),
}));

vi.mock('../../src/services/layerBuilder', () => ({
  getPlayheadPosition: () => playheadMocks.internalPosition ?? playheadMocks.livePosition,
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      playbackSpeed: playheadMocks.playbackSpeed,
      playheadPosition: playheadMocks.livePosition,
      isDraggingPlayhead: playheadMocks.isDraggingPlayhead,
    }),
    subscribe: (_selector: unknown, listener: () => void) => {
      playheadMocks.listeners.add(listener);
      return () => playheadMocks.listeners.delete(listener);
    },
  },
}));

import { useTimelinePlayheadDisplay } from '../../src/components/timeline/hooks/useTimelinePlayheadDisplay';

function PlayheadHarness({ dragging = false, playing = !dragging, position = 10 } = {}) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const { showPlayhead } = useTimelinePlayheadDisplay({
    isDraggingPlayhead: dragging,
    isPlaying: playing,
    playheadPosition: position,
    playheadRef,
    scrollX: 0,
    timeToPixel: time => time * 10,
    trackHeaderWidth: 50,
  });
  return showPlayhead ? <div aria-label="Test playhead" ref={playheadRef} /> : null;
}

describe('useTimelinePlayheadDisplay', () => {
  let scheduledFrame: FrameRequestCallback | null;

  beforeEach(() => {
    playheadMocks.livePosition = 10;
    playheadMocks.playbackSpeed = 1;
    playheadMocks.isDraggingPlayhead = false;
    playheadMocks.internalPosition = null;
    playheadMocks.listeners.clear();
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

  it('follows small loop jumps and updates visibility without a React render', () => {
    render(<PlayheadHarness />);
    const playhead = screen.getByLabelText('Test playhead');
    playheadMocks.livePosition = 9.9;
    act(() => scheduledFrame?.(performance.now()));
    expect(playhead.style.transform).toBe('translate3d(98px, 0, 0)');
    playheadMocks.livePosition = -1;
    act(() => scheduledFrame?.(performance.now()));
    expect(playhead.style.visibility).toBe('hidden');
    playheadMocks.livePosition = 1;
    act(() => scheduledFrame?.(performance.now()));
    expect(playhead.style.visibility).toBe('');
  });

  it('draws scrub positions synchronously without a React commit or decoded frame', () => {
    playheadMocks.isDraggingPlayhead = true;
    playheadMocks.internalPosition = 0;
    const view = render(<PlayheadHarness dragging />);
    const playhead = screen.getByLabelText('Test playhead');
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    for (const position of [12, 11.9, -1, 6.25]) {
      playheadMocks.livePosition = position;
      playheadMocks.listeners.forEach(listener => listener());
      expect(playhead.style.transform).toBe(`translate3d(${position * 10 - 1}px, 0, 0)`);
      expect(playhead.style.visibility).toBe(position < 0 ? 'hidden' : '');
    }
    playheadMocks.isDraggingPlayhead = false;
    view.rerender(<PlayheadHarness playing={false} position={6.25} />);
    expect(playhead.style.left).toBe('112.5px');
    expect(playhead.style.transform).toBe('');
    expect(playheadMocks.listeners.size).toBe(0);
  });
});
