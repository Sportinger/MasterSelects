import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  sendFlashBoardChatMessage,
} from '../../src/services/flashboard/FlashBoardChatService';
import { findFlashBoardChatRunByIdempotencyKey } from '../../src/services/flashboard/FlashBoardChatRunAudit';
import { normalizeHostedKieChatRequest } from '../../functions/lib/providers/kieChat';
import { FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS } from '../../src/services/flashboard/FlashBoardChatConfig';

const kernelGatewayMocks = vi.hoisted(() => ({
  tryKernelFirst: vi.fn(),
}));

vi.mock('../../src/services/kernelClient/kernelChatGateway', () => ({
  tryKernelFirst: kernelGatewayMocks.tryKernelFirst,
}));

describe('FlashBoardChatService', () => {
  afterEach(() => {
    kernelGatewayMocks.tryKernelFirst.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('routes AI directly to Kie.ai without invoking the kernel', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Kie response.' }],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'gpt-5-6-luna',
      prompt: 'Inspect this timeline',
      provider: 'kie',
      temperature: 0.7,
    })).resolves.toBe('Kie response.');

    expect(kernelGatewayMocks.tryKernelFirst).not.toHaveBeenCalled();
    const proxyBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(proxyBody.body.reasoning).toEqual({ effort: 'medium' });
  });

  it('routes MasterSelectsAI exclusively through the selected kernel', async () => {
    kernelGatewayMocks.tryKernelFirst.mockResolvedValue({
      handled: true,
      message: 'Kernel response.',
      runId: 'kernel-run',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onPhase = vi.fn();

    await expect(sendFlashBoardChatMessage({
      model: 'masterselects-ai',
      onPhase,
      prompt: 'Cut the strongest moments',
      provider: 'kernel',
      temperature: 0.7,
    })).resolves.toBe('Kernel response.');

    expect(kernelGatewayMocks.tryKernelFirst).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPhase).toHaveBeenCalledWith('kernel');
    expect(onPhase).not.toHaveBeenCalledWith('provider');
  });

  it('sends Kie.ai GPT chat through Responses with reasoning effort', async () => {
    let completedRun: import('../../src/services/flashboard/FlashBoardChatService').FlashBoardChatRunRecord | null = null;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'A better prompt.' }],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'gpt-5-6-luna',
      idempotencyKey: 'chat-service-test-run',
      onRunCompleted: (run) => {
        completedRun = run;
      },
      openAiReasoningEffort: 'xhigh',
      prompt: 'Make this more cinematic',
      provider: 'kie',
      systemPromptOverride: 'Custom compact editor prompt.',
      temperature: 1.2,
    });

    expect(response).toBe('A better prompt.');
    expect(completedRun).toMatchObject({
      idempotencyKey: 'chat-service-test-run',
      promptVersion: 'custom',
      response: 'A better prompt.',
      source: 'ui',
      status: 'succeeded',
    });
    await expect(findFlashBoardChatRunByIdempotencyKey('chat-service-test-run'))
      .resolves.toMatchObject({
        response: 'A better prompt.',
        status: 'succeeded',
      });
    expect(fetchMock).toHaveBeenCalledWith('/api/kieai/byo/request', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-kieai-api-key': 'kie-test',
      }),
    }));

    const proxyBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(proxyBody.endpoint).toBe('/codex/v1/responses');
    expect(proxyBody.body).toMatchObject({
      input: [{ role: 'user', content: 'Make this more cinematic' }],
      max_output_tokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      model: 'gpt-5-6-luna',
      reasoning: { effort: 'xhigh' },
      store: false,
    });
    expect(proxyBody.body.instructions).toContain('Custom compact editor prompt.');
    expect(proxyBody.body.instructions).toContain('Current MasterSelects context:');
    expect(proxyBody.body).not.toHaveProperty('temperature');
    expect(proxyBody.body.tools.length).toBeLessThanOrEqual(128);
    expect(proxyBody.body.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
      'getClipFaceAnalysis',
      'cutRangesFromClip',
    ]));
  });

  it('uses hosted Kie.ai chat when a signed-in cloud session is available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      kind: 'ai.chat',
      mode: 'hosted',
      ok: true,
      provider: 'kie.ai',
      requestId: 'req-1',
      status: 'completed',
      data: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'Use softer backlight.' }],
        }],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      openAiReasoningEffort: 'low',
      prompt: 'Suggest lighting',
      provider: 'kie',
      temperature: 0.7,
    });

    expect(response).toBe('Use softer backlight.');
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/chat', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      idempotencyKey: expect.stringMatching(/^flashboard-chat:/),
      input: [{ role: 'user', content: 'Suggest lighting' }],
      max_output_tokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      model: 'gpt-5-6-luna',
      protocol: 'openai-responses',
      reasoning: { effort: 'low' },
    });
  });

  it('validates Kie.ai protocol and model at the hosted boundary', () => {
    expect(normalizeHostedKieChatRequest({
      input: [{ role: 'user', content: 'Inspect this' }],
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      reasoning: { effort: 'xhigh' },
    })?.protocol).toBe('openai-responses');
    expect(normalizeHostedKieChatRequest({
      input: [{ role: 'user', content: 'Inspect this' }],
      model: 'claude-opus-4-8',
      protocol: 'openai-responses',
    })).toBeNull();
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ctx_size: 16384,
      model_name: 'Gemma-3-4b-it-GGUF',
    });
  });

  it('labels hosted compact-chat credit prices per Kie.ai model round', () => {
    expect(getFlashBoardChatCreditCost('gpt-5-6-luna')).toBe(3);
    expect(getFlashBoardChatCreditLabel('gpt-5-6-sol')).toBe('8 cr');
    expect(getFlashBoardChatCreditCost('claude-fable-5')).toBe(10);
    expect(getFlashBoardChatCreditLabel('unknown-chat-model')).toBe('5 cr');
  });

  it('uses Kie.ai Messages for tool-capable Claude models', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Try a lower angle.' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const model = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((option) => option.id === 'claude-opus-4-8')?.id ?? '';
    const response = await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model,
      prompt: 'Suggest a camera angle',
      provider: 'kie',
      temperature: 0.6,
    });

    expect(response).toBe('Try a lower angle.');
    const proxyBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(proxyBody.endpoint).toBe('/claude/v1/messages');
    expect(proxyBody.body).toMatchObject({
      max_tokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      model: 'claude-opus-4-8',
      temperature: 0.6,
    });
    expect(proxyBody.body.tools.length).toBeGreaterThan(0);
  });

  it('does not expose editor tools to Kie.ai Fable 5', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'I can discuss the edit.' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendFlashBoardChatMessage({
      kieAiApiKey: 'kie-test',
      model: 'claude-fable-5',
      prompt: 'Discuss this edit',
      provider: 'kie',
      temperature: 0.6,
    });

    const proxyBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(proxyBody.body).not.toHaveProperty('tools');
  });
});
