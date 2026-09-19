import { describe, expect, it } from 'vitest';

import { resolveTimelineTrackHeaderWidth } from '../../src/components/timeline/hooks/useTimelineRootStoreState';
import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from '../../src/stores/dockStore';

describe('mobile timeline layout', () => {
  it.each([
    FACTORY_MOBILE_LAYOUT_ID,
    FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  ])('uses a compact 76px name rail in %s', (layoutId) => {
    expect(resolveTimelineTrackHeaderWidth(210, layoutId)).toBe(76);
  });

  it('preserves the configured layer rail width outside mobile layouts', () => {
    expect(resolveTimelineTrackHeaderWidth(236, FACTORY_VIDEO_EDIT_LAYOUT_ID)).toBe(236);
  });
});
