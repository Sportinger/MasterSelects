import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  sendFlashBoardChatMessage,
} from '../../src/services/flashboard/FlashBoardChatService';
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

  it('rejects managed Kie chat when no hosted session is available', async () => {
    await expect(sendFlashBoardChatMessage({
      model: 'gpt-5-6-luna',
      prompt: 'Inspect this timeline',
      provider: 'kie',
      temperature: 0.7,
    })).rejects.toThrow(/hosted/i);

    expect(kernelGatewayMocks.tryKernelFirst).not.toHaveBeenCalled();
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

  it('uses the kernel fast-agent when a signed-in cloud session is available', async () => {
    let turnId = '';
    const sessionId = 'ha_test_session';
    const fetchMock = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const url = String(requestInfo);
      if (url === '/api/kernel/hosted-agent/protocol') {
        return new Response(JSON.stringify({
          availableExecutionProfiles: ['fast'],
          protocolVersion: 'hosted-agent-k2-v1',
          reason: 'outside_canary',
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }
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
          acceptedToolSchemaVersion: 'flashboard-chat-tools-v2',
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

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({
      maximumOutputTokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      model: 'gpt-5-6-luna',
      reasoningEffort: 'low',
      routePreference: 'auto',
      toolExecutionMode: 'normal',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0]))
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

  it('labels hosted chat as exact usage-based billing', () => {
    expect(getFlashBoardChatCreditCost('gpt-5-6-luna')).toBe(3);
    expect(getFlashBoardChatCreditLabel('gpt-5-6-sol')).toBe('usage × 6');
    expect(getFlashBoardChatCreditCost('claude-fable-5')).toBe(10);
    expect(getFlashBoardChatCreditLabel('unknown-chat-model')).toBe('usage × 6');
  });

});
