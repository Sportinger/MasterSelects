import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';
import {
  executeFlashBoardToolCalls,
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
} from '../../src/services/flashboard/FlashBoardChatTools';
import { handleGetFramesAtTimes } from '../../src/services/aiTools/handlers/preview';

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

  it('technically blocks mutating tools during diagnostic read-only chat runs', async () => {
    const results = await executeFlashBoardToolCalls([{
      id: 'delete-1',
      name: 'deleteClip',
      arguments: '{"clipId":"clip-1"}',
    }], 8_000, { toolExecutionMode: 'read-only' });

    expect(results[0]?.result).toMatchObject({
      success: false,
      error: expect.stringMatching(/read-only/i),
    });
    expect(mocks.executeAIToolCalls).not.toHaveBeenCalled();
  });

  it('sends captured pixels through every cloud vision payload', async () => {
    const executedToolCalls: unknown[] = [];
    const kieFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: 'function_call', call_id: 'capture-1', name: 'captureFrame', arguments: '{"time":2}' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A person enters the room.' }] }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', kieFetch);

    await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'gpt-5-6-luna',
      onExecutedToolCalls: (toolCalls) => executedToolCalls.push(...toolCalls),
      prompt: 'What happens?',
      provider: 'kie',
      temperature: 0.7,
    });

    const responsesProxyBody = JSON.parse(String(kieFetch.mock.calls[1]?.[1]?.body));
    expect(responsesProxyBody.body.input).toEqual(expect.arrayContaining([expect.objectContaining({
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
        data: {
          output: [{ type: 'function_call', call_id: 'capture-1', name: 'captureFrame', arguments: '{"time":2}' }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: {
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'A person enters the room.' }] }],
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', hostedFetch);

    await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      prompt: 'What happens?',
      provider: 'kie',
      temperature: 0.7,
    });

    const hostedBody = JSON.parse(String(hostedFetch.mock.calls[1]?.[1]?.body));
    expect(hostedBody.input).toEqual(expect.arrayContaining([expect.objectContaining({
      role: 'user',
      content: expect.arrayContaining([{
        type: 'input_image',
        image_url: DATA_URL,
        detail: 'high',
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
      kieAiApiKey: 'kie-test',
      model: 'claude-opus-4-8',
      prompt: 'What happens?',
      provider: 'kie',
      temperature: 0.7,
    });

    const anthropicProxyBody = JSON.parse(String(anthropicFetch.mock.calls[1]?.[1]?.body));
    expect(anthropicProxyBody.body.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({
      type: 'tool_result',
      content: expect.arrayContaining([{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
      }]),
    }));
  });
});
