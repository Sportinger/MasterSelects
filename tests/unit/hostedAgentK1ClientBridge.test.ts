import { describe, expect, it } from 'vitest';

import {
  bindHostedAgentK1ClientBatchResult,
  type HostedAgentK1ClientAuthorityReceipt,
  type HostedAgentK1ToolBatchRequestEvent,
  type HostedAgentK1ToolResult,
} from '../../src/services/kernelClient/hostedAgent';

const event: HostedAgentK1ToolBatchRequestEvent = {
  eventId: 'event-1',
  kind: 'tool-batch-request',
  roundIndex: 3,
  sequence: 7,
  sessionId: 'session-1',
  toolCalls: [
    { args: { clipId: 'clip-1' }, toolCallId: 'call-1', toolName: 'inspect_clip' },
    { args: { clipId: 'clip-2' }, toolCallId: 'call-2', toolName: 'move_clip' },
  ],
  toolSchemaVersion: 'tools-v9',
  turnId: 'turn-1',
};

const authority: HostedAgentK1ClientAuthorityReceipt = {
  approval: 'approved',
  executionMode: 'normal',
  groupedTransactionId: 'transaction-1',
  policyChecked: true,
  stateRevisionAfter: 'revision-2',
  stateRevisionBefore: 'revision-1',
  validationPassed: true,
};

const results: HostedAgentK1ToolResult[] = [
  {
    modelContent: '{"clipId":"clip-1"}',
    success: true,
    toolCallId: 'call-1',
  },
  {
    modelContent: '{"moved":true}',
    success: true,
    toolCallId: 'call-2',
  },
];

describe('hosted agent K1 client bridge', () => {
  it('binds one complete client-authoritative result group to the kernel event', () => {
    expect(bindHostedAgentK1ClientBatchResult({
      authority,
      clientInstanceId: 'client-1',
      event,
      results,
    })).toEqual({
      authority,
      clientInstanceId: 'client-1',
      results,
      sequence: 7,
      sessionId: 'session-1',
      toolSchemaVersion: 'tools-v9',
      turnId: 'turn-1',
    });
  });

  it.each([
    ['reordered', [results[1], results[0]]],
    ['incomplete', [results[0]]],
    ['duplicated', [results[0], results[0]]],
  ])('rejects %s grouped results', (_label, invalidResults) => {
    expect(() => bindHostedAgentK1ClientBatchResult({
      authority,
      clientInstanceId: 'client-1',
      event,
      results: invalidResults,
    })).toThrow('preserve the complete grouped tool order');
  });
});
