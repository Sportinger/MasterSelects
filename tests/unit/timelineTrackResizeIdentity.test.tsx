import { act, cleanup, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TimelineTrack } from '../../src/types/timeline';

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => ({ tracks: [], setTrackHeight: vi.fn() }) },
}));
import { useTimelineTrackResize } from '../../src/components/timeline/hooks/useTimelineTrackResize';

afterEach(cleanup);

it('keeps resize callbacks stable during scrolling but uses the latest bottom-pinning state', () => {
  const trackMap = new Map([['video', { id: 'video', type: 'video', height: 50 } as TimelineTrack]]);
  const { result, rerender } = renderHook(({ bottom }) => useTimelineTrackResize({
    isExporting: false, trackMap, isVideoBottomVisible: () => bottom,
  }), { initialProps: { bottom: false } });
  const initialHandler = result.current.handleTrackResizeStart;
  rerender({ bottom: true });
  expect(result.current.handleTrackResizeStart).toBe(initialHandler);
  act(() => initialHandler({ clientY: 100, preventDefault() {}, stopPropagation() {} } as PointerEvent, 'video'));
  expect(result.current.activeTrackResizeId).toBe('video');
  expect(result.current.trackResizePinsVideoBottom).toBe(true);
});
