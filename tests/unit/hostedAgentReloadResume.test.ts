import { afterEach, describe, expect, it } from 'vitest';

import {
  clearHostedAgentReloadSnapshot,
  readHostedAgentFastV2ReloadSnapshot,
  saveHostedAgentFastV2ReloadSnapshot,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent';
import { normalizeFlashBoardChatMessage } from '../../src/services/project/flashBoardChatProjectCodec';

const ASSISTANT_MESSAGE_ID = 'assistant-reload-test';

function turnRequest(): HostedAgentFastV2StartRequest {
  return {
    clientInstanceId: 'page_reload_test',
    compactSnapshot: {
      payload: { clips: [], tracks: [] },
      schemaVersion: 1,
      stateFingerprint: `sha256:${'a'.repeat(64)}`,
      timelineRevision: 3,
    },
    editorBuildId: 'masterselects:reload-test',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    protocolVersion: 'fast-agent-v2',
    request: 'Inspect the timeline.',
    runSource: 'ui',
    turnId: 'flashboard-chat-turn:assistant-reload-test',
    visualReferences: [],
  };
}

const timelineCheckpoint = {
  operationCheckpoint: null,
  timelineRevision: 3,
  timelineStateCanonical: '[[]]',
};

afterEach(() => {
  clearHostedAgentReloadSnapshot(ASSISTANT_MESSAGE_ID);
});

describe('hosted-agent reload resume', () => {
  it('keeps a persisted pending bubble reconnectable while its tab snapshot exists', () => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      cursor: '1',
      request: turnRequest(),
      ...timelineCheckpoint,
    });

    expect(readHostedAgentFastV2ReloadSnapshot(ASSISTANT_MESSAGE_ID)).toMatchObject({
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
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      cursor: '2',
      request: turnRequest(),
      ...timelineCheckpoint,
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
