import { describe, expect, it } from 'vitest';
import {
  appendFlashBoardChatRunToolCalls,
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
  getFlashBoardChatRun,
} from '../../src/services/flashboard/FlashBoardChatRunAudit';

describe('FlashBoard chat run audit durability', () => {
  it('persists tool progress while a run is still active', async () => {
    const run = beginFlashBoardChatRun({
      hostedAvailable: true,
      idempotencyKey: `audit-${crypto.randomUUID()}`,
      model: 'gpt-5-6-terra',
      prompt: 'Inspect the timeline.',
      provider: 'kie',
      temperature: 0.7,
    }, 'system prompt');
    appendFlashBoardChatRunToolCalls(run.runId, [{
      modelContent: '{"success":true}',
      result: { success: true },
      toolCall: {
        arguments: '{}',
        id: 'timeline-1',
        name: 'getTimelineState',
      },
    }]);

    await expect(getFlashBoardChatRun(run.runId)).resolves.toMatchObject({
      status: 'running',
      executedToolCalls: [{ toolCall: { id: 'timeline-1' } }],
    });

    completeFlashBoardChatRun(run.runId, {
      executedToolCalls: run.executedToolCalls,
      response: 'Done.',
    });
  });
});
