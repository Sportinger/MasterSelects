import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  sendFlashBoardChatMessage,
} from '../../src/services/flashboard/FlashBoardChatService';
import { normalizeHostedChatRequest } from '../../functions/lib/providers/openai';

describe('FlashBoardChatService', () => {
  afterEach(() => {
    vi.useRealTimers();
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
      systemPromptOverride: 'Custom compact editor prompt.',
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
    expect(body.instructions).toContain('Custom compact editor prompt.');
    expect(body.instructions).toContain('Current MasterSelects context:');
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
      openAiReasoningEffort: 'none',
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
      reasoning_effort: 'none',
      messages: [
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'Suggest lighting' },
      ],
    });
  });

  it('validates hosted reasoning effort at the API boundary', () => {
    expect(normalizeHostedChatRequest({
      messages: [{ role: 'user', content: 'Inspect this' }],
      model: 'gpt-5.5',
      reasoning_effort: 'xhigh',
    })?.reasoning_effort).toBe('xhigh');
    expect(normalizeHostedChatRequest({
      messages: [{ role: 'user', content: 'Inspect this' }],
      model: 'gpt-5.5',
      reasoning_effort: 'invalid',
    })?.reasoning_effort).toBeUndefined();
  });

  it('reports a hosted token limit instead of pretending tool work completed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      kind: 'ai.chat',
      mode: 'hosted',
      ok: true,
      provider: 'openai',
      requestId: 'req-length',
      status: 'completed',
      data: {
        choices: [{
          finish_reason: 'length',
          message: { content: null },
        }],
      },
    }), { status: 200 })));

    await expect(sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5.5',
      openAiReasoningEffort: 'none',
      prompt: 'Make a funny cut',
      provider: 'openai',
      temperature: 0.7,
    })).rejects.toThrow('full 2048-token round budget');
  });

  it('lets Lemonade cold-start past the old 60s timeout window', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        setTimeout(() => {
          resolve(new Response('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
            status: 200,
          }));
        }, 100_000);
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = sendFlashBoardChatMessage({
      lemonadeEndpoint: 'http://localhost:13305/api/v1',
      model: 'user.gemma3-4b-it-GGUF',
      prompt: 'Make this timeline shorter.',
      provider: 'lemonade',
      temperature: 0.7,
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(40_000);
    await expect(responsePromise).resolves.toBe('Ready');
  });

  it('asks Lemonade to load the selected context size before chat', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'loaded' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      lemonadeContextSize: 16384,
      lemonadeEndpoint: 'http://localhost:13305/api/v1',
      model: 'Gemma-3-4b-it-GGUF',
      prompt: 'Make this timeline shorter.',
      provider: 'lemonade',
      temperature: 0.7,
    });

    expect(response).toBe('Ready');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:13305/api/v1/load', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ctx_size: 16384,
      model_name: 'Gemma-3-4b-it-GGUF',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:13305/api/v1/chat/completions', expect.objectContaining({
      method: 'POST',
    }));
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
