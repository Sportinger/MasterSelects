import { describe, expect, it } from 'vitest';
import {
  appendFlashBoardChatRunToolCalls,
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
  findFlashBoardChatRunByIdempotencyKey,
} from '../../src/services/flashboard/FlashBoardChatRunAudit';

describe('FlashBoard chat run audit durability', () => {
  it('persists tool progress while a run is still active', async () => {
    const idempotencyKey = `audit-${crypto.randomUUID()}`;
    const run = beginFlashBoardChatRun({
      hostedAvailable: true,
      idempotencyKey,
      model: 'gpt-5-6-terra',
      prompt: 'Inspect the timeline.',
      provider: 'kie',
      temperature: 0.7,
    });
    appendFlashBoardChatRunToolCalls(run.runId, [{
      modelContent: '{"success":true}',
      result: { success: true },
      toolCall: {
        arguments: '{}',
        id: 'timeline-1',
        name: 'getTimelineState',
      },
    }]);

    const stored = await findFlashBoardChatRunByIdempotencyKey(idempotencyKey);
    expect(stored).toMatchObject({
      status: 'running',
      executedToolCallCount: 1,
    });
    expect(stored).not.toHaveProperty('prompt');
    expect(stored).not.toHaveProperty('systemPrompt');
    expect(stored).not.toHaveProperty('executedToolCalls');

    completeFlashBoardChatRun(run.runId, {
      executedToolCalls: [],
      response: 'Done.',
    });
  });
});
