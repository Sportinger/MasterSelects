import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  sendFlashBoardChatMessage,
} from '../../src/services/flashboard/FlashBoardChatService';

describe('FlashBoardChatService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends GPT-5.5 chat through Responses with reasoning effort', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'A better prompt.' }],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      model: 'gpt-5.5',
      openAiApiKey: 'sk-test',
      openAiReasoningEffort: 'xhigh',
      prompt: 'Make this more cinematic',
      provider: 'openai',
      temperature: 1.2,
    });

    expect(response).toBe('A better prompt.');
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer sk-test',
      }),
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      input: [{ role: 'user', content: 'Make this more cinematic' }],
      max_output_tokens: 2048,
      model: 'gpt-5.5',
      reasoning: { effort: 'xhigh' },
      store: false,
    });
    expect(body).not.toHaveProperty('temperature');
  });

  it('does not send xhigh reasoning to the instant OpenAI model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Short answer.' }],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendFlashBoardChatMessage({
      model: 'gpt-5.4-nano',
      openAiApiKey: 'sk-test',
      openAiReasoningEffort: 'xhigh',
      prompt: 'Answer fast',
      provider: 'openai',
      temperature: 0.7,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.reasoning).toEqual({ effort: 'none' });
  });

  it('uses hosted OpenAI chat when a signed-in cloud session is available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      kind: 'ai.chat',
      mode: 'hosted',
      ok: true,
      provider: 'openai',
      requestId: 'req-1',
      status: 'completed',
      data: {
        choices: [{
          message: {
            content: 'Use softer backlight.',
          },
        }],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5.5',
      prompt: 'Suggest lighting',
      provider: 'openai',
      temperature: 0.7,
    });

    expect(response).toBe('Use softer backlight.');
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/chat', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      max_completion_tokens: 2048,
      idempotencyKey: expect.stringMatching(/^flashboard-chat:/),
      model: 'gpt-5.5',
      messages: [
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'Suggest lighting' },
      ],
    });
  });

  it('uses a fresh hosted charge key for each tool-followup model round', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: 'ai.chat',
        mode: 'hosted',
        ok: true,
        provider: 'openai',
        requestId: 'req-1',
        status: 'completed',
        data: {
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'tool-call-1',
                type: 'function',
                function: {
                  name: 'unknownCompactChatTool',
                  arguments: '{}',
                },
              }],
            },
          }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: 'ai.chat',
        mode: 'hosted',
        ok: true,
        provider: 'openai',
        requestId: 'req-2',
        status: 'completed',
        data: {
          choices: [{
            message: {
              content: 'Tool result handled.',
            },
          }],
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5.4-nano',
      prompt: 'Inspect this',
      provider: 'openai',
      temperature: 0.7,
    });

    expect(response).toBe('Tool result handled.');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.idempotencyKey).toMatch(/^flashboard-chat:/);
    expect(secondBody.idempotencyKey).toMatch(/^flashboard-chat:/);
    expect(secondBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'tool-call-1' }),
    ]));
  });

  it('labels hosted compact chat credit prices per model round', () => {
    expect(getFlashBoardChatCreditCost('gpt-5.4-nano')).toBe(1);
    expect(getFlashBoardChatCreditLabel('gpt-5.4-nano')).toBe('1 cr');
    expect(getFlashBoardChatCreditCost('gpt-5.5')).toBe(5);
    expect(getFlashBoardChatCreditLabel('unknown-chat-model')).toBe('5 cr');
  });

  it('uses documented Anthropic model ids and headers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Try a lower angle.' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const model = FLASHBOARD_CHAT_MODEL_OPTIONS.anthropic[0]?.id ?? '';
    const response = await sendFlashBoardChatMessage({
      anthropicApiKey: 'sk-ant-test',
      model,
      prompt: 'Suggest a camera angle',
      provider: 'anthropic',
      temperature: 0.6,
    });

    expect(response).toBe('Try a lower angle.');
    expect(model).toBe('claude-opus-4-1-20250805');
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'sk-ant-test',
      }),
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      max_tokens: 2048,
      model: 'claude-opus-4-1-20250805',
      temperature: 0.6,
    });
  });
});
