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
  getTimelineRevision: vi.fn(() => 0),
  handleCaptureFrame: vi.fn(),
}));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: mocks.executeAIToolCalls,
}));

vi.mock('../../src/stores/timeline/revisionMiddleware', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/stores/timeline/revisionMiddleware')>(),
  getTimelineRevision: mocks.getTimelineRevision,
}));

vi.mock('../../src/services/aiTools/handlers/preview', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools/handlers/preview')>(),
  handleCaptureFrame: mocks.handleCaptureFrame,
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
    mocks.getTimelineRevision.mockReset();
    mocks.getTimelineRevision.mockReturnValue(0);
    mocks.handleCaptureFrame.mockReset();
    mocks.handleCaptureFrame.mockResolvedValue({
      success: true,
      data: { capturedAt: 0, dataUrl: DATA_URL, height: 180, width: 320 },
    });
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

  it('sends captured pixels through the hosted vision payload', async () => {
    let hostedTurnId = '';
    const hostedSessionId = 'vision-session';
    let replayCount = 0;
    const hostedFetch = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
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
        hostedTurnId = String(request.turnId);
        return new Response(JSON.stringify({
          acceptedHistoryFormatVersion: request.historyFormatVersion,
          acceptedPromptVersion: request.promptVersion,
          acceptedToolSchemaVersion: request.toolSchemaVersion,
          eventsPath: `/api/kernel/hosted-agent/turns/${hostedTurnId}/events`,
          maximumIterations: 400,
          maximumSpendCredits: 500,
          pageLease: {
            expiresAt: '2026-07-31T12:05:00.000Z',
            leaseToken: 'vision-lease',
            sessionId: hostedSessionId,
          },
          protocolVersion: 'hosted-agent-k2-v1',
          replayed: false,
          route: 'fast-agent',
          sessionId: hostedSessionId,
          turnId: hostedTurnId,
        }), { status: 202 });
      }
      if (url.endsWith('/tool-results')) {
        return new Response(JSON.stringify({
          accepted: true,
          duplicate: false,
          sequence: 0,
          sessionId: hostedSessionId,
          turnId: hostedTurnId,
        }), { status: 200 });
      }
      replayCount += 1;
      const events = replayCount === 1 ? [{
        acceptedHistoryFormatVersion: 'flashboard-provider-history-v1',
        acceptedPromptVersion: 'flashboard-chat-v2',
        acceptedToolSchemaVersion: 'flashboard-chat-tools-v2',
        eventId: '1',
        kind: 'session-ready',
        maximumIterations: 400,
        maximumSpendCredits: 500,
        sessionId: hostedSessionId,
        turnId: hostedTurnId,
      }, {
        eventId: '2',
        kind: 'tool-batch-request',
        roundIndex: 0,
        sequence: 0,
        sessionId: hostedSessionId,
        toolCalls: [{ args: { time: 2 }, toolCallId: 'capture-1', toolName: 'captureFrame' }],
        toolSchemaVersion: 'flashboard-chat-tools-v2',
        turnId: hostedTurnId,
      }] : [{
        creditsCharged: 1,
        eventId: '3',
        kind: 'turn-complete',
        message: 'A person enters the room.',
        rounds: 2,
        sessionId: hostedSessionId,
        turnId: hostedTurnId,
      }];
      return new Response(events.map(event => (
        `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
      )).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', hostedFetch);

    await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      prompt: 'What happens?',
      provider: 'kie',
      temperature: 0.7,
    });

    const hostedToolBody = JSON.parse(String(hostedFetch.mock.calls[3]?.[1]?.body));
    expect(hostedToolBody.results[0].modelContent).toContain(
      '[image data omitted from compact chat context]',
    );
    expect(hostedToolBody.results[0].modelContent).not.toContain(DATA_URL);
    expect(hostedToolBody.results[0].providerContent.openAiFollowupInput).toEqual([{
      content: [
        { text: 'Visual output from captureFrame:', type: 'input_text' },
        { detail: 'high', image_url: DATA_URL, type: 'input_image' },
      ],
      role: 'user',
    }]);
    expect(hostedToolBody.results[0].providerContent).not.toHaveProperty(
      'claudeToolResultContent',
    );

  });

  it('adds one automatic preview after a mutating batch without a requested capture tool', async () => {
    mocks.executeAIToolCalls.mockResolvedValue([{
      id: 'mutate-1',
      result: { success: true, data: { clipId: 'text-1' } },
    }]);
    mocks.getTimelineRevision.mockReturnValueOnce(10).mockReturnValue(11);
    let hostedTurnId = '';
    let replayCount = 0;
    const hostedFetch = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
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
        hostedTurnId = String(request.turnId);
        return new Response(JSON.stringify({
          acceptedHistoryFormatVersion: request.historyFormatVersion,
          acceptedPromptVersion: request.promptVersion,
          acceptedToolSchemaVersion: request.toolSchemaVersion,
          eventsPath: `/api/kernel/hosted-agent/turns/${hostedTurnId}/events`,
          maximumIterations: 400,
          maximumSpendCredits: 500,
          pageLease: {
            expiresAt: '2026-07-31T12:05:00.000Z',
            leaseToken: 'vision-lease',
            sessionId: 'automatic-vision-session',
          },
          protocolVersion: 'hosted-agent-k2-v1',
          replayed: false,
          route: 'fast-agent',
          sessionId: 'automatic-vision-session',
          turnId: hostedTurnId,
        }), { status: 202 });
      }
      if (url.endsWith('/tool-results')) {
        return new Response(JSON.stringify({
          accepted: true,
          duplicate: false,
          sequence: 0,
          sessionId: 'automatic-vision-session',
          turnId: hostedTurnId,
        }), { status: 200 });
      }
      replayCount += 1;
      const events = replayCount === 1 ? [{
        acceptedHistoryFormatVersion: 'flashboard-provider-history-v1',
        acceptedPromptVersion: 'flashboard-chat-v2',
          acceptedToolSchemaVersion: 'flashboard-chat-tools-v2',
        eventId: '1',
        kind: 'session-ready',
        maximumIterations: 400,
        maximumSpendCredits: 500,
        sessionId: 'automatic-vision-session',
        turnId: hostedTurnId,
      }, {
        eventId: '2',
        kind: 'tool-batch-request',
        roundIndex: 0,
        sequence: 0,
        sessionId: 'automatic-vision-session',
        toolCalls: [{ args: { text: 'Title' }, toolCallId: 'mutate-1', toolName: 'createTextClip' }],
        toolSchemaVersion: 'flashboard-chat-tools-v2',
        turnId: hostedTurnId,
      }] : [{
        creditsCharged: 1,
        eventId: '3',
        kind: 'turn-complete',
        message: 'Done.',
        rounds: 2,
        sessionId: 'automatic-vision-session',
        turnId: hostedTurnId,
      }];
      return new Response(events.map(event => (
        `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
      )).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', hostedFetch);

    await sendFlashBoardChatMessage({
      hostedAvailable: true,
      model: 'gpt-5-6-luna',
      prompt: 'Create a title.',
      provider: 'kie',
      temperature: 0.7,
    });

    expect(mocks.handleCaptureFrame).toHaveBeenCalledTimes(1);
    const hostedToolBody = JSON.parse(String(hostedFetch.mock.calls[3]?.[1]?.body));
    expect(hostedToolBody.results[0].providerContent.openAiFollowupInput[0].content)
      .toEqual([
        {
          text: 'Automatic post-edit preview after this tool batch. This current frame is valid visual evidence; do not call captureFrame again unless you need another time or the image reveals a problem:',
          type: 'input_text',
        },
        { detail: 'high', image_url: DATA_URL, type: 'input_image' },
      ]);
  });
});
