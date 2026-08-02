import { afterEach, describe, expect, it } from 'vitest';

import {
  clearHostedAgentReloadSnapshot,
  readHostedAgentReloadSnapshot,
  saveHostedAgentReloadSnapshot,
  type HostedAgentK1TurnRequest,
} from '../../src/services/kernelClient/hostedAgent';
import { normalizeFlashBoardChatMessage } from '../../src/services/project/flashBoardChatProjectCodec';

const ASSISTANT_MESSAGE_ID = 'assistant-reload-test';

function turnRequest(): HostedAgentK1TurnRequest {
  return {
    clientCapabilities: {
      maximumInlineResultCharacters: 1_000_000,
      supportsImageResultRefs: false,
      supportsNarrationDeltas: false,
      toolNames: ['getTimelineState'],
    },
    clientInstanceId: 'page_reload_test',
    historyFormatVersion: 'history-v1',
    maximumOutputTokens: 4_096,
    maxTurnSpendCredits: 50,
    model: 'gpt-5-6-terra',
    modelPrompt: 'Inspect the timeline.',
    playbookPrompt: 'Inspect the timeline.',
    promptVersion: 'prompt-v1',
    providerInput: {
      input: [{ content: 'Inspect the timeline.', role: 'user' }],
      protocol: 'openai-responses',
      store: false,
      tools: [],
    },
    request: 'Inspect the timeline.',
    routePreference: 'auto',
    runSource: 'ui',
    systemPrompt: 'Use editor tools.',
    toolExecutionMode: 'normal',
    toolSchemaVersion: 'tools-v1',
    turnId: 'flashboard-chat-turn:assistant-reload-test',
    visualReferences: [],
  };
}

afterEach(() => {
  clearHostedAgentReloadSnapshot(ASSISTANT_MESSAGE_ID);
});

describe('hosted-agent reload resume', () => {
  it('keeps a persisted pending bubble reconnectable while its tab snapshot exists', () => {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      completedBatches: [],
      cursor: '1',
      request: turnRequest(),
    });

    expect(readHostedAgentReloadSnapshot(ASSISTANT_MESSAGE_ID)).toMatchObject({
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      cursor: '1',
    });
    expect(normalizeFlashBoardChatMessage({
      id: ASSISTANT_MESSAGE_ID,
      isPending: true,
      role: 'assistant',
      text: 'AI thinking…',
    })).toMatchObject({
      id: ASSISTANT_MESSAGE_ID,
      isPending: true,
      text: 'Reconnecting to kernel…',
    });
  });

  it('keeps already streamed text visible while reconnecting a hosted turn', () => {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      completedBatches: [],
      cursor: '2',
      request: turnRequest(),
    });

    expect(normalizeFlashBoardChatMessage({
      id: ASSISTANT_MESSAGE_ID,
      isPending: true,
      isStreaming: true,
      role: 'assistant',
      text: 'This partial answer is already visible.',
    })).toMatchObject({
      isPending: true,
      isStreaming: true,
      text: 'This partial answer is already visible.',
    });
  });

  it('still settles an orphaned legacy pending bubble as interrupted', () => {
    expect(normalizeFlashBoardChatMessage({
      id: ASSISTANT_MESSAGE_ID,
      isPending: true,
      role: 'assistant',
      text: 'Thinking…',
    })).toMatchObject({
      isError: true,
      isPending: false,
      text: 'Chat interrupted by reload.',
    });
  });
});
