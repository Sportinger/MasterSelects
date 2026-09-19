import { useCallback, useMemo } from 'react';
import {
  getVisibleSubLayoutId,
  isWorkspaceOverLayoutId,
  isProtectedFactoryDockLayout,
} from '../../../stores/dockStore';
import type { PanelType, SavedDockLayout } from '../../../types/dock';

interface UseToolbarViewActionsArgs {
  activeSavedLayoutId: string | null;
  activatePanelType: (type: PanelType) => void;
  defaultSavedLayoutId: string | null;
  hidePanelType: (type: PanelType) => void;
  isPanelTypeVisible: (type: PanelType) => boolean;
  loadSavedLayout: (layoutId: string) => void;
  overLayoutBaseId: string | null;
  resetLayout: () => void;
  saveCurrentNamedLayout: () => SavedDockLayout | null;
  saveLayoutAsDefault: () => void;
  saveNamedLayout: (name: string) => SavedDockLayout | null;
  savedLayouts: SavedDockLayout[];
  setDefaultSavedLayout: (layoutId: string | null) => void;
  toggleFavoriteSavedLayout: (layoutId: string) => void;
  closeMenu: () => void;
}

export function useToolbarViewActions({
  activeSavedLayoutId,
  activatePanelType,
  defaultSavedLayoutId,
  hidePanelType,
  isPanelTypeVisible,
  loadSavedLayout,
  overLayoutBaseId,
  resetLayout,
  saveCurrentNamedLayout,
  saveLayoutAsDefault,
  saveNamedLayout,
  savedLayouts,
  setDefaultSavedLayout,
  toggleFavoriteSavedLayout,
  closeMenu,
}: UseToolbarViewActionsArgs) {
  const visibleActiveSavedLayoutId = getVisibleSubLayoutId(
    activeSavedLayoutId,
    overLayoutBaseId,
  );
  const visibleDefaultSavedLayoutId = getVisibleSubLayoutId(defaultSavedLayoutId, null);
  const sortedSavedLayouts = useMemo(() => {
    return savedLayouts
      .filter((savedLayout) => !isWorkspaceOverLayoutId(savedLayout.id))
      .toSorted((left, right) => {
        const leftIsDefault = left.id === visibleDefaultSavedLayoutId;
        const rightIsDefault = right.id === visibleDefaultSavedLayoutId;
        if (leftIsDefault !== rightIsDefault) {
          return leftIsDefault ? -1 : 1;
        }
        return right.updatedAt - left.updatedAt;
      });
  }, [savedLayouts, visibleDefaultSavedLayoutId]);

  const favoriteSavedLayouts = useMemo(() => {
    return sortedSavedLayouts.filter((savedLayout) => savedLayout.favorite === true);
  }, [sortedSavedLayouts]);

  const activeSavedLayout = useMemo(() => {
    return savedLayouts.find(
      (savedLayout) => savedLayout.id === visibleActiveSavedLayoutId,
    ) ?? null;
  }, [savedLayouts, visibleActiveSavedLayoutId]);

  const activeSavedLayoutProtected = (
    isWorkspaceOverLayoutId(activeSavedLayoutId)
    || isProtectedFactoryDockLayout(activeSavedLayout)
  );

  const handleToggleViewPanelType = useCallback((type: PanelType) => {
    if (isPanelTypeVisible(type)) {
      hidePanelType(type);
      return;
    }

    activatePanelType(type);
  }, [activatePanelType, hidePanelType, isPanelTypeVisible]);

  const handleSaveNamedLayout = useCallback(() => {
    const name = window.prompt('Save current layout as:', 'New Layout');
    if (!name?.trim()) {
      return;
    }

    saveNamedLayout(name);
    closeMenu();
  }, [closeMenu, saveNamedLayout]);

  const handleSaveCurrentNamedLayout = useCallback(() => {
    if (activeSavedLayoutProtected) {
      return;
    }

    const savedLayout = saveCurrentNamedLayout();
    if (savedLayout) {
      closeMenu();
    }
  }, [activeSavedLayoutProtected, closeMenu, saveCurrentNamedLayout]);

  const handleLoadSavedLayout = useCallback((layoutId: string) => {
    loadSavedLayout(layoutId);
    closeMenu();
  }, [closeMenu, loadSavedLayout]);

  const handleSetDefaultSavedLayout = useCallback((layoutId: string) => {
    setDefaultSavedLayout(layoutId);
    closeMenu();
  }, [closeMenu, setDefaultSavedLayout]);

  const handleToggleFavoriteSavedLayout = useCallback((layoutId: string) => {
    toggleFavoriteSavedLayout(layoutId);
  }, [toggleFavoriteSavedLayout]);

  const handleSaveLayoutAsDefault = useCallback(() => {
    saveLayoutAsDefault();
    closeMenu();
  }, [closeMenu, saveLayoutAsDefault]);

  const handleResetLayout = useCallback(() => {
    resetLayout();
    closeMenu();
  }, [closeMenu, resetLayout]);

  return {
    activeSavedLayout,
    activeSavedLayoutProtected,
    favoriteSavedLayouts,
    handleLoadSavedLayout,
    handleResetLayout,
    handleSaveCurrentNamedLayout,
    handleSaveLayoutAsDefault,
    handleSaveNamedLayout,
    handleSetDefaultSavedLayout,
    handleToggleFavoriteSavedLayout,
    handleToggleViewPanelType,
    sortedSavedLayouts,
    visibleActiveSavedLayoutId,
    visibleDefaultSavedLayoutId,
  };
}
