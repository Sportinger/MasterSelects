import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHostedAgentExecutionProfileAvailability,
  sendHostedKieAgentChat,
} from '../../src/services/flashboard/FlashBoardHostedAgentTransport';
import {
  HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('Fast V2 official hosted UI orchestration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('uses the server-selected V2 path without browser prompt, tool, or model authority', async () => {
    let browserRequest: HostedAgentFastV2StartRequest | null = null;
    const sessionId = 'session-v2-ui';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (requestInfo, init) => {
      const url = new URL(String(requestInfo), 'https://masterselects.test');
      if (url.pathname === '/api/kernel/hosted-agent/protocol') {
        return jsonResponse({
          availableExecutionProfiles: ['fast'],
          protocolVersion: 'fast-agent-v2',
          reason: 'canary_selected',
        });
      }
      if (url.pathname === '/api/kernel/hosted-agent/v2/turns') {
        browserRequest = JSON.parse(String(init?.body)) as HostedAgentFastV2StartRequest;
        return jsonResponse({
          acceptedExecutionContractDigest: browserRequest.executionContractDigest,
          acceptedExecutionContractVersion: browserRequest.executionContractVersion,
          eventsPath: `/api/kernel/hosted-agent/v2/turns/${browserRequest.turnId}/events`,
          maximumIterations: 4,
          maximumSpendCredits: 500,
          pageLease: {
            expiresAt: '2026-08-01T23:59:00.000Z',
            leaseToken: 'lease-v2-ui',
            sessionId,
          },
          protocolVersion: 'fast-agent-v2',
          replayed: false,
          route: 'fast-agent-v2',
          sessionId,
          turnId: browserRequest.turnId,
        }, 202);
      }
      if (browserRequest && url.pathname === (
        `/api/kernel/hosted-agent/v2/turns/${browserRequest.turnId}/events`
      )) {
        const binding = {
          protocolVersion: 'fast-agent-v2',
          sessionId,
          turnId: browserRequest.turnId,
        } as const;
        const events = [{
          ...binding,
          budgetPolicyVersion: HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
          capabilityBundleVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
          eventId: '1',
          kind: 'session-ready',
          maximumIterations: 4,
          maximumSpendCredits: 500,
          modelPolicyVersion: HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
          promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
          snapshotStateFingerprint: browserRequest.compactSnapshot.stateFingerprint,
          snapshotTimelineRevision: browserRequest.compactSnapshot.timelineRevision,
        }, {
          ...binding,
          creditBalance: 95,
          creditsCharged: 5,
          eventId: '2',
          kind: 'billing-settled',
          ledgerEntryId: 'ledger-v2-ui',
          roundIndex: 0,
          totalCreditsCharged: 5,
        }, {
          ...binding,
          creditsCharged: 5,
          eventId: '3',
          kind: 'turn-complete',
          message: 'The private kernel finished safely.',
          rounds: 1,
        }];
        const body = events.map((event) => (
          `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
        )).join('');
        return new Response(body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-MasterSelects-Event-Cursor': '3',
            'X-MasterSelects-Stream-Lease-Ms': '55000',
          },
        });
      }
      throw new Error(`Unexpected Fast V2 UI request: ${url.pathname}`);
    });

    const response = await sendHostedKieAgentChat({
      protocol: 'openai-responses',
      request: {
        hostedAvailable: true,
        idempotencyKey: 'turn-v2-ui',
        model: 'gpt-5-6-terra',
        prompt: 'Inspect the current edit.',
        provider: 'kie',
        temperature: 0.7,
        toolExecutionMode: 'normal',
      },
      supportsTools: true,
      systemPrompt: 'PRIVATE_BROWSER_PROMPT_MUST_NOT_EGRESS',
    });

    expect(response).toBe('The private kernel finished safely.');
    expect(browserRequest).toMatchObject({
      executionProfile: 'fast',
      protocolVersion: 'fast-agent-v2',
      request: 'Inspect the current edit.',
      requestedExecutionMode: 'normal',
      requestedModelClass: 'fast',
      turnId: 'turn-v2-ui',
    });
    expect(JSON.stringify(browserRequest)).not.toMatch(
      /PRIVATE_BROWSER_PROMPT_MUST_NOT_EGRESS|providerInput|systemPrompt|tools|reasoningEffort|maxTurnSpendCredits/,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('fetches fresh server-owned execution-profile availability without caching', async () => {
    const selections = [
      ['fast'],
      ['fast', 'verified'],
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      jsonResponse({
        availableExecutionProfiles: selections.shift(),
        protocolVersion: 'fast-agent-v2',
        reason: 'canary_selected',
      })
    ));

    await expect(getHostedAgentExecutionProfileAvailability()).resolves.toEqual(['fast']);
    await expect(getHostedAgentExecutionProfileAvailability()).resolves.toEqual([
      'fast',
      'verified',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/kernel/hosted-agent/protocol',
      '/api/kernel/hosted-agent/protocol',
    ]);
  });

  it('routes Verified only through available V2 and surfaces unsupported-family failures', async () => {
    let browserRequest: HostedAgentFastV2StartRequest | null = null;
    const sessionId = 'session-v2-ui-verified';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (requestInfo, init) => {
      const url = new URL(String(requestInfo), 'https://masterselects.test');
      if (url.pathname === '/api/kernel/hosted-agent/protocol') {
        return jsonResponse({
          availableExecutionProfiles: ['fast', 'verified'],
          protocolVersion: 'fast-agent-v2',
          reason: 'canary_selected',
        });
      }
      if (url.pathname === '/api/kernel/hosted-agent/v2/turns') {
        browserRequest = JSON.parse(String(init?.body)) as HostedAgentFastV2StartRequest;
        return jsonResponse({
          acceptedExecutionContractDigest: browserRequest.executionContractDigest,
          acceptedExecutionContractVersion: browserRequest.executionContractVersion,
          eventsPath: `/api/kernel/hosted-agent/v2/turns/${browserRequest.turnId}/events`,
          maximumIterations: 4,
          maximumSpendCredits: 500,
          pageLease: {
            expiresAt: '2026-08-01T23:59:00.000Z',
            leaseToken: 'lease-v2-ui-verified',
            sessionId,
          },
          protocolVersion: 'fast-agent-v2',
          replayed: false,
          route: 'fast-agent-v2',
          sessionId,
          turnId: browserRequest.turnId,
        }, 202);
      }
      if (browserRequest && url.pathname === (
        `/api/kernel/hosted-agent/v2/turns/${browserRequest.turnId}/events`
      )) {
        const binding = {
          protocolVersion: 'fast-agent-v2',
          sessionId,
          turnId: browserRequest.turnId,
        } as const;
        const events = [{
          ...binding,
          budgetPolicyVersion: HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
          capabilityBundleVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
          eventId: '1',
          kind: 'session-ready',
          maximumIterations: 4,
          maximumSpendCredits: 500,
          modelPolicyVersion: HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
          promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
          snapshotStateFingerprint: browserRequest.compactSnapshot.stateFingerprint,
          snapshotTimelineRevision: browserRequest.compactSnapshot.timelineRevision,
        }, {
          ...binding,
          eventId: '2',
          kind: 'turn-failed',
          message: 'verified-family-unsupported',
          recoverable: false,
        }];
        return new Response(events.map((event) => (
          `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
        )).join(''), {
          headers: {
            'Content-Type': 'text/event-stream',
            'X-MasterSelects-Event-Cursor': '2',
            'X-MasterSelects-Stream-Lease-Ms': '55000',
          },
        });
      }
      throw new Error(`Unexpected Verified UI request: ${url.pathname}`);
    });

    await expect(sendHostedKieAgentChat({
      protocol: 'openai-responses',
      request: {
        executionProfile: 'verified',
        hostedAvailable: true,
        idempotencyKey: 'turn-v2-ui-verified',
        model: 'gpt-5-6-terra',
        prompt: 'Remove the marked range carefully.',
        provider: 'kie',
        temperature: 0.7,
        toolExecutionMode: 'normal',
      },
      supportsTools: true,
      systemPrompt: 'MUST_NOT_EGRESS',
    })).rejects.toThrow(
      'The Verified profile does not support this request yet. Choose Fast or use a supported range-removal request.',
    );
    expect(browserRequest).toMatchObject({ executionProfile: 'verified' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('never degrades an unavailable Verified selection to the legacy K2 route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'hosted-agent-k2-v1',
      reason: 'outside_canary',
    }));

    await expect(sendHostedKieAgentChat({
      protocol: 'openai-responses',
      request: {
        executionProfile: 'verified',
        hostedAvailable: true,
        model: 'gpt-5-6-terra',
        prompt: 'Remove the marked range carefully.',
        provider: 'kie',
        temperature: 0.7,
      },
      supportsTools: true,
      systemPrompt: 'MUST_NOT_BE_SENT_TO_V1',
    })).rejects.toThrow(/Verified profile pilot is unavailable/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/kernel/hosted-agent/protocol');
  });

  it('preserves the existing Fast fallback to the server-selected legacy K2 route', async () => {
    let turnId = '';
    const sessionId = 'session-v1-ui-fast-fallback';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (requestInfo, init) => {
        const url = String(requestInfo);
        if (url === '/api/kernel/hosted-agent/protocol') {
          return jsonResponse({
            availableExecutionProfiles: ['fast'],
            protocolVersion: 'hosted-agent-k2-v1',
            reason: 'outside_canary',
          });
        }
        if (url === '/api/kernel/hosted-agent/turns') {
          const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
          turnId = String(request.turnId);
          expect(request).not.toHaveProperty('executionProfile');
          return jsonResponse({
            acceptedHistoryFormatVersion: request.historyFormatVersion,
            acceptedPromptVersion: request.promptVersion,
            acceptedToolSchemaVersion: request.toolSchemaVersion,
            eventsPath: `/api/kernel/hosted-agent/turns/${turnId}/events`,
            maximumIterations: 400,
            maximumSpendCredits: 100,
            pageLease: {
              expiresAt: '2026-08-01T23:59:00.000Z',
              leaseToken: 'lease-v1-ui-fast-fallback',
              sessionId,
            },
            protocolVersion: 'hosted-agent-k2-v1',
            replayed: false,
            route: 'fast-agent',
            sessionId,
            turnId,
          }, 202);
        }
        const events = [
          `id: 1\nevent: session-ready\ndata: ${JSON.stringify({
            acceptedHistoryFormatVersion: 'flashboard-provider-history-v1',
            acceptedPromptVersion: 'flashboard-chat-v2',
            acceptedToolSchemaVersion: 'flashboard-chat-tools-v2',
            eventId: '1',
            kind: 'session-ready',
            maximumIterations: 400,
            maximumSpendCredits: 100,
            sessionId,
            turnId,
          })}\n\n`,
          `id: 2\nevent: turn-complete\ndata: ${JSON.stringify({
            creditsCharged: 0,
            eventId: '2',
            kind: 'turn-complete',
            message: 'Fast fallback finished safely.',
            rounds: 1,
            sessionId,
            turnId,
          })}\n\n`,
        ].join('');
        return new Response(events, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-MasterSelects-Event-Cursor': '2',
          },
        });
      },
    );

    await expect(sendHostedKieAgentChat({
      protocol: 'openai-responses',
      request: {
        hostedAvailable: true,
        model: 'gpt-5-6-terra',
        prompt: 'Inspect the edit.',
        provider: 'kie',
        temperature: 0.7,
      },
      supportsTools: true,
      systemPrompt: 'Existing V1 prompt.',
    })).resolves.toBe('Fast fallback finished safely.');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/kernel/hosted-agent/turns');
  });

  it('fails closed when server protocol selection is unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      error: 'service_unavailable',
    }, 503));

    await expect(sendHostedKieAgentChat({
      protocol: 'openai-responses',
      request: {
        hostedAvailable: true,
        model: 'gpt-5-6-terra',
        prompt: 'Inspect the current edit.',
        provider: 'kie',
        temperature: 0.7,
      },
      supportsTools: true,
      systemPrompt: 'MUST_NOT_BE_SENT_TO_V1',
    })).rejects.toThrow(/temporarily unavailable/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/kernel/hosted-agent/protocol');
  });
});
