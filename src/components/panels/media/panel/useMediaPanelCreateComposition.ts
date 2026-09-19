import { useCallback } from 'react';
import type { Composition, MediaFile, useMediaStore } from '../../../../stores/mediaStore';
import { DEFAULT_COMPOSITION } from '../../../../stores/mediaStore/constants';
import { DEFAULT_TRACKS, useTimelineStore } from '../../../../stores/timeline';
import { requestMediaSourceReveal } from '../../../../services/mediaSourceReveal';
import { placeLiveInputOnTimeline } from '../../../../services/mediaRuntime/liveInputTimelineAdapter';
import { requestMediaBoardPlacement } from '../board/placementRequests';
import type { MediaPanelContextMenu } from '../context/types';

type MediaState = ReturnType<typeof useMediaStore.getState>;
interface CreateCompositionOptions {
  contextMenu: MediaPanelContextMenu | null;
  createComposition: MediaState['createComposition'];
  updateComposition: MediaState['updateComposition'];
  openCompositionTab: MediaState['openCompositionTab'];
  getActiveParentId: () => string | null;
  showFloatingText: (text: string) => void;
  closeContextMenu: () => void;
}

function cleanCompositionBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName;
}

export function getMediaCompositionSettings(mediaFile: MediaFile): {
  duration: number;
  frameRate: number;
  height: number;
  width: number;
} {
  return {
    duration: Math.max(1, mediaFile.duration ?? 5),
    frameRate: Math.max(1, Math.round(mediaFile.fps ?? DEFAULT_COMPOSITION.frameRate)),
    height: Math.max(1, Math.round(mediaFile.height ?? DEFAULT_COMPOSITION.height)),
    width: Math.max(1, Math.round(mediaFile.width ?? DEFAULT_COMPOSITION.width)),
  };
}

export function useMediaPanelCreateComposition({
  contextMenu, createComposition, updateComposition, openCompositionTab,
  getActiveParentId, showFloatingText, closeContextMenu,
}: CreateCompositionOptions) {
  const addTimelineClip = useTimelineStore((state) => state.addClip);
  const addTimelineCompClip = useTimelineStore((state) => state.addCompClip);
  const setTimelineDuration = useTimelineStore((state) => state.setDuration);
  const getSerializableTimelineState = useTimelineStore((state) => state.getSerializableState);
  return useCallback(async (item: MediaFile | Composition) => {
    const isNestedComposition = item.type === 'composition';
    const mediaItem = isNestedComposition ? null : item;
    const mediaSourceFile = mediaItem?.file;
    const isSupportedLiveInput = Boolean(
      mediaItem?.liveInput && mediaItem.liveInput.kind !== 'composition-feedback',
    );
    if (
      !isNestedComposition
      && !isSupportedLiveInput
      && (!mediaSourceFile || (mediaItem?.type !== 'video' && mediaItem?.type !== 'image'))
    ) return;

    const settings = isNestedComposition
      ? {
          duration: Math.max(0.001, item.timelineData?.duration ?? item.duration),
          frameRate: item.frameRate,
          height: item.height,
          width: item.width,
        }
      : getMediaCompositionSettings(mediaItem!);
    const composition = createComposition(`${cleanCompositionBaseName(item.name)} Comp`, {
      ...settings,
      backgroundColor: isNestedComposition ? item.backgroundColor : undefined,
      parentId: getActiveParentId(),
    });
    if (contextMenu?.boardPosition) {
      requestMediaBoardPlacement({ itemIds: [composition.id], point: contextMenu.boardPosition });
    }

    await openCompositionTab(composition.id, { skipAnimation: true });

    const tracks = composition.timelineData?.tracks ?? DEFAULT_TRACKS;
    const trackId = tracks.find((track) => track.type === 'video' && !track.locked)?.id;
    if (!trackId) return;

    if (isNestedComposition) {
      await addTimelineCompClip(trackId, item, 0);
    } else if (isSupportedLiveInput && mediaItem) {
      const clipId = placeLiveInputOnTimeline({
        item: mediaItem,
        trackId,
        startTime: 0,
        duration: settings.duration,
      });
      if (!clipId) return;
    } else {
      if (!mediaSourceFile) return;
      await addTimelineClip(trackId, mediaSourceFile, 0, settings.duration, mediaItem!.id, mediaItem!.type);
    }
    setTimelineDuration(settings.duration);
    updateComposition(composition.id, {
      duration: settings.duration,
      timelineData: getSerializableTimelineState(),
    });
    requestMediaSourceReveal(composition.id, 'media-panel');
    showFloatingText('Comp created');
    closeContextMenu();
  }, [
    addTimelineClip,
    addTimelineCompClip,
    closeContextMenu,
    contextMenu,
    createComposition,
    getActiveParentId,
    getSerializableTimelineState,
    openCompositionTab,
    setTimelineDuration,
    showFloatingText,
    updateComposition,
  ]);

}
