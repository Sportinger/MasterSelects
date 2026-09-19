import { describe, expect, it } from 'vitest';
import type { HostedAgentEvent } from '../../src/services/kernelClient/hostedAgent/contracts';
import { hostedAgentProgressForEvent } from '../../src/services/kernelClient/hostedAgent/hostedAgentProgress';

const EVENT_BINDING = {
  eventId: '1',
  sessionId: 'session-progress',
  turnId: 'turn-progress',
};

function operationPlanEvent(
  settlement: 'fast-immediate' | 'verified-deferred',
  stepCount: number,
  operationId = 'timeline.segment.delete-many.v1',
): HostedAgentEvent {
  return {
    ...EVENT_BINDING,
    kind: 'operation-plan-request',
    request: {
      plan: { steps: Array.from({ length: stepCount }, () => ({ operationId })) },
      settlement,
    },
  } as unknown as HostedAgentEvent;
}

describe('hosted agent progress', () => {
  it('reports applying progress before a real operation plan executes', () => {
    expect(hostedAgentProgressForEvent(
      operationPlanEvent('verified-deferred', 4),
      'starting',
    )).toEqual(expect.objectContaining({
      detail: '4 edit operations',
      label: 'Applying edit',
      stage: 'executing',
    }));
  });

  it('reports verification after a deferred operation plan settles locally', () => {
    expect(hostedAgentProgressForEvent(
      operationPlanEvent('verified-deferred', 2),
      'settled',
    )).toEqual(expect.objectContaining({
      detail: '2 edit operations',
      label: 'Verifying result',
      stage: 'verifying',
    }));
  });

  it('labels read-only plans as inspection rather than editing', () => {
    expect(hostedAgentProgressForEvent(
      operationPlanEvent('fast-immediate', 1, 'timeline.editor.inspect.v1'),
      'starting',
    )).toEqual(expect.objectContaining({
      detail: '1 inspection operation',
      label: 'Inspecting project',
      stage: 'inspecting',
    }));
  });

  it('distinguishes a commit from a rollback before settlement', () => {
    const settlement = (decision: 'abort' | 'commit') => ({
      ...EVENT_BINDING,
      kind: 'operation-plan-settlement',
      settlement: { decision },
    }) as unknown as HostedAgentEvent;

    expect(hostedAgentProgressForEvent(settlement('commit'), 'starting')?.stage)
      .toBe('committing');
    expect(hostedAgentProgressForEvent(settlement('abort'), 'starting')?.stage)
      .toBe('rolling-back');
  });

  it('maps model narration phases without exposing private reasoning text', () => {
    const event = {
      ...EVENT_BINDING,
      kind: 'narration-complete',
      phase: 'planning',
      roundIndex: 0,
      text: 'private model narration',
    } as HostedAgentEvent;

    expect(hostedAgentProgressForEvent(event, 'settled')).toEqual({
      label: 'Planning the edit',
      stage: 'compiling',
    });
  });
});
