import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getToolRegistrySnapshot } from '../../src/services/aiTools/registrySnapshot';
import { executeToolInternal } from '../../src/services/aiTools/handlers';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy/registry';
import type { ToolResult } from '../../src/services/aiTools/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

const videoTrack: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function clip(
  id: string,
  startTime: number,
  duration: number,
  inPoint: number,
): TimelineClip {
  return {
    id,
    trackId: videoTrack.id,
    name: id,
    startTime,
    duration,
    inPoint,
    outPoint: inPoint + duration,
  } as TimelineClip;
}

interface VerificationData {
  passed: boolean;
  results: Array<{
    check: string;
    passed: boolean;
    expected: boolean | number;
    actual: boolean | number;
    detail: string;
  }>;
}

async function executeVerification(args: Record<string, unknown>): Promise<ToolResult> {
  return executeToolInternal(
    'verifyTimelineInvariants',
    args,
    useTimelineStore.getState(),
    useMediaStore.getState(),
    'chat',
  );
}

function verificationData(result: ToolResult): VerificationData {
  expect(result.success).toBe(true);
  return result.data as VerificationData;
}

describe('verifyTimelineInvariants AI tool', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [videoTrack],
      clips: [
        clip('clip-1', 0, 2, 0),
        clip('clip-2', 2, 2, 2),
      ],
    });
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('passes caller-supplied validation-core checks on a healthy live store state', async () => {
    const clipsBefore = useTimelineStore.getState().clips;
    const tracksBefore = useTimelineStore.getState().tracks;
    const result = await executeVerification({
      checks: [
        { check: 'objectCount', args: { kind: 'clips', expected: 2 } },
        { check: 'noGaps' },
        { check: 'noOverlaps' },
        { check: 'sourceOrderMonotonic' },
        { check: 'avLinkAlignment' },
        { check: 'occupiedEnd', args: { expected: 4 } },
      ],
    });
    const data = verificationData(result);

    expect(data.passed).toBe(true);
    expect(data.results.map(({ check }) => check)).toEqual([
      'objectCount',
      'noGaps',
      'noOverlaps',
      'sourceOrderMonotonic',
      'avLinkAlignment',
      'occupiedEnd',
    ]);
    expect(data.results.every(({ passed }) => passed)).toBe(true);
    expect(data.results.every(({ detail }) => detail.includes('expected'))).toBe(true);
    expect(useTimelineStore.getState().clips).toBe(clipsBefore);
    expect(useTimelineStore.getState().tracks).toBe(tracksBefore);
  });

  it('runs the full expectation-free invariant set when checks are omitted', async () => {
    const data = verificationData(await executeVerification({}));

    expect(data.passed).toBe(true);
    expect(data.results.map(({ check }) => check)).toEqual([
      'noGaps',
      'noOverlaps',
      'sourceOrderMonotonic',
      'avLinkAlignment',
    ]);
  });

  it('reports a failing check for an artificial overlap', async () => {
    useTimelineStore.setState({
      clips: [
        clip('clip-1', 0, 3, 0),
        clip('clip-2', 2, 2, 3),
      ],
    });

    const data = verificationData(await executeVerification({
      checks: [{ check: 'noOverlaps' }],
    }));

    expect(data.passed).toBe(false);
    expect(data.results).toEqual([{
      check: 'noOverlaps',
      passed: false,
      expected: 0,
      actual: 1,
      detail: 'noOverlaps: expected 0, actual 1',
    }]);
  });

  it('fails closed for an unknown validation check id', async () => {
    const result = await executeVerification({
      checks: [{ check: 'notAValidationCheck' }],
    });

    expect(result).toEqual({
      success: false,
      error: 'Unknown validation check: notAValidationCheck',
    });
  });

  it('is present in every standard registry with chat and devBridge read-only policy', () => {
    const snapshot = getToolRegistrySnapshot();
    expect(snapshot.definitionNames).toContain('verifyTimelineInvariants');
    expect(snapshot.policyNames).toContain('verifyTimelineInvariants');
    expect(snapshot.handlerNames).toContain('verifyTimelineInvariants');
    expect(getToolPolicy('verifyTimelineInvariants')).toEqual({
      readOnly: true,
      riskLevel: 'low',
      requiresConfirmation: false,
      sensitiveDataAccess: false,
      localFileAccess: false,
      allowedCallers: ['chat', 'devBridge'],
    });
    expect(checkToolAccess('verifyTimelineInvariants', 'chat')).toEqual({ allowed: true });
    expect(checkToolAccess('verifyTimelineInvariants', 'devBridge')).toEqual({ allowed: true });
    expect(checkToolAccess('verifyTimelineInvariants', 'internal').allowed).toBe(false);
  });
});
