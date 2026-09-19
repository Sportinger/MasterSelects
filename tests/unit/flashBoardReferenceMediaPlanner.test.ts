import { describe, expect, it } from 'vitest';

import {
  clampReferenceMediaFileIds,
  reorderReferenceMediaFileIds,
} from '../../src/components/panels/flashboard/FlashBoardReferenceMediaPlanner';

describe('FlashBoardReferenceMediaPlanner', () => {
  it('treats a zero reference limit as no reference inputs', () => {
    expect(clampReferenceMediaFileIds(['ref-1', 'ref-2'], 0)).toEqual([]);
  });

  it('keeps the existing unlimited behavior when no limit is configured', () => {
    expect(clampReferenceMediaFileIds(['ref-1', 'ref-2'], undefined)).toEqual(['ref-1', 'ref-2']);
  });

  it('moves a dragged reference to the target position in either direction', () => {
    expect(reorderReferenceMediaFileIds(['one', 'two', 'three'], 'one', 'three'))
      .toEqual(['two', 'three', 'one']);
    expect(reorderReferenceMediaFileIds(['one', 'two', 'three'], 'three', 'one'))
      .toEqual(['three', 'one', 'two']);
  });

  it('preserves the current array for invalid reorder requests', () => {
    const currentIds = ['one', 'two'];
    expect(reorderReferenceMediaFileIds(currentIds, 'one', 'one')).toBe(currentIds);
    expect(reorderReferenceMediaFileIds(currentIds, 'missing', 'two')).toBe(currentIds);
  });
});
