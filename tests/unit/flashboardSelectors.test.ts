import { describe, expect, it } from 'vitest';
import { selectActiveBoardReferenceUsageByMediaFileId } from '../../src/stores/flashboardStore/selectors';
import type { FlashBoardStoreState } from '../../src/stores/flashboardStore/types';

function createState(): FlashBoardStoreState {
  return {
    activeGenerationRecords: [
      {
        id: 'gen-1',
        kind: 'generation',
        createdAt: 1,
        updatedAt: 1,
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
      {
        id: 'gen-2',
        kind: 'generation',
        createdAt: 1,
        updatedAt: 1,
        request: {
          service: 'kieai',
          providerId: 'kling-3.0',
          version: '3.0',
          prompt: 'Second active record',
          referenceMediaFileIds: ['frame-second-record'],
        },
      },
    ],
    selectedActiveGenerationRecordIds: [],
    composer: {
      isOpen: false,
      generateAudio: false,
      multiShots: false,
      multiPrompt: [],
      startMediaFileId: 'frame-start-2',
      endMediaFileId: 'frame-end-2',
      referenceMediaFileIds: ['frame-ref-1', 'frame-ref-2'],
    },
    hoveredComposerReference: null,
  };
}

describe('selectActiveBoardReferenceUsageByMediaFileId', () => {
  it('combines active generation record references with composer references', () => {
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

  it('includes references from every active generation record', () => {
    const usage = selectActiveBoardReferenceUsageByMediaFileId(createState());

    expect(usage['frame-second-record']).toEqual({
      start: false,
      end: false,
      reference: true,
    });
  });
});
