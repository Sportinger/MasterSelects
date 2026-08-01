import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountStore } from '../../src/stores/accountStore';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mocks = vi.hoisted(() => ({
  prepareFlashBoardChatVisualReferences: vi.fn(),
  sendFlashBoardChatMessage: vi.fn(),
}));

vi.mock('../../src/services/flashboard/FlashBoardChatService', () => ({
  sendFlashBoardChatMessage: mocks.sendFlashBoardChatMessage,
}));

vi.mock('../../src/services/flashboard/FlashBoardChatVisualReferences', () => ({
  prepareFlashBoardChatVisualReferences: mocks.prepareFlashBoardChatVisualReferences,
}));

import { runFlashBoardBridgeChatTurn } from '../../src/services/flashboard/FlashBoardChatBridgeRunner';

describe('FlashBoard bridge narrated activity', () => {
  beforeEach(() => {
    mocks.sendFlashBoardChatMessage.mockReset();
    mocks.prepareFlashBoardChatVisualReferences.mockReset();
    mocks.prepareFlashBoardChatVisualReferences.mockResolvedValue([]);
    useFlashBoardStore.setState({ chatMessages: [] });
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      aiProvider: 'lemonade',
      apiKeysUnlocked: false,
      aiSystemPromptOverrides: {},
      aiSystemPromptSendContext: {},
      lemonadeContextSize: 16_384,
      lemonadeEndpoint: 'http://localhost:13305/api/v1',
      lemonadeModel: 'local-test-model',
    } as ReturnType<typeof useSettingsStore.getState>);
  });

  it('updates the persisted pending bubble before the bridge turn completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onActivityEvent = vi.fn();

    mocks.sendFlashBoardChatMessage.mockImplementation(async (request) => {
      request.onActivityEvent?.({
        id: 'narration-1',
        runId: 'run-1',
        kind: 'narration',
        source: 'model',
        phase: 'inspecting',
        roundIndex: 0,
        text: 'I am reading the timeline.',
        createdAt: 1,
      });
      request.onKernelProgress?.({
        stage: 'reading-timeline',
        label: 'Reading timeline',
        current: 1,
        total: 2,
      });
      await gate;
      request.onRunCompleted?.({
        promptVersion: 'v2',
      });
      return 'Finished.';
    });

    const turn = runFlashBoardBridgeChatTurn({
      includeHistory: false,
      model: 'local-test-model',
      onActivityEvent,
      persistToChat: true,
      prompt: 'Inspect the edit',
      provider: 'lemonade',
    });

    await vi.waitFor(() => {
      const pending = useFlashBoardStore.getState().chatMessages.at(-1);
      expect(pending?.isPending).toBe(true);
      expect(pending?.activityEvents?.map((event) => event.kind))
        .toEqual(['narration', 'progress']);
      expect(pending?.kernelProgress?.label).toBe('Reading timeline');
    });
    expect(onActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'narration-1',
    }));

    release();
    await expect(turn).resolves.toMatchObject({ response: 'Finished.' });
    const completed = useFlashBoardStore.getState().chatMessages.at(-1);
    expect(completed).toMatchObject({
      isPending: false,
      text: 'Finished.',
    });
    expect(completed?.activityEvents).toHaveLength(2);
  });

  it('attaches requested media-panel images to a hosted bridge turn', async () => {
    useAccountStore.setState({
      hostedAIEnabled: true,
      session: { authenticated: true, provider: 'magic_link' },
    });
    mocks.prepareFlashBoardChatVisualReferences.mockResolvedValue([{
      dataUrl: 'data:image/png;base64,AAAA',
      id: 'reference-image',
      mediaType: 'image/png',
    }]);
    mocks.sendFlashBoardChatMessage.mockImplementation(async (request) => {
      request.onRunCompleted?.({ promptVersion: 'v2' });
      return 'Finished.';
    });

    await runFlashBoardBridgeChatTurn({
      includeHistory: false,
      model: 'gpt-5-6-terra',
      persistToChat: true,
      prompt: 'Rebuild REF 1 as editable layers.',
      provider: 'kie',
      referenceMediaFileIds: ['reference-image'],
    });

    expect(mocks.prepareFlashBoardChatVisualReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        composer: expect.objectContaining({
          referenceMediaFileIds: ['reference-image'],
        }),
      }),
    );
    expect(mocks.sendFlashBoardChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        visualReferences: [expect.objectContaining({ id: 'reference-image' })],
      }),
    );
  });
});
