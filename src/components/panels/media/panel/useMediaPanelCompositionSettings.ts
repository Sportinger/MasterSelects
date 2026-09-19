import { useCallback, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useSettingsStore } from '../../../../stores/settingsStore';
import type { Composition, useMediaStore } from '../../../../stores/mediaStore';
import type { CompositionSettingsValues } from '../CompositionSettingsDialog';
import { requestMediaBoardPlacement } from '../board/placementRequests';
import { requestMediaSourceReveal } from '../../../../services/mediaSourceReveal';
import type { MediaPanelCompositionSettingsDialogState } from './MediaPanelOverlayMounts';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

export interface NewCompositionSettingsRequest {
  name: string;
  parentId: string | null;
  boardPosition?: { x: number; y: number };
}

interface UseMediaPanelCompositionSettingsInput {
  activeCompositionId: string | null;
  closeContextMenu: () => void;
  createComposition: MediaStoreState['createComposition'];
  openCompositionTab: MediaStoreState['openCompositionTab'];
  updateComposition: (id: string, updates: Partial<Composition>) => void;
}

function compositionSettingsFromComposition(comp: Composition): CompositionSettingsValues {
  return {
    name: comp.name,
    width: comp.width,
    height: comp.height,
    frameRate: comp.frameRate,
    duration: comp.duration,
  };
}

export function useMediaPanelCompositionSettings({
  activeCompositionId,
  closeContextMenu,
  createComposition,
  openCompositionTab,
  updateComposition,
}: UseMediaPanelCompositionSettingsInput) {
  const [settingsDialog, setSettingsDialog] = useState<MediaPanelCompositionSettingsDialogState | null>(null);
  const outputResolution = useSettingsStore((state) => state.outputResolution);
  const setTimelineDuration = useTimelineStore((state) => state.setDuration);

  const applySettingsToComposition = useCallback((
    compositionId: string,
    settings: CompositionSettingsValues,
  ) => {
    updateComposition(compositionId, {
      name: settings.name.trim(),
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      duration: settings.duration,
    });
    if (compositionId === activeCompositionId) {
      setTimelineDuration(settings.duration);
    }
  }, [activeCompositionId, setTimelineDuration, updateComposition]);

  const openCompositionSettings = useCallback((comp: Composition) => {
    const originalSettings = compositionSettingsFromComposition(comp);
    setSettingsDialog({
      kind: 'edit',
      compositionId: comp.id,
      originalSettings,
      ...originalSettings,
    });
    closeContextMenu();
    void openCompositionTab(comp.id);
  }, [closeContextMenu, openCompositionTab]);

  const openNewCompositionSettings = useCallback((request: NewCompositionSettingsRequest) => {
    setSettingsDialog({
      kind: 'create',
      parentId: request.parentId,
      boardPosition: request.boardPosition,
      name: request.name,
      width: outputResolution.width,
      height: outputResolution.height,
      frameRate: 30,
      duration: 60,
    });
    closeContextMenu();
  }, [closeContextMenu, outputResolution]);

  const changeCompositionSettings = useCallback((settings: CompositionSettingsValues) => {
    const current = settingsDialog;
    if (!current) return;
    const next = { ...current, ...settings } as MediaPanelCompositionSettingsDialogState;
    setSettingsDialog(next);
    if (next.kind === 'edit') {
      applySettingsToComposition(next.compositionId, next);
    }
  }, [applySettingsToComposition, settingsDialog]);

  const saveCompositionSettings = useCallback(() => {
    if (!settingsDialog || !settingsDialog.name.trim()) return;
    if (settingsDialog.kind === 'create') {
      const composition = createComposition(settingsDialog.name.trim(), {
        parentId: settingsDialog.parentId,
        width: settingsDialog.width,
        height: settingsDialog.height,
        frameRate: settingsDialog.frameRate,
        duration: settingsDialog.duration,
      });
      if (settingsDialog.boardPosition) {
        requestMediaBoardPlacement({
          itemIds: [composition.id],
          point: settingsDialog.boardPosition,
        });
      }
      void openCompositionTab(composition.id);
      requestMediaSourceReveal(composition.id, 'media-panel');
    } else {
      applySettingsToComposition(settingsDialog.compositionId, settingsDialog);
    }
    setSettingsDialog(null);
  }, [applySettingsToComposition, createComposition, openCompositionTab, settingsDialog]);

  const cancelCompositionSettings = useCallback(() => {
    if (settingsDialog?.kind === 'edit') {
      applySettingsToComposition(settingsDialog.compositionId, settingsDialog.originalSettings);
    }
    setSettingsDialog(null);
  }, [applySettingsToComposition, settingsDialog]);

  return {
    settingsDialog,
    changeCompositionSettings,
    openCompositionSettings,
    openNewCompositionSettings,
    saveCompositionSettings,
    cancelCompositionSettings,
  };
}
