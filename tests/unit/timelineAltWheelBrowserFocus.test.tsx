import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineZoom } from '../../src/components/timeline/hooks/useTimelineZoom';

describe('timeline Alt+wheel browser focus guard', () => {
  it('cancels Chrome Alt focus only for a timeline gesture', () => {
    const timelineBody = document.createElement('div');
    document.body.appendChild(timelineBody);

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: timelineBody },
      zoom: 10,
      scrollX: 0,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom: vi.fn(),
      setScrollX: vi.fn(),
      setScrollY: vi.fn(),
    }));

    timelineBody.dispatchEvent(new Event('pointerenter'));
    const altDown = new KeyboardEvent('keydown', { key: 'Alt', cancelable: true });
    window.dispatchEvent(altDown);
    expect(altDown.defaultPrevented).toBe(true);

    timelineBody.dispatchEvent(new WheelEvent('wheel', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    }));
    timelineBody.dispatchEvent(new Event('pointerleave'));
    const altUp = new KeyboardEvent('keyup', { key: 'Alt', cancelable: true });
    window.dispatchEvent(altUp);
    expect(altUp.defaultPrevented).toBe(true);

    const outsideAltDown = new KeyboardEvent('keydown', { key: 'Alt', cancelable: true });
    window.dispatchEvent(outsideAltDown);
    expect(outsideAltDown.defaultPrevented).toBe(false);

    unmount();
    timelineBody.remove();
  });
});
