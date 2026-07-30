import { describe, expect, it } from 'vitest';

import { clampReferenceMediaFileIds } from '../../src/components/panels/flashboard/FlashBoardReferenceMediaPlanner';

describe('FlashBoardReferenceMediaPlanner', () => {
  it('treats a zero reference limit as no reference inputs', () => {
    expect(clampReferenceMediaFileIds(['ref-1', 'ref-2'], 0)).toEqual([]);
  });

  it('keeps the existing unlimited behavior when no limit is configured', () => {
    expect(clampReferenceMediaFileIds(['ref-1', 'ref-2'], undefined)).toEqual(['ref-1', 'ref-2']);
  });
});
