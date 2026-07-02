import { describe, expect, it } from 'vitest';

import { buildFlashBoardReferenceRolePatch } from '../../src/components/panels/flashboard/FlashBoardReferenceAssignmentPlanner';

describe('FlashBoard reference assignment planner', () => {
  it('assigns a dropped image to the start frame instead of leaving it as a regular reference', () => {
    expect(buildFlashBoardReferenceRolePatch({
      composer: {
        referenceMediaFileIds: ['image-1', 'ref-1'],
      },
      effectiveReferenceMediaFileIds: ['image-1', 'ref-1'],
      maxReferenceMedia: 3,
      mediaFileId: 'image-1',
      role: 'start',
    })).toEqual({
      referenceMediaFileIds: ['ref-1'],
      startMediaFileId: 'image-1',
    });
  });

  it('moves the previous start frame back to regular references when replacing it', () => {
    expect(buildFlashBoardReferenceRolePatch({
      composer: {
        referenceMediaFileIds: ['ref-1'],
        startMediaFileId: 'old-start',
      },
      effectiveReferenceMediaFileIds: ['ref-1'],
      maxReferenceMedia: 3,
      mediaFileId: 'new-start',
      role: 'start',
    })).toEqual({
      referenceMediaFileIds: ['ref-1', 'old-start'],
      startMediaFileId: 'new-start',
    });
  });

  it('clears the start frame when the same media is moved back to regular references', () => {
    expect(buildFlashBoardReferenceRolePatch({
      composer: {
        referenceMediaFileIds: [],
        startMediaFileId: 'image-1',
      },
      effectiveReferenceMediaFileIds: [],
      maxReferenceMedia: 3,
      mediaFileId: 'image-1',
      role: 'reference',
    })).toEqual({
      referenceMediaFileIds: ['image-1'],
      startMediaFileId: undefined,
    });
  });
});
