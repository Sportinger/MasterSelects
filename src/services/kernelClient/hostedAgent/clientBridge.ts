import type {
  HostedAgentEvent,
  HostedAgentK1ClientAuthorityReceipt,
  HostedAgentK1ToolBatchResult,
  HostedAgentK1ToolResult,
} from './contracts';

export type HostedAgentK1ToolBatchRequestEvent = Extract<
  HostedAgentEvent,
  { kind: 'tool-batch-request' }
>;

/**
 * Binds client-executed results to one grouped kernel request.
 *
 * The caller remains responsible for shared policy checks, validation,
 * approval, grouped transaction/undo behavior, and actual editor mutation.
 */
export function bindHostedAgentK1ClientBatchResult(input: {
  authority: HostedAgentK1ClientAuthorityReceipt;
  clientInstanceId: string;
  event: HostedAgentK1ToolBatchRequestEvent;
  results: HostedAgentK1ToolResult[];
}): HostedAgentK1ToolBatchResult {
  const expectedIds = input.event.toolCalls.map((toolCall) => toolCall.toolCallId);
  const resultIds = input.results.map((result) => result.toolCallId);
  if (
    input.authority.policyChecked !== true
    || resultIds.length !== expectedIds.length
    || resultIds.some((id, index) => id !== expectedIds[index])
    || new Set(resultIds).size !== resultIds.length
  ) {
    throw new Error('Hosted-agent client results must preserve the complete grouped tool order.');
  }
  return {
    authority: input.authority,
    clientInstanceId: input.clientInstanceId,
    results: input.results,
    sequence: input.event.sequence,
    sessionId: input.event.sessionId,
    toolSchemaVersion: input.event.toolSchemaVersion,
    turnId: input.event.turnId,
  };
}
