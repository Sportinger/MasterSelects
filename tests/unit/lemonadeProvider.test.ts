import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../src/services/aiTools/types';
import {
  checkLemonadeHealth,
  createLemonadeChatCompletion,
  INVALID_LEMONADE_ENDPOINT_MESSAGE,
  isLoopbackLemonadeEndpoint,
  parseLemonadeChatCompletion,
} from '../../src/services/lemonadeProvider';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn(async () => data),
  } as unknown as Response;
}

describe('lemonadeProvider', () => {
  afterEach(() => {
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
        },
      ],
    });

    expect(result).toEqual({
      content: 'I can do that.',
      toolCalls: [
        {
          id: 'call_1',
          name: 'splitClip',
          arguments: '{"clipId":"clip-1","time":1.5}',
        },
      ],
    });
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
