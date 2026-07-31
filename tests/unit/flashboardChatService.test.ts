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
    expect(kernelGatewayMocks.tryKernelFirst).toHaveBeenCalledWith(
      'Cut the strongest moments',
      expect.objectContaining({ autoApprove: true }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPhase).toHaveBeenCalledWith('kernel');
    expect(onPhase).not.toHaveBeenCalledWith('provider');
  });

  it('forwards an active decision and exposes a returned durable decision', async () => {
    const returnedDecision = {
      id: 'decision-next',
      kind: 'cut' as const,
      question: 'Which ending?',
      baseFingerprint: {
        schemaVersion: 1 as const,
        algorithm: 'sha-256' as const,
        value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      options: [{
        id: 'hold',
        title: 'Hold',
        summary: 'Let the final image breathe.',
      }],
    };
    kernelGatewayMocks.tryKernelFirst.mockResolvedValue({
      handled: true,
      message: 'Choose the ending.',
      runId: 'decision-next-run',
      decision: returnedDecision,
    });
    const onKernelDecision = vi.fn();

    await expect(sendFlashBoardChatMessage({
      activeDecision: {
        decisionId: 'decision-current',
        optionIds: ['dynamic'],
      },
      model: 'masterselects-ai',
      onKernelDecision,
      prompt: 'Continue with Dynamic.',
      provider: 'kernel',
      temperature: 0.7,
    })).resolves.toBe('Choose the ending.');

    expect(kernelGatewayMocks.tryKernelFirst).toHaveBeenCalledWith(
      'Continue with Dynamic.',
      expect.objectContaining({
        activeDecision: {
          decisionId: 'decision-current',
          optionIds: ['dynamic'],
        },
      }),
    );
    expect(onKernelDecision).toHaveBeenCalledWith(returnedDecision);
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

  it('uses the kernel fast-agent when a signed-in cloud session is available', async () => {
    let turnId = '';
    const sessionId = 'ha_test_session';
    const fetchMock = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const url = String(requestInfo);
      if (url === '/api/kernel/hosted-agent/turns') {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        turnId = String(request.turnId);
        return new Response(JSON.stringify({
          acceptedHistoryFormatVersion: request.historyFormatVersion,
          acceptedPromptVersion: request.promptVersion,
          acceptedToolSchemaVersion: request.toolSchemaVersion,
          eventsPath: `/api/kernel/hosted-agent/turns/${turnId}/events`,
          maximumIterations: 400,
          maximumSpendCredits: 100,
          pageLease: {
            expiresAt: '2026-07-30T12:05:00.000Z',
            leaseToken: 'lease-test',
            sessionId,
          },
          protocolVersion: 'hosted-agent-k2-v1',
          replayed: false,
          route: 'fast-agent',
          sessionId,
          turnId,
        }), { headers: { 'Content-Type': 'application/json' }, status: 202 });
      }
      const events = [
        `id: 1\nevent: session-ready\ndata: ${JSON.stringify({
          eventId: '1', kind: 'session-ready', sessionId, turnId,
          acceptedPromptVersion: 'flashboard-chat-v2',
          acceptedHistoryFormatVersion: 'flashboard-provider-history-v1',
          acceptedToolSchemaVersion: 'flashboard-chat-tools-v1',
          maximumIterations: 400, maximumSpendCredits: 100,
        })}\n\n`,
        `id: 2\nevent: turn-complete\ndata: ${JSON.stringify({
          eventId: '2', kind: 'turn-complete', sessionId, turnId,
          creditsCharged: 6, message: 'Use softer backlight.', rounds: 1,
        })}\n\n`,
      ].join('');
      return new Response(events, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-MasterSelects-Event-Cursor': '2',
        },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onPhase = vi.fn();

    const response = await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      onPhase,
      openAiReasoningEffort: 'low',
      prompt: 'Suggest lighting',
      provider: 'kie',
      temperature: 0.7,
    });

    expect(response).toBe('Use softer backlight.');
    expect(onPhase).toHaveBeenCalledWith('kernel');
    expect(onPhase).toHaveBeenCalledWith('provider');
    expect(fetchMock).toHaveBeenCalledWith('/api/kernel/hosted-agent/turns', expect.objectContaining({
      method: 'POST',
    }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      maximumOutputTokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      model: 'gpt-5-6-luna',
      reasoningEffort: 'low',
      routePreference: 'auto',
      toolExecutionMode: 'normal',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0]))
      .toContain(`/hosted-agent/turns/${encodeURIComponent(turnId)}/events`);
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

  it('labels hosted chat as exact usage-based billing', () => {
    expect(getFlashBoardChatCreditCost('gpt-5-6-luna')).toBe(3);
    expect(getFlashBoardChatCreditLabel('gpt-5-6-sol')).toBe('usage × 6');
    expect(getFlashBoardChatCreditCost('claude-fable-5')).toBe(10);
    expect(getFlashBoardChatCreditLabel('unknown-chat-model')).toBe('usage × 6');
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
