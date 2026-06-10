import { useCallback, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import type { Composition } from '../../../../stores/mediaStore';
import type { MediaPanelCompositionSettingsDialogState } from './MediaPanelOverlayMounts';

interface UseMediaPanelCompositionSettingsInput {
  activeCompositionId: string | null;
  closeContextMenu: () => void;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
}

export function useMediaPanelCompositionSettings({
  activeCompositionId,
  closeContextMenu,
  updateComposition,
}: UseMediaPanelCompositionSettingsInput) {
  const [settingsDialog, setSettingsDialog] = useState<MediaPanelCompositionSettingsDialogState | null>(null);

  const openCompositionSettings = useCallback((comp: Composition) => {
    setSettingsDialog({
      compositionId: comp.id,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
    });
    closeContextMenu();
  }, [closeContextMenu]);

  const saveCompositionSettings = useCallback(() => {
    if (!settingsDialog) return;
    updateComposition(settingsDialog.compositionId, {
      width: settingsDialog.width,
      height: settingsDialog.height,
      frameRate: settingsDialog.frameRate,
      duration: settingsDialog.duration,
    });
    if (settingsDialog.compositionId === activeCompositionId) {
      useTimelineStore.getState().setDuration(settingsDialog.duration);
    }
    setSettingsDialog(null);
  }, [settingsDialog, updateComposition, activeCompositionId]);

  return {
    settingsDialog,
    setSettingsDialog,
    openCompositionSettings,
    saveCompositionSettings,
  };
}
