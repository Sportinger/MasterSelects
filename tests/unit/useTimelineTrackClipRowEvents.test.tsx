import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTimelineTrackClipRowEvents } from '../../src/components/timeline/hooks/useTimelineTrackClipRowEvents';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('timeline edge control hover', () => {
  it.each(['data-shell-trim-edge', 'data-shell-fade-edge'])(
    'keeps %s mounted outside the clip interval and clears hover on empty space', (attribute) => {
      const row = document.createElement('div');
      const shell = document.createElement('div');
      shell.className = 'clip-interaction-shell';
      shell.dataset.clipId = 'clip-at-right-edge';
      const handle = document.createElement('div');
      handle.setAttribute(attribute, 'right');
      const arrow = document.createElement('span');
      handle.appendChild(arrow);
      shell.appendChild(handle);
      row.appendChild(shell);
      document.body.appendChild(row);
      const hitTestClipAtClientX = vi.fn(() => null);
      const { result } = renderHook(() => {
        const [hovered, setHoveredClipId] = useState<string | null>(null);
        const events = useTimelineTrackClipRowEvents({
          clearPointerToolPreview: vi.fn(),
          handleTimelineToolPointerClick: vi.fn(() => false),
          handleTimelineToolPointerMove: vi.fn(() => false),
          hitTestClipAtClientX,
          onClipContextMenu: vi.fn(), onClipDoubleClick: vi.fn(), onClipMouseDown: vi.fn(),
          onEmptyContextMenu: vi.fn(), onEmptyMouseDown: vi.fn(),
          pixelToTime: pixels => pixels, setHoveredClipId, trackId: 'video-track',
        });
        return { ...events, hovered };
      });
      act(() => result.current.onMouseMove({
        target: arrow, currentTarget: row, clientX: 1822,
      } as unknown as ReactMouseEvent<HTMLDivElement>));
      expect(result.current.hovered).toBe('clip-at-right-edge');
      expect(hitTestClipAtClientX).not.toHaveBeenCalled();
      act(() => result.current.onMouseMove({
        target: row, currentTarget: row, clientX: 1830,
      } as unknown as ReactMouseEvent<HTMLDivElement>));
      expect(result.current.hovered).toBeNull();
      expect(hitTestClipAtClientX).toHaveBeenCalledWith(1830, row);
    },
  );
});

describe('timeline clip row touch compatibility events', () => {
  it.each([
    'clip-live-input',
    'clip-camera-scene',
  ])('ignores the synthetic mouse-down after touching %s', (clipId) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
    const row = document.createElement('div');
    document.body.appendChild(row);
    const onClipMouseDown = vi.fn();
    const hitTestClipAtClientX = vi.fn(() => clipId);
    const { result, unmount } = renderHook(() => useTimelineTrackClipRowEvents({
      clearPointerToolPreview: vi.fn(),
      handleTimelineToolPointerClick: vi.fn(() => false),
      handleTimelineToolPointerMove: vi.fn(() => false),
      hitTestClipAtClientX,
      onClipContextMenu: vi.fn(),
      onClipDoubleClick: vi.fn(),
      onClipMouseDown,
      onEmptyContextMenu: vi.fn(),
      onEmptyMouseDown: vi.fn(),
      pixelToTime: vi.fn((pixels: number) => pixels),
      setHoveredClipId: vi.fn(),
      trackId: 'video-track',
    }));

    act(() => result.current.onPointerDown({
      pointerType: 'touch',
      button: 0,
      pointerId: 17,
      clientX: 80,
      clientY: 42,
      target: row,
      currentTarget: row,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactPointerEvent<HTMLDivElement>));

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => result.current.onMouseDown({
      button: 0,
      clientX: 80,
      clientY: 42,
      target: row,
      currentTarget: row,
      preventDefault,
      stopPropagation,
    } as unknown as ReactMouseEvent<HTMLDivElement>));

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();

    unmount();
    row.remove();
  });
});
