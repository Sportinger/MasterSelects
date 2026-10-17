import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useRegisterTimelineLayerSyncOwner,
  useTimelineLayerSyncOwnerMounted,
} from '../../src/components/timeline/hooks/timelineLayerSyncOwners';

describe('timeline layer sync owners', () => {
  it('reports a mounted Timeline so the headless layer sync steps aside', () => {
    const presence = renderHook(() => useTimelineLayerSyncOwnerMounted());
    expect(presence.result.current).toBe(false);

    const first = renderHook(() => useRegisterTimelineLayerSyncOwner());
    const second = renderHook(() => useRegisterTimelineLayerSyncOwner());
    presence.rerender();
    expect(presence.result.current).toBe(true);

    first.unmount();
    presence.rerender();
    expect(presence.result.current).toBe(true);

    second.unmount();
    presence.rerender();
    expect(presence.result.current).toBe(false);
  });
});
