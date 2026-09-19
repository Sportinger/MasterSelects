import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendPromptHistory: vi.fn(),
  readMediaStore: vi.fn(() => ({ activeCompositionId: 'comp-chat-review', files: [] })),
  runChatTurn: vi.fn().mockResolvedValue({ response: 'Done.' }),
}));

vi.mock('../../src/stores/flashboardStore/activeGenerationRecords', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/stores/flashboardStore/activeGenerationRecords')>(),
  appendFlashBoardPromptHistoryEntry: mocks.appendPromptHistory,
}));

vi.mock('../../src/services/flashboard/FlashBoardChatBridgeRunner', () => ({
  runFlashBoardBridgeChatTurn: mocks.runChatTurn,
}));

vi.mock('../../src/services/seedancePreproduction/storeRuntime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/seedancePreproduction/storeRuntime')>(),
  readSeedanceMediaStore: mocks.readMediaStore,
}));

import { runLandingBackgroundCreation } from '../../src/marketing/runLandingBackgroundCreation';
import { useTimelineStore } from '../../src/stores/timeline';

describe('Start layout Fast routing', () => {
  beforeEach(() => {
    mocks.appendPromptHistory.mockClear();
    mocks.runChatTurn.mockReset().mockResolvedValue({ response: 'Done.' });
    useTimelineStore.setState({ clips: [] });
  });

  it('keeps every regular Start chat turn on the standard Fast agent', async () => {
    await runLandingBackgroundCreation(
      'Build a coherent short edit',
      undefined,
      { resumeFrom: 'editing' },
    );

    expect(mocks.runChatTurn).toHaveBeenCalledOnce();
    expect(mocks.runChatTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Build a coherent short edit',
      runSource: 'ui',
      toolExecutionMode: 'normal',
    }));
    expect(mocks.runChatTurn.mock.calls[0]?.[0]).not.toHaveProperty('requestedAgentMode');
  });

  it('keeps detailed progress visible when a later provider phase arrives', async () => {
    const statuses: Array<{ label: string; steps?: string[] }> = [];
    mocks.runChatTurn.mockImplementationOnce(async (request) => {
      request.onPhase?.('kernel');
      request.onKernelProgress?.({
        detail: '3 timeline clips',
        label: 'Reading timeline',
        stage: 'reading-timeline',
      });
      request.onPhase?.('provider');
      return { response: 'Done.' };
    });

    await runLandingBackgroundCreation(
      'Build a coherent short edit',
      (status) => statuses.push(status),
      { resumeFrom: 'editing' },
    );

    expect(statuses.map((status) => status.label)).toEqual([
      'Starting AI…',
      'Reading project…',
      'Reading timeline…',
      'Done',
    ]);
    expect(statuses[2]?.steps).toEqual([
      'Starting AI',
      'Reading project',
      'Reading timeline',
    ]);
  });

  it('pauses a normal landing edit for review before entering the render phase', async () => {
    const statuses: string[] = [];
    const onReviewCompositionChange = vi.fn();
    const reviewCompositionId = 'comp-chat-review';

    const result = await runLandingBackgroundCreation(
      'Build a coherent short edit',
      (status) => statuses.push(status.label),
      {
        onReviewCompositionChange,
        pauseBeforeRender: true,
        resumeFrom: 'editing',
      },
    );

    expect(result).toEqual({
      readyForReview: true,
      reviewCompositionId,
      response: 'Done.',
    });
    expect(onReviewCompositionChange).toHaveBeenCalledWith(reviewCompositionId);
    expect(statuses).toEqual([
      'Starting AI…',
      'Edit ready for review',
    ]);
  });
});
