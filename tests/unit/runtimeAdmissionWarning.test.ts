import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetRuntimeAdmissionWarningsForTests,
  warnRuntimeAdmissionRefused,
} from '../../src/services/timeline/runtimeAdmissionWarning';
import type { TimelineRuntimeAdmissionDecision } from '../../src/services/timeline/runtimeCoordinatorTypes';

function refusedDecision(): TimelineRuntimeAdmissionDecision {
  return {
    admitted: false,
    resourceId: 'overlay',
    policyId: 'interactive',
    reason: 'budget-exceeded',
    projectedUsage: {} as TimelineRuntimeAdmissionDecision['projectedUsage'],
    pressure: [],
    rejectedUnits: [
      { unit: 'session', used: 503, limit: 64, ratio: 7.86, status: 'critical' },
    ] as unknown as TimelineRuntimeAdmissionDecision['rejectedUnits'],
  };
}

describe('runtime admission warning', () => {
  afterEach(() => {
    resetRuntimeAdmissionWarningsForTests();
    vi.useRealTimers();
  });

  it('names the refused unit with its usage instead of failing silently', () => {
    const warn = vi.fn();

    warnRuntimeAdmissionRefused({ warn }, 'Clip media element', refusedDecision(), { clipId: 'overlay' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Clip media element');
    expect(warn.mock.calls[0][1]).toMatchObject({
      clipId: 'overlay',
      reason: 'budget-exceeded',
      rejectedUnits: [{ unit: 'session', used: 503, limit: 64 }],
    });
  });

  it('stays quiet while the same refusal repeats every frame and speaks again later', () => {
    vi.useFakeTimers();
    const warn = vi.fn();

    for (let frame = 0; frame < 60; frame += 1) {
      warnRuntimeAdmissionRefused({ warn }, 'Clip media element', refusedDecision());
    }
    expect(warn).toHaveBeenCalledTimes(1);

    warnRuntimeAdmissionRefused({ warn }, 'Frame provider', refusedDecision());
    expect(warn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10_001);
    warnRuntimeAdmissionRefused({ warn }, 'Clip media element', refusedDecision());
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
