import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimelineCurveMode } from '../../src/components/timeline/hooks/useTimelineCurveMode';
import {
  persistStoredTimelineCurveMode,
  readStoredTimelineCurveMode,
} from '../../src/stores/timeline/viewPreferences';

describe('useTimelineCurveMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('toggles one per-user Timeline/Graph mode and reloads it', () => {
    const first = renderHook(() => useTimelineCurveMode());
    expect(first.result.current.timelineCurveMode).toBe('timeline');

    act(() => first.result.current.toggleTimelineCurveMode());
    expect(first.result.current.timelineCurveMode).toBe('graph');
    expect(readStoredTimelineCurveMode('timeline')).toBe('graph');
    first.unmount();

    const reloaded = renderHook(() => useTimelineCurveMode());
    expect(reloaded.result.current.timelineCurveMode).toBe('graph');

    act(() => reloaded.result.current.setTimelineCurveMode('timeline'));
    expect(reloaded.result.current.timelineCurveMode).toBe('timeline');
    expect(readStoredTimelineCurveMode('graph')).toBe('timeline');
  });

  it('uses a safely parsed persisted mode', () => {
    persistStoredTimelineCurveMode('graph');
    const { result } = renderHook(() => useTimelineCurveMode());
    expect(result.current.timelineCurveMode).toBe('graph');
  });
});
