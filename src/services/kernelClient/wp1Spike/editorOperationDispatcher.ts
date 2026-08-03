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
import {
  getKernelEditorToolRisk,
  parseKernelEditorToolBatch,
} from '../hostedAgent/fastV2EditorToolCatalog';
import type { HostedAgentFastV2EditorToolRisk } from '../hostedAgent/fastV2StartContract';

export type EditorToolBatchExecutor = (
  calls: AIToolCallExecution[],
  callerContext: CallerContext,
  options: { guidedReplay: false; suppressHistory: boolean },
) => Promise<AIToolCallExecutionResult[]>;

function genericOperationRisk(
  operationId: PublicOperationIdV1,
): HostedAgentFastV2EditorToolRisk | undefined {
  if (operationId === 'timeline.editor.inspect.v1') return 'read-only';
  if (operationId === 'timeline.editor.mutate.v1') return 'mutating';
  if (operationId === 'timeline.editor.destructive.v1') return 'destructive';
  if (operationId === 'timeline.editor.program.commit.v1') return 'mutating';
  return undefined;
}

function editorToolBatch(argumentsValue: Record<string, unknown>) {
  if (typeof argumentsValue.requestJson !== 'string') return null;
  try {
    return parseKernelEditorToolBatch(JSON.parse(argumentsValue.requestJson) as unknown);
  } catch {
    return null;
  }
}

function maximumRisk(
  requests: readonly { toolName: string }[],
): HostedAgentFastV2EditorToolRisk | undefined {
  const risks = requests.map((request) => getKernelEditorToolRisk(request.toolName));
  if (risks.some((risk) => risk === undefined)) return undefined;
  if (risks.some((risk) => risk === 'destructive')) return 'destructive';
  if (risks.some((risk) => risk === 'mutating')) return 'mutating';
  return 'read-only';
}

export function createWp1EditorOperationAuthorization(
  acceptedPlan: AcceptedKernelOperationPlanV1,
): (operationId: PublicOperationIdV1, argumentsValue: Record<string, unknown>) => boolean {
  return (operationId, argumentsValue) => {
    const binding = getPublicOperationDispatcherBindingV1(operationId);
    if (
      binding === undefined
      || !acceptedPlan.permits(operationId)
      || !checkToolAccess(binding.toolName, binding.callerContext).allowed
    ) return false;
    const expectedRisk = genericOperationRisk(operationId);
    if (expectedRisk === undefined) return true;
    const requests = editorToolBatch(argumentsValue);
    return requests !== null
      && maximumRisk(requests) === expectedRisk
      && requests.every((request) => checkToolAccess(request.toolName, 'kernel').allowed);
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
    const expectedRisk = genericOperationRisk(operationId);
    if (expectedRisk !== undefined) {
      const requests = editorToolBatch(argumentsValue);
      if (
        requests === null
        || maximumRisk(requests) !== expectedRisk
      ) {
        return { success: false, error: 'The kernel editor tool batch is invalid.' };
      }
      const executions = await executeToolCalls(
        requests.map((request, index) => ({
          id: `wp1:${operationId}:${index + 1}:${request.toolName}`,
          tool: request.toolName,
          args: request.args,
        })),
        'kernel',
        { guidedReplay: false, suppressHistory: false },
      );
      if (executions.length !== requests.length) {
        return { success: false, error: 'Editor tool batch returned an incomplete result.' };
      }
      const failed = executions.find((execution) => !execution.result.success);
      return {
        success: failed === undefined,
        ...(failed?.result.error === undefined ? {} : { error: failed.result.error }),
        data: {
          results: executions.map((execution) => ({
            result: execution.result,
            toolName: execution.tool,
          })),
        },
      };
    }
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
