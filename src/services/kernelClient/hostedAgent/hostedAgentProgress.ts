import type { HostedAgentEvent } from './contracts';
import {
  createKernelProgressEvent,
  type KernelProgressEvent,
} from '../runProgress';
import { getPublicOperationSpecV1 } from '../wp1Spike/publicOperationContracts';

export type HostedAgentProgressMoment = 'starting' | 'settled';

function operationCountLabel(count: number): string {
  return `${count} edit operation${count === 1 ? '' : 's'}`;
}

function isReadOnlyOperationPlan(
  event: Extract<HostedAgentEvent, { kind: 'operation-plan-request' }>,
): boolean {
  return event.request.plan.steps.every((step) => (
    getPublicOperationSpecV1(step.operationId)?.risk === 'read-only'
  ));
}

function inspectionCountLabel(count: number): string {
  return `${count} inspection operation${count === 1 ? '' : 's'}`;
}

/**
 * Maps authoritative hosted-agent events to safe, user-facing progress.
 * Starting events describe browser work that is about to happen; settled
 * events describe the server work that follows the acknowledged result.
 */
export function hostedAgentProgressForEvent(
  event: HostedAgentEvent,
  moment: HostedAgentProgressMoment,
): KernelProgressEvent | undefined {
  if (moment === 'starting') {
    if (event.kind === 'operation-plan-request') {
      const readOnly = isReadOnlyOperationPlan(event);
      return createKernelProgressEvent(readOnly ? 'inspecting' : 'executing', {
        detail: readOnly
          ? inspectionCountLabel(event.request.plan.steps.length)
          : operationCountLabel(event.request.plan.steps.length),
      });
    }
    if (event.kind === 'operation-plan-settlement') {
      return createKernelProgressEvent(
        event.settlement.decision === 'commit' ? 'committing' : 'rolling-back',
      );
    }
    if (event.kind === 'tool-batch-request') {
      return createKernelProgressEvent('executing', {
        detail: operationCountLabel(event.toolCalls.length),
      });
    }
    return undefined;
  }

  if (event.kind === 'session-ready') {
    return createKernelProgressEvent('compiling');
  }
  if (event.kind === 'operation-session-ready') {
    return createKernelProgressEvent('preparing');
  }
  if (event.kind === 'operation-plan-request') {
    if (isReadOnlyOperationPlan(event)) {
      return createKernelProgressEvent('compiling', { detail: 'Reviewing inspection results' });
    }
    return event.request.settlement === 'verified-deferred'
      ? createKernelProgressEvent('verifying', {
          detail: operationCountLabel(event.request.plan.steps.length),
        })
      : createKernelProgressEvent('compiling', { detail: 'Planning the next step' });
  }
  if (event.kind === 'operation-plan-settlement') {
    return createKernelProgressEvent('compiling', { detail: 'Finishing the edit' });
  }
  if (event.kind === 'narration-complete') {
    const stage = event.phase === 'inspecting'
      ? 'preparing-evidence'
      : event.phase === 'planning'
        ? 'compiling'
        : event.phase === 'acting'
          ? 'preparing'
          : 'verifying';
    return createKernelProgressEvent(stage);
  }
  return undefined;
}
