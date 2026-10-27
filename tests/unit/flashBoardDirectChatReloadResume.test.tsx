import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resumeCalls = vi.hoisted(() => [] as Array<{ assistantMessageId: string; activeRequestId: string | null }>);

vi.mock('../../src/services/flashboard/FlashBoardDirectCodexTransport', async () => {
  const { getActiveAgentRequestId } = await import('../../src/services/aiTools/agentTransaction');
  return {
    resumeDirectCodexChat: vi.fn(async (input: { assistantMessageId: string }) => {
      resumeCalls.push({ assistantMessageId: input.assistantMessageId, activeRequestId: getActiveAgentRequestId() });
      await Promise.resolve();
      return 'Resumed answer.';
    }),
  };
});

import {
  resetResumedDirectChatTurnsForTests,
  useFlashBoardDirectChatReloadResume,
} from '../../src/components/panels/flashboard/useFlashBoardDirectChatReloadResume';
import {
  clearDirectCodexReloadSnapshot,
  saveDirectCodexReloadSnapshot,
} from '../../src/services/flashboard/FlashBoardDirectCodexReloadResume';
import { getFlashBoardDirectChatRunSnapshot } from '../../src/services/flashboard/FlashBoardDirectChatRun';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';

const MESSAGE_ID = 'assistant-reloaded-1';

function seedPendingTurn(requestGroupId?: string): void {
  saveDirectCodexReloadSnapshot({
    assistantMessageId: MESSAGE_ID, conversationRef: 'default', prompt: 'Split the clip.',
    ...(requestGroupId ? { requestGroupId } : {}), threadId: 'thread-1', turnId: 'turn-1',
  });
  const state = useFlashBoardStore.getState();
  state.setWorkspaceChatMessages(state.activeAIWorkspaceId, [
    { id: 'user-1', role: 'user', text: 'Split the clip.', createdAt: 1 },
    { id: MESSAGE_ID, role: 'assistant', text: 'Thinking…', isPending: true, createdAt: 2 },
  ]);
}

describe('Direct turn resume after a reload', () => {
  beforeEach(() => {
    resumeCalls.length = 0;
    resetResumedDirectChatTurnsForTests();
  });
  afterEach(() => {
    clearDirectCodexReloadSnapshot(MESSAGE_ID);
    const state = useFlashBoardStore.getState();
    state.setWorkspaceChatMessages(state.activeAIWorkspaceId, []);
  });

  it('resumes from the always-mounted host without any chat view, inside the original Undo group', async () => {
    seedPendingTurn('chat-run-original');
    const { unmount } = renderHook(() => useFlashBoardDirectChatReloadResume());
    await waitFor(() => expect(resumeCalls).toHaveLength(1));
    expect(resumeCalls[0]).toEqual({ assistantMessageId: MESSAGE_ID, activeRequestId: 'chat-run-original' });
    await waitFor(() => {
      const message = useFlashBoardStore.getState().chatMessages.find((candidate) => candidate.id === MESSAGE_ID);
      expect(message?.isPending).toBe(false);
      expect(message?.text).toContain('Resumed answer.');
    });
    expect(getFlashBoardDirectChatRunSnapshot('default')).toBe(false);
    unmount();
  });

  it('resumes each reloaded turn once, even with a second mount', async () => {
    seedPendingTurn();
    const first = renderHook(() => useFlashBoardDirectChatReloadResume());
    const second = renderHook(() => useFlashBoardDirectChatReloadResume());
    await waitFor(() => expect(resumeCalls).toHaveLength(1));
    // Without a stored group the post-reload calls still form one Undo step under the message id.
    expect(resumeCalls[0].activeRequestId).toBe(MESSAGE_ID);
    first.unmount();
    second.unmount();
  });
});
