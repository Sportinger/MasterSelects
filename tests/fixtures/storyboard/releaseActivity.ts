import type { AgentActivityEvent } from '../../../src/services/flashboard/FlashBoardChatTypes';
import type { FlashBoardChatMessage } from '../../../src/stores/flashboardStore';

export function createReleaseActivityEvents(): AgentActivityEvent[] {
  return [
    {
      id: 'release-narration-inspect',
      runId: 'release-run',
      kind: 'narration',
      source: 'model',
      phase: 'inspecting',
      roundIndex: 0,
      text: 'I am checking the marked range before preparing options.',
      createdAt: 1,
    },
    {
      id: 'release-operation-started',
      runId: 'release-run',
      kind: 'operation',
      source: 'runtime',
      phase: 'started',
      safeLabel: 'Read timeline',
      toolName: 'getTimelineState',
      createdAt: 2,
    },
    {
      id: 'release-operation-completed',
      runId: 'release-run',
      kind: 'operation',
      source: 'runtime',
      phase: 'completed',
      safeLabel: 'Read timeline',
      toolName: 'getTimelineState',
      createdAt: 3,
    },
    {
      id: 'release-narration-options',
      runId: 'release-run',
      kind: 'narration',
      source: 'model',
      phase: 'planning',
      roundIndex: 1,
      text: 'I have three directions and am preparing the decision.',
      createdAt: 4,
    },
    {
      id: 'release-operation-failed',
      runId: 'release-run',
      kind: 'operation',
      source: 'runtime',
      phase: 'failed',
      safeLabel: 'Prepare option C',
      toolName: 'prepareStoryboardOption',
      createdAt: 5,
    },
  ];
}

export function createReleasePendingActivityMessage(): FlashBoardChatMessage {
  return {
    id: 'release-assistant-message',
    role: 'assistant',
    text: 'Thinking...',
    isPending: true,
    activityEvents: createReleaseActivityEvents(),
  };
}
