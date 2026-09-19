import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareVisualReferences: vi.fn().mockResolvedValue([]),
  sendChatMessage: vi.fn(async (request: {
    onRunCompleted?: (run: unknown) => void;
  }) => {
    request.onRunCompleted?.({ promptVersion: 'flashboard-chat-v2' });
    return 'Done.';
  }),
}));

vi.mock('../../src/services/flashboard/FlashBoardChatService', () => ({
  sendFlashBoardChatMessage: mocks.sendChatMessage,
}));

vi.mock('../../src/services/flashboard/FlashBoardChatVisualReferences', () => ({
  prepareFlashBoardChatVisualReferences: mocks.prepareVisualReferences,
}));

import { runFlashBoardBridgeChatTurn } from '../../src/services/flashboard/FlashBoardChatBridgeRunner';
import { useAccountStore } from '../../src/stores/accountStore';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';

describe('FlashBoard bridge Logic routing', () => {
  beforeEach(() => {
    mocks.prepareVisualReferences.mockClear();
    mocks.sendChatMessage.mockClear();
    useAccountStore.setState({
      hostedAIEnabled: true,
      session: { authenticated: true, provider: 'dev' },
    });
    useFlashBoardStore.setState({ chatMessages: [] });
  });

  it('forwards an explicit Logic agent mode to hosted chat', async () => {
    await runFlashBoardBridgeChatTurn({
      persistToChat: false,
      prompt: 'Make the opening coherent',
      requestedAgentMode: 'logic',
    });

    expect(mocks.sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestedAgentMode: 'logic',
    }));
  });

  it('forwards a selected preproduction run to the hosted editor turn', async () => {
    await runFlashBoardBridgeChatTurn({
      persistToChat: false,
      preproductionRunId: 'seedance-preproduction-direct-live-20260807-1558',
      prompt: 'Implement the selected production plan.',
      requestedAgentMode: 'logic',
    });

    expect(mocks.sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      preproductionRunId: 'seedance-preproduction-direct-live-20260807-1558',
    }));
  });

  it('binds a Direct turn to one conversation without hosted credits or flattened history', async () => {
    useAccountStore.setState({
      hostedAIEnabled: false,
      session: null,
    });
    useFlashBoardStore.setState({
      chatMessages: [{ id: 'old', role: 'assistant', text: 'Earlier visible answer.' }],
    });

    await runFlashBoardBridgeChatTurn({
      agentPath: 'direct-codex',
      conversationRef: 'direct-conversation-1',
      prompt: 'Refine the second step.',
      toolExecutionMode: 'normal',
    });

    expect(mocks.sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      agentPath: 'direct-codex',
      conversationRef: 'direct-conversation-1',
      hostedAvailable: false,
      prompt: 'Refine the second step.',
      toolExecutionMode: 'normal',
    }));
    expect(useFlashBoardStore.getState().chatMessages.slice(-2)).toEqual([
      expect.objectContaining({
        conversationRef: 'direct-conversation-1',
        role: 'user',
        text: 'Refine the second step.',
      }),
      expect.objectContaining({
        conversationRef: 'direct-conversation-1',
        role: 'assistant',
        text: 'Done.',
      }),
    ]);
  });
});
