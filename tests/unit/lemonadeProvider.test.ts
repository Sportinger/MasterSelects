import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../src/services/aiTools/types';
import {
  checkLemonadeHealth,
  createLemonadeChatCompletion,
  createLemonadeChatCompletionStream,
  INVALID_LEMONADE_ENDPOINT_MESSAGE,
  isLoopbackLemonadeEndpoint,
  loadLemonadeModel,
  parseLemonadeChatCompletion,
} from '../../src/services/lemonadeProvider';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn(async () => data),
  } as unknown as Response;
}

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
}

function delayedSseResponse(events: string[], intervalMs: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        for (const timer of timers) {
          clearTimeout(timer);
        }
        controller.error(new Error('aborted'));
      };

      if (signal.aborted) {
        abort();
        return;
      }

      signal.addEventListener('abort', abort, { once: true });
      events.forEach((event, index) => {
        timers.push(setTimeout(() => {
          controller.enqueue(encoder.encode(event));
          if (index === events.length - 1) {
            signal.removeEventListener('abort', abort);
            controller.close();
          }
        }, intervalMs * (index + 1)));
      });
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
}

describe('lemonadeProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('parses chat completion content and tool calls', () => {
    const result = parseLemonadeChatCompletion({
      choices: [
        {
          message: {
            content: 'I can do that.',
            tool_calls: [
              {
                id: 'call_1',
                function: {
                  name: 'splitClip',
                  arguments: '{"clipId":"clip-1","time":1.5}',
                },
              },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    });

    expect(result).toEqual({
      content: 'I can do that.',
      finishReason: 'stop',
      toolCalls: [
        {
          id: 'call_1',
          name: 'splitClip',
          arguments: '{"clipId":"clip-1","time":1.5}',
        },
      ],
    });
  });

  it('surfaces Lemonade backend errors returned with a 200 response', () => {
    expect(() => parseLemonadeChatCompletion({
      error: {
        details: {
          response: {
            error: {
              code: 400,
              message: 'Max length reached!',
              type: 'model_error',
            },
          },
          status_code: 400,
        },
        message: 'FastFlowLM request failed',
        type: 'backend_error',
      },
    })).toThrow('Max length reached!');
  });

  it('checks configured Lemonade endpoint and parses models', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [
        { id: 'Gemma-4-E2B-it-GGUF', name: 'Gemma 4 E2B' },
        'local-custom-model',
      ],
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const health = await checkLemonadeHealth('http://localhost:13305/api/v1/');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:13305/api/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer lemonade' },
    });
    expect(health).toEqual({
      available: true,
      models: [
        { id: 'Gemma-4-E2B-it-GGUF', name: 'Gemma 4 E2B' },
        { id: 'local-custom-model' },
      ],
    });
  });

  it('only accepts loopback Lemonade endpoints', async () => {
    expect(isLoopbackLemonadeEndpoint('http://localhost:13305/api/v1')).toBe(true);
    expect(isLoopbackLemonadeEndpoint('http://127.0.0.1:13305/api/v1')).toBe(true);
    expect(isLoopbackLemonadeEndpoint('http://[::1]:13305/api/v1')).toBe(true);
    expect(isLoopbackLemonadeEndpoint('https://localhost:13305/api/v1')).toBe(true);
    expect(isLoopbackLemonadeEndpoint('http://localhost.evil.test:13305/api/v1')).toBe(false);
    expect(isLoopbackLemonadeEndpoint('https://example.com/api/v1')).toBe(false);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const health = await checkLemonadeHealth('https://example.com/api/v1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(health).toEqual({
      available: false,
      models: [],
      error: INVALID_LEMONADE_ENDPOINT_MESSAGE,
    });
  });

  it('posts chat completions to the configured endpoint with model and tools', async () => {
    const tool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'splitClip',
        description: 'Split a clip',
        parameters: {
          type: 'object',
          properties: { clipId: { type: 'string' } },
          required: ['clipId'],
        },
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                function: {
                  name: 'splitClip',
                  arguments: '{"clipId":"clip-1"}',
                },
              },
            ],
          },
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await createLemonadeChatCompletion({
      endpoint: 'http://127.0.0.1:13305/api/v1/',
      model: 'Qwen3-4B-FLM',
      messages: [{ role: 'user', content: 'Split the selected clip.' }],
      tools: [tool],
      maxTokens: 123,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:13305/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer lemonade',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'Qwen3-4B-FLM',
      messages: [{ role: 'user', content: 'Split the selected clip.' }],
      max_tokens: 123,
      stream: false,
      tools: [tool],
      tool_choice: 'auto',
    });
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'splitClip',
        arguments: '{"clipId":"clip-1"}',
      },
    ]);
  });

  it('streams chat completion deltas and tool calls', async () => {
    const tool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'splitClip',
        description: 'Split a clip',
        parameters: {
          type: 'object',
          properties: { clipId: { type: 'string' } },
          required: ['clipId'],
        },
      },
    };
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call_1","function":{"name":"splitClip","arguments":"{\\"clip"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Id\\":\\"clip-1\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const deltas: string[] = [];
    const result = await createLemonadeChatCompletionStream({
      endpoint: 'http://localhost:13305/api/v1',
      model: 'user.gemma4-it-e2b-FLM',
      messages: [{ role: 'user', content: 'Split the selected clip.' }],
      onContentDelta: (delta) => deltas.push(delta),
      tools: [tool],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:13305/api/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer lemonade',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'user.gemma4-it-e2b-FLM',
      messages: [{ role: 'user', content: 'Split the selected clip.' }],
      max_tokens: 4096,
      stream: true,
      tools: [tool],
      tool_choice: 'auto',
    });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({
      content: 'Hello',
      finishReason: null,
      toolCalls: [
        {
          id: 'call_1',
          name: 'splitClip',
          arguments: '{"clipId":"clip-1"}',
        },
      ],
    });
  });

  it('does not abort active streams at the initial response timeout', async () => {
    vi.useFakeTimers();
    let streamSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      streamSignal = init?.signal as AbortSignal | undefined;
      if (!streamSignal) {
        throw new Error('expected abort signal');
      }
      return delayedSseResponse([
        'data: {"choices":[{"delta":{"content":"O"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"K"}}]}\n\n',
        'data: [DONE]\n\n',
      ], 20, streamSignal);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const resultPromise = createLemonadeChatCompletionStream({
      endpoint: 'http://localhost:13305/api/v1',
      model: 'user.gemma4-it-e2b-FLM',
      messages: [{ role: 'user', content: 'Edit the selected clip.' }],
      timeoutMs: 10,
      streamIdleTimeoutMs: 30,
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(70);

    await expect(resultPromise).resolves.toEqual({
      content: 'OK',
      finishReason: null,
      toolCalls: [],
    });
    expect(streamSignal?.aborted).toBe(false);
  });

  it('loads a Lemonade model with an explicit context size', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'loaded' }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await loadLemonadeModel({
      contextSize: 16384,
      endpoint: 'http://localhost:13305/api/v1/',
      model: 'Gemma-3-4b-it-GGUF',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:13305/api/v1/load');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer lemonade',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      ctx_size: 16384,
      model_name: 'Gemma-3-4b-it-GGUF',
    });
  });

  it('does not reload Lemonade for automatic context size', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await loadLemonadeModel({
      contextSize: -1,
      endpoint: 'http://localhost:13305/api/v1/',
      model: 'Gemma-3-4b-it-GGUF',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains empty streams that stop at the token or context limit', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(createLemonadeChatCompletionStream({
      endpoint: 'http://localhost:13305/api/v1',
      model: 'user.gemma4-it-e2b-FLM',
      messages: [{ role: 'user', content: 'Write 60 jokes.' }],
    })).rejects.toThrow('model hit its output or context limit');
  });

  it('rejects remote Lemonade chat completion endpoints before sending data', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(createLemonadeChatCompletion({
      endpoint: 'https://example.com/api/v1',
      model: 'Qwen3-4B-FLM',
      messages: [{ role: 'user', content: 'Split the selected clip.' }],
    })).rejects.toThrow(INVALID_LEMONADE_ENDPOINT_MESSAGE);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
