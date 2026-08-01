import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';

const mocks = vi.hoisted(() => ({
  executeAIToolCalls: vi.fn(),
}));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: mocks.executeAIToolCalls,
}));

function acceptedTurn(init: RequestInit | undefined, sessionId = 'abort-session'): Response {
  const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const turnId = String(request.turnId);
  return new Response(JSON.stringify({
    acceptedHistoryFormatVersion: request.historyFormatVersion,
    acceptedPromptVersion: request.promptVersion,
    acceptedToolSchemaVersion: request.toolSchemaVersion,
    eventsPath: `/api/kernel/hosted-agent/turns/${turnId}/events`,
    maximumIterations: 400,
    maximumSpendCredits: 500,
    pageLease: {
      expiresAt: '2026-07-31T12:05:00.000Z',
      leaseToken: 'abort-lease',
      sessionId,
    },
    protocolVersion: 'hosted-agent-k2-v1',
    replayed: false,
    route: 'fast-agent',
    sessionId,
    turnId,
  }), { status: 202 });
}

function hostedToolEvents(turnId: string, sessionId = 'abort-session'): Response {
  const events = [{
    acceptedHistoryFormatVersion: 'flashboard-provider-history-v1',
    acceptedPromptVersion: 'flashboard-chat-v2',
    acceptedToolSchemaVersion: 'flashboard-chat-tools-v2',
    eventId: '1',
    kind: 'session-ready',
    maximumIterations: 400,
    maximumSpendCredits: 500,
    sessionId,
    turnId,
  }, {
    eventId: '2',
    kind: 'tool-batch-request',
    roundIndex: 0,
    sequence: 0,
    sessionId,
    toolCalls: [{ args: {}, toolCallId: 'inspect-1', toolName: 'getTimelineState' }],
    toolSchemaVersion: 'flashboard-chat-tools-v2',
    turnId,
  }];
  return new Response(events.map(event => (
    `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
  )).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
}

function hostedAgentV1ProtocolResponse(): Response {
  return new Response(JSON.stringify({
    availableExecutionProfiles: ['fast'],
    protocolVersion: 'hosted-agent-k2-v1',
    reason: 'outside_canary',
  }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
}

describe('hosted FlashBoard chat cancellation', () => {
  beforeEach(() => {
    mocks.executeAIToolCalls.mockResolvedValue([{
      id: 'inspect-1',
      result: { success: true, data: { clips: [] } },
    }]);
  });

  afterEach(() => {
    mocks.executeAIToolCalls.mockReset();
    vi.unstubAllGlobals();
  });

  it('propagates AbortSignal into an active hosted provider request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('Chat stopped.', 'AbortError'));
        }, { once: true });
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      prompt: 'Inspect.',
      provider: 'kie',
      signal: controller.signal,
      temperature: 0.7,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException('Chat stopped.', 'AbortError'));

    await expect(response).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.executeAIToolCalls).not.toHaveBeenCalled();
  });

  it('stops after a tool-bearing response when cancelled before execution', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/kernel/hosted-agent/protocol') {
        return hostedAgentV1ProtocolResponse();
      }
      if (String(url) === '/api/kernel/hosted-agent/turns') {
        controller.abort(new DOMException('Chat stopped.', 'AbortError'));
        return acceptedTurn(init);
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      prompt: 'Inspect.',
      provider: 'kie',
      signal: controller.signal,
      temperature: 0.7,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mocks.executeAIToolCalls).not.toHaveBeenCalled();
    const firstBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.routePreference).toBe('auto');
    expect(String(fetchMock.mock.calls[2]?.[0])).toMatch(/\/cancel$/);
    expect(String(fetchMock.mock.calls[3]?.[0])).toMatch(/\/events$/);
  });

  it('does not authorize a later provider round after cancellation during a tool batch', async () => {
    const controller = new AbortController();
    let turnId = '';
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/kernel/hosted-agent/protocol') {
        return hostedAgentV1ProtocolResponse();
      }
      if (path === '/api/kernel/hosted-agent/turns') {
        turnId = String((JSON.parse(String(init?.body)) as Record<string, unknown>).turnId);
        return acceptedTurn(init);
      }
      if (path.endsWith('/events')) {
        return hostedToolEvents(turnId);
      }
      if (path.endsWith('/cancel')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected hosted-agent request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    mocks.executeAIToolCalls.mockImplementationOnce(async () => {
      controller.abort(new DOMException('Chat stopped.', 'AbortError'));
      return [{
        id: 'inspect-1',
        result: { success: true, data: { clips: [] } },
      }];
    });

    await expect(sendFlashBoardChatMessage({
      hostedAvailable: true,
      idempotencyKey: 'cancel-after-tool',
      model: 'gpt-5-6-luna',
      prompt: 'Inspect.',
      provider: 'kie',
      signal: controller.signal,
      temperature: 0.7,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.executeAIToolCalls).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.turnId).toBe('cancel-after-tool');
    expect(String(fetchMock.mock.calls[3]?.[0])).toMatch(/\/cancel$/);
    expect(String(fetchMock.mock.calls[4]?.[0])).toMatch(/\/events$/);
  });
});
