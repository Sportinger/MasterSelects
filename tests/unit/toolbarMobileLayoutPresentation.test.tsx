import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useToolbarViewActions } from '../../src/components/common/toolbar/useToolbarViewActions';
import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
} from '../../src/stores/dockStore';

describe('toolbar Mobile layout presentation', () => {
  it('shows the base workspace while Mobile is active as a global mode', () => {
    const savedLayouts = getFactoryDockLayouts();
    const { result } = renderHook(() => useToolbarViewActions({
      activeSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
      activatePanelType: vi.fn(),
      closeMenu: vi.fn(),
      defaultSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
      hidePanelType: vi.fn(),
      isPanelTypeVisible: vi.fn(() => false),
      loadSavedLayout: vi.fn(),
      overLayoutBaseId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      resetLayout: vi.fn(),
      saveCurrentNamedLayout: vi.fn(() => null),
      saveLayoutAsDefault: vi.fn(),
      saveNamedLayout: vi.fn(() => null),
      savedLayouts,
      setDefaultSavedLayout: vi.fn(),
      toggleFavoriteSavedLayout: vi.fn(),
    }));

    expect(result.current.visibleActiveSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(result.current.visibleDefaultSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(result.current.activeSavedLayout?.name).toBe('Video');
    expect(result.current.activeSavedLayoutProtected).toBe(true);
    expect(result.current.sortedSavedLayouts).not.toContainEqual(
      expect.objectContaining({
        id: expect.stringMatching(`${FACTORY_MOBILE_LAYOUT_ID}|${FACTORY_VERTICAL_MOBILE_LAYOUT_ID}`),
      }),
    );
    expect(result.current.favoriteSavedLayouts).not.toContainEqual(
      expect.objectContaining({ id: FACTORY_MOBILE_LAYOUT_ID }),
    );
    expect(result.current.sortedSavedLayouts).not.toContainEqual(
      expect.objectContaining({ id: FACTORY_MEDIUM_EDIT_LAYOUT_ID }),
    );
  });
});
