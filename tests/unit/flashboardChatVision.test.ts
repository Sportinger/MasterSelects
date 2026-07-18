import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';
import {
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
} from '../../src/services/flashboard/FlashBoardChatTools';
import { handleGetFramesAtTimes } from '../../src/services/aiTools/handlers/preview';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mocks = vi.hoisted(() => ({
  executeAIToolCalls: vi.fn(),
}));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: mocks.executeAIToolCalls,
}));

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function mockCapturedFrame(): void {
  mocks.executeAIToolCalls.mockResolvedValue([{
    id: 'capture-1',
    result: {
      success: true,
      data: { capturedAt: 2, dataUrl: DATA_URL, height: 180, width: 320 },
    },
  }]);
}

describe('FlashBoard compact-chat vision follow-ups', () => {
  beforeEach(() => {
    useSettingsStore.setState({ aiApprovalMode: 'auto' });
    mockCapturedFrame();
  });

  afterEach(() => {
    mocks.executeAIToolCalls.mockReset();
    vi.unstubAllGlobals();
  });

  it('rejects malformed frame samples before touching the playhead', async () => {
    const setPlayheadPosition = vi.fn();

    await expect(handleGetFramesAtTimes(
      { times: ['bad', Number.NaN] },
      { setPlayheadPosition } as never,
    )).resolves.toEqual({ success: false, error: 'Provide at least one finite frame time.' });
    expect(setPlayheadPosition).not.toHaveBeenCalled();
  });

  it('finds and redacts frame data nested inside batch results', () => {
    const toolCalls = [{
      modelContent: '{"success":true}',
      result: {
        success: true,
        data: { results: [{ tool: 'captureFrame', data: { dataUrl: DATA_URL } }] },
      },
      toolCall: { id: 'batch-1', name: 'executeBatch', arguments: '{}' },
    }];

    expect(getFlashBoardToolResultImage(toolCalls[0])?.dataUrl).toBe(DATA_URL);
    const history = prepareFlashBoardToolCallsForHistory(toolCalls);
    expect(JSON.stringify(history)).not.toContain(DATA_URL);
    expect(JSON.stringify(history)).toContain('[image omitted from chat history]');
  });

  it('sends captured pixels through every cloud vision payload', async () => {
    const executedToolCalls: unknown[] = [];
    const openAiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: 'function_call', call_id: 'capture-1', name: 'captureFrame', arguments: '{"time":2}' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A person enters the room.' }] }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', openAiFetch);

    await sendFlashBoardChatMessage({
      model: 'gpt-5.5',
      onExecutedToolCalls: (toolCalls) => executedToolCalls.push(...toolCalls),
      openAiApiKey: 'sk-test',
      prompt: 'What happens?',
      provider: 'openai',
      temperature: 0.7,
    });

    const responsesBody = JSON.parse(String(openAiFetch.mock.calls[1]?.[1]?.body));
    expect(responsesBody.input).toEqual(expect.arrayContaining([expect.objectContaining({
      role: 'user',
      content: expect.arrayContaining([{
        type: 'input_image',
        image_url: DATA_URL,
        detail: 'high',
      }]),
    })]));
    expect(JSON.stringify(executedToolCalls)).not.toContain(DATA_URL);

    const hostedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { choices: [{ message: { content: null, tool_calls: [{
          id: 'capture-1',
          type: 'function',
          function: { name: 'captureFrame', arguments: '{"time":2}' },
        }] } }] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { choices: [{ message: { content: 'A person enters the room.' } }] },
      }), { status: 200 }));
    vi.stubGlobal('fetch', hostedFetch);

    await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5.5',
      prompt: 'What happens?',
      provider: 'openai',
      temperature: 0.7,
    });

    const hostedBody = JSON.parse(String(hostedFetch.mock.calls[1]?.[1]?.body));
    expect(hostedBody.messages).toEqual(expect.arrayContaining([expect.objectContaining({
      role: 'user',
      content: expect.arrayContaining([{
        type: 'image_url',
        image_url: { detail: 'high', url: DATA_URL },
      }]),
    })]));

    const anthropicFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'capture-1', name: 'captureFrame', input: { time: 2 } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'A person enters the room.' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', anthropicFetch);

    await sendFlashBoardChatMessage({
      anthropicApiKey: 'sk-ant-test',
      model: 'claude-opus-4-1-20250805',
      prompt: 'What happens?',
      provider: 'anthropic',
      temperature: 0.7,
    });

    const anthropicBody = JSON.parse(String(anthropicFetch.mock.calls[1]?.[1]?.body));
    expect(anthropicBody.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({
      type: 'tool_result',
      content: expect.arrayContaining([{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
      }]),
    }));
  });
});
