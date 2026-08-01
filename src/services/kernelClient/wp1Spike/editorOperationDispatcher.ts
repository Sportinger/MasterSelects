import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
  CallerContext,
  ToolResult,
} from '../../aiTools/types';
import { checkToolAccess } from '../../aiTools/policy';
import type { AcceptedKernelOperationPlanV1 } from './operationSessionAuthority';
import {
  getPublicOperationDispatcherBindingV1,
  type PublicOperationIdV1,
} from './publicOperationContracts';

export type EditorToolBatchExecutor = (
  calls: AIToolCallExecution[],
  callerContext: CallerContext,
  options: { guidedReplay: false; suppressHistory: true },
) => Promise<AIToolCallExecutionResult[]>;

export function createWp1EditorOperationAuthorization(
  acceptedPlan: AcceptedKernelOperationPlanV1,
): (operationId: PublicOperationIdV1) => boolean {
  return (operationId) => {
    const binding = getPublicOperationDispatcherBindingV1(operationId);
    return binding !== undefined
      && acceptedPlan.permits(operationId)
      && checkToolAccess(binding.toolName, binding.callerContext).allowed;
  };
}

/**
 * Mechanical WP1 adapter into the existing local policy/handler seam. The
 * candidate executor owns the outer transaction; each delegated call therefore
 * suppresses its own history batch.
 */
export function createWp1EditorOperationDispatcher(
  executeToolCalls: EditorToolBatchExecutor,
): (operationId: PublicOperationIdV1, argumentsValue: Record<string, unknown>) => Promise<ToolResult> {
  return async (operationId, argumentsValue) => {
    const binding = getPublicOperationDispatcherBindingV1(operationId);
    if (!binding) return { success: false, error: 'Unknown editor operation.' };
    const [execution] = await executeToolCalls(
      [{
        id: `wp1:${operationId}`,
        tool: binding.toolName,
        args: argumentsValue,
      }],
      binding.callerContext,
      { guidedReplay: false, suppressHistory: binding.suppressHistory },
    );
    return execution?.result ?? { success: false, error: 'Editor operation returned no result.' };
  };
}
