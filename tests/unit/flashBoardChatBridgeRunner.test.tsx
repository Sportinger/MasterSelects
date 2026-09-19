import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashBoardPromptBook } from '../../src/components/panels/flashboard/FlashBoardPromptBook';
import { runFlashBoardBridgeChatTurn } from '../../src/services/flashboard/FlashBoardChatBridgeRunner';
import type { FlashBoardChatRunRecord } from '../../src/services/flashboard/FlashBoardChatRunAudit';
import type { FlashBoardChatRequest, FlashBoardExecutedToolCall } from '../../src/services/flashboard/FlashBoardChatTypes';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { useMediaStore } from '../../src/stores/mediaStore';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../src/services/flashboard/FlashBoardChatService', () => ({
  sendFlashBoardChatMessage: mocks.send,
}));
vi.mock('../../src/services/flashboard/FlashBoardChatVisualReferences', () => ({
  prepareFlashBoardChatVisualReferences: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/stores/accountStore', () => ({
  hasHostedAiSession: () => true,
  useAccountStore: {
    getState: () => ({ session: {}, hostedAIEnabled: true }),
    subscribe: () => () => {},
  },
}));

const completedRun: FlashBoardChatRunRecord = {
  appVersion: 'test', executedToolCallCount: 2, hostedAvailable: true,
  model: 'test', projectId: null, projectName: 'Test', promptVersion: 'v2',
  provider: 'kie', runId: 'test-run', sessionId: null, source: 'test',
  startedAt: 1, status: 'succeeded', temperature: 0, toolExecutionMode: 'read-only',
};
const firstCall: FlashBoardExecutedToolCall = {
  toolCall: { id: 'call-1', name: 'getTimelineState', arguments: '{}' },
  result: { success: true, data: { clips: [] } }, modelContent: '{}',
};
const secondCall: FlashBoardExecutedToolCall = {
  toolCall: { id: 'call-2', name: 'getClipDetails', arguments: '{"clipId":"missing"}' },
  result: { success: false, error: 'Clip not found.' }, modelContent: '{}',
};

function LivePromptBook() {
  const chatMessages = useFlashBoardStore(state => state.chatMessages);
  return <FlashBoardPromptBook chatMessages={chatMessages} entries={[]} generationRecords={[]}
    mediaFiles={[]} initialKind="chat" copiedEntryId={null} onClose={vi.fn()} onCopy={vi.fn()} />;
}

describe('bridge chat live tool history', () => {
  beforeEach(() => {
    mocks.send.mockReset();
    useFlashBoardStore.getState().setChatMessages([]);
    vi.mocked(useMediaStore).mockImplementation(selector => selector({
      files: [], setSourceMonitorFile: vi.fn(),
    } as unknown as ReturnType<typeof useMediaStore.getState>));
    vi.mocked(useMediaStore.getState).mockReturnValue({ files: [] } as unknown as ReturnType<typeof useMediaStore.getState>);
  });

  it('shows each result in an already-open Prompt Book while the turn is still pending', async () => {
    let request: FlashBoardChatRequest | undefined;
    let finish!: (value: string) => void;
    mocks.send.mockImplementation((input: FlashBoardChatRequest) => {
      request = input;
      return new Promise<string>(resolve => { finish = resolve; });
    });
    render(<LivePromptBook />);
    let turn!: ReturnType<typeof runFlashBoardBridgeChatTurn>;
    act(() => { turn = runFlashBoardBridgeChatTurn({ prompt: 'Inspect only.', includeHistory: false }); });
    await waitFor(() => expect(request).toBeDefined());

    act(() => request!.onExecutedToolCalls?.([firstCall]));
    expect(screen.getByText('getTimelineState done')).toBeInTheDocument();
    const firstSnapshot = useFlashBoardStore.getState().chatMessages.at(-1)!;
    expect(firstSnapshot.isPending).toBe(true);
    expect(firstSnapshot.toolCalls).toEqual([firstCall]);

    act(() => request!.onExecutedToolCalls?.([secondCall]));
    expect(screen.getByText('getClipDetails failed')).toBeInTheDocument();
    expect(screen.getByText(/Clip not found/)).toBeInTheDocument();
    expect(useFlashBoardStore.getState().chatMessages.at(-1)?.isPending).toBe(true);
    expect(firstSnapshot.toolCalls).toEqual([firstCall]);

    await act(async () => {
      request!.onRunCompleted?.(completedRun);
      finish('Inspection complete.');
      await turn;
    });
    expect(useFlashBoardStore.getState().chatMessages.at(-1)).toMatchObject({
      isPending: false, text: 'Inspection complete.', toolCalls: [firstCall, secondCall],
    });
    expect(screen.getAllByText('getTimelineState done')).toHaveLength(1);
  });

  it('keeps non-persisted diagnostic turns out of visible chat while forwarding tool callbacks', async () => {
    const observed = vi.fn();
    mocks.send.mockImplementation(async (request: FlashBoardChatRequest) => {
      request.onExecutedToolCalls?.([firstCall]);
      request.onRunCompleted?.(completedRun);
      return 'Done.';
    });
    const result = await runFlashBoardBridgeChatTurn({
      prompt: 'Inspect.', persistToChat: false, onExecutedToolCalls: observed,
    });
    expect(observed).toHaveBeenCalledWith([firstCall]);
    expect(result.toolCalls).toEqual([firstCall]);
    expect(useFlashBoardStore.getState().chatMessages).toEqual([]);
  });

  it('retains completed tool results when the rest of the turn fails', async () => {
    mocks.send.mockImplementation(async (request: FlashBoardChatRequest) => {
      request.onExecutedToolCalls?.([firstCall]);
      throw new Error('Provider disconnected.');
    });
    await expect(runFlashBoardBridgeChatTurn({ prompt: 'Inspect.' })).rejects.toThrow('Provider disconnected.');
    expect(useFlashBoardStore.getState().chatMessages.at(-1)).toMatchObject({
      isPending: false, isError: true, toolCalls: [firstCall], text: 'Provider disconnected.',
    });
  });
});
