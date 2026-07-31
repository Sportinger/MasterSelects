import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';
import { runChatCompletionToolLoop } from '../../src/services/flashboard/FlashBoardChatTools';
import type {
  AgentActivityEvent,
  AgentActivityEventInput,
} from '../../src/services/flashboard/FlashBoardChatTypes';

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

  it('surfaces OpenAI text from a tool-bearing round before runtime operations', async () => {
    const events: AgentActivityEvent[] = [];
    const kieFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [
          {
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'I am checking the current timeline before I edit.',
            }],
          },
          {
            type: 'function_call',
            call_id: 'inspect-1',
            name: 'getTimelineState',
            arguments: '{}',
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'The timeline is empty.' }],
        }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', kieFetch);

    const response = await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'gpt-5-6-luna',
      onActivityEvent: (event) => events.push(event),
      prompt: 'Inspect the timeline.',
      provider: 'kie',
      temperature: 0.7,
    });

    expect(response).toBe('The timeline is empty.');
    expect(events.map((event) => event.kind)).toEqual([
      'narration',
      'operation',
      'operation',
    ]);
    expect(events[0]).toMatchObject({
      kind: 'narration',
      roundIndex: 0,
      text: 'I am checking the current timeline before I edit.',
    });
    expect(events[1]).toMatchObject({
      kind: 'operation',
      phase: 'started',
      toolName: 'getTimelineState',
    });
    expect(events[2]).toMatchObject({
      kind: 'operation',
      phase: 'completed',
      toolName: 'getTimelineState',
    });
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
    expect(events[0]?.runId).toMatch(/^chat-run-/);
  });

  it('surfaces Anthropic text alongside tool use and preserves the final answer', async () => {
    const events: AgentActivityEvent[] = [];
    const kieFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [
          { type: 'text', text: 'I will inspect the selected clips first.' },
          { type: 'tool_use', id: 'inspect-1', name: 'getTimelineState', input: {} },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'No clips are selected.' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', kieFetch);

    const response = await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'claude-opus-4-8',
      onActivityEvent: (event) => events.push(event),
      prompt: 'Inspect the selection.',
      provider: 'kie',
      temperature: 0.7,
    });

    expect(response).toBe('No clips are selected.');
    expect(events[0]).toMatchObject({
      kind: 'narration',
      text: 'I will inspect the selected clips first.',
    });
    expect(events.slice(1)).toEqual([
      expect.objectContaining({ kind: 'operation', phase: 'started' }),
      expect.objectContaining({ kind: 'operation', phase: 'completed' }),
    ]);
  });

  it('normalizes local completion rounds without leaking narration into the final answer', async () => {
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
      'Lemonade',
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
      'Lemonade',
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
