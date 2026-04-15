import { describe, expect, it } from 'vitest';
import { selectActiveBoardReferenceUsageByMediaFileId } from '../../src/stores/flashboardStore/selectors';
import type { FlashBoardStoreState } from '../../src/stores/flashboardStore/types';

function createState(): FlashBoardStoreState {
  return {
    activeBoardId: 'board-1',
    boards: [
      {
        id: 'board-1',
        name: 'Board 1',
        createdAt: 1,
        updatedAt: 1,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        nodes: [
          {
            id: 'gen-1',
            kind: 'generation',
            createdAt: 1,
            updatedAt: 1,
            position: { x: 0, y: 0 },
            size: { width: 280, height: 157.5 },
            request: {
              service: 'kieai',
              providerId: 'kling-3.0',
              version: '3.0',
              prompt: 'Prompt',
              referenceMediaFileIds: ['frame-ref-1'],
              startMediaFileId: 'frame-start-1',
              endMediaFileId: 'frame-end-1',
            },
          },
        ],
      },
      {
        id: 'board-2',
        name: 'Board 2',
        createdAt: 1,
        updatedAt: 1,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        nodes: [
          {
            id: 'gen-2',
            kind: 'generation',
            createdAt: 1,
            updatedAt: 1,
            position: { x: 0, y: 0 },
            size: { width: 280, height: 157.5 },
            request: {
              service: 'kieai',
              providerId: 'kling-3.0',
              version: '3.0',
              prompt: 'Other board',
              referenceMediaFileIds: ['frame-other-board'],
            },
          },
        ],
      },
    ],
    selectedNodeIds: [],
    viewMode: 'board',
    composer: {
      draftNodeId: null,
      isOpen: false,
      generateAudio: false,
      multiShots: false,
      multiPrompt: [],
      startMediaFileId: 'frame-start-2',
      endMediaFileId: 'frame-end-2',
      referenceMediaFileIds: ['frame-ref-1', 'frame-ref-2'],
    },
  };
}

describe('selectActiveBoardReferenceUsageByMediaFileId', () => {
  it('combines active board references with composer references', () => {
    const state = createState();
    const usage = selectActiveBoardReferenceUsageByMediaFileId(state);
    const cachedUsage = selectActiveBoardReferenceUsageByMediaFileId(state);

    expect(usage['frame-start-1']).toEqual({
      start: true,
      end: false,
      reference: false,
    });
    expect(usage['frame-end-1']).toEqual({
      start: false,
      end: true,
      reference: false,
    });
    expect(usage['frame-start-2']).toEqual({
      start: true,
      end: false,
      reference: false,
    });
    expect(usage['frame-end-2']).toEqual({
      start: false,
      end: true,
      reference: false,
    });
    expect(usage['frame-ref-1']).toEqual({
      start: false,
      end: false,
      reference: true,
    });
    expect(usage['frame-ref-2']).toEqual({
      start: false,
      end: false,
      reference: true,
    });
    expect(cachedUsage).toBe(usage);
  });

  it('ignores generation references from inactive boards', () => {
    const usage = selectActiveBoardReferenceUsageByMediaFileId(createState());

    expect(usage['frame-other-board']).toBeUndefined();
  });
});
