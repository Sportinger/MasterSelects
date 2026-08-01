import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatCompletionToolLoop } from '../../src/services/flashboard/FlashBoardChatTools';
import type { AgentActivityEventInput } from '../../src/services/flashboard/FlashBoardChatTypes';

const mocks = vi.hoisted(() => ({
  executeAIToolCalls: vi.fn(),
}));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: mocks.executeAIToolCalls,
}));

describe('FlashBoard model-authored activity narration', () => {
  beforeEach(() => {
    mocks.executeAIToolCalls.mockResolvedValue([{
      id: 'inspect-1',
      result: { success: true, data: { clips: [] } },
    }]);
  });

  afterEach(() => {
    mocks.executeAIToolCalls.mockReset();
    vi.unstubAllGlobals();
  });

  it('normalizes completion rounds without leaking narration into the final answer', async () => {
    const activity: AgentActivityEventInput[] = [];
    const complete = vi.fn()
      .mockResolvedValueOnce({
        content: 'I am checking the timeline.',
        toolCalls: [{ id: 'inspect-1', name: 'getTimelineState', arguments: '{}' }],
      })
      .mockResolvedValueOnce({
        content: 'Local inspection complete.',
        toolCalls: [],
      });

    const response = await runChatCompletionToolLoop(
      [{ role: 'user', content: 'Inspect.' }],
      complete,
      'AI',
      8_000,
      undefined,
      false,
      'normal',
      (event) => activity.push(event),
    );

    expect(response).toBe('Local inspection complete.');
    expect(activity).toEqual([
      expect.objectContaining({
        kind: 'narration',
        roundIndex: 0,
        text: 'I am checking the timeline.',
      }),
      expect.objectContaining({ kind: 'operation', phase: 'started' }),
      expect.objectContaining({ kind: 'operation', phase: 'completed' }),
    ]);
    expect(complete.mock.calls[1]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'I am checking the timeline.',
      }),
    ]));
  });

  it('reports failed execution as runtime truth after optimistic narration', async () => {
    mocks.executeAIToolCalls.mockResolvedValueOnce([{
      id: 'inspect-1',
      result: { success: false, error: 'Timeline unavailable.' },
    }]);
    const activity: AgentActivityEventInput[] = [];
    await runChatCompletionToolLoop(
      [{ role: 'user', content: 'Inspect.' }],
      vi.fn()
        .mockResolvedValueOnce({
          content: 'I am checking the timeline now.',
          toolCalls: [{ id: 'inspect-1', name: 'getTimelineState', arguments: '{}' }],
        })
        .mockResolvedValueOnce({ content: 'Inspection failed.', toolCalls: [] }),
      'AI',
      8_000,
      undefined,
      false,
      'normal',
      (event) => activity.push(event),
    );

    expect(activity.at(-1)).toMatchObject({
      kind: 'operation',
      phase: 'failed',
      toolName: 'getTimelineState',
    });
  });
});
