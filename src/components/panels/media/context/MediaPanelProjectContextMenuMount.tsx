import type { RefObject } from 'react';
import type { MediaFile, MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { getMediaContextActionState } from './contextActionState';
import { getMediaContextSelectedItemState } from './contextSelectedItemState';
import { MediaContextActionsMenu, type MediaContextActionsMenuProps } from './MediaContextActionsMenu';
import { MediaContextMenuFrame } from './MediaContextMenuFrame';
import type { MediaPanelViewMode } from '../panel/types';
import type { MediaPanelContextMenu } from './types';

type MediaPanelProjectContextActionKey =
  | 'showBoardAnnotationAction'
  | 'hasClipboard'
  | 'hasSelection'
  | 'multiSelect'
  | 'selectedCount'
  | 'selectedItem'
  | 'selectedIds'
  | 'availableFolders'
  | 'aiReferenceMediaFileIds'
  | 'allContextMediaReferenced'
  | 'composition'
  | 'solidItem'
  | 'mediaFile'
  | 'canRegenerateMediaArtifacts'
  | 'isVideoFile'
  | 'isImageFile'
  | 'isGenerating'
  | 'hasProxy'
  | 'hasAudio'
  | 'isAudioProxyGenerating'
  | 'hasAudioProxy'
  | 'isSourceAudioAnalysisGenerating'
  | 'hasSourceWaveform'
  | 'hasSourceSpectrogram'
  | 'proxyFolderName';

export type MediaPanelProjectContextMenuActions = Omit<
  MediaContextActionsMenuProps,
  MediaPanelProjectContextActionKey
>;

interface MediaPanelProjectContextMenuMountProps {
  contextMenu: MediaPanelContextMenu;
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  selectedIds: readonly string[];
  items: readonly ProjectItem[];
  files: readonly MediaFile[];
  folders: readonly MediaFolder[];
  composerReferenceMediaFileIds: readonly string[];
  viewMode: MediaPanelViewMode;
  proxyFolderName: string | null | undefined;
  hasClipboard: boolean;
  actions: MediaPanelProjectContextMenuActions;
}

export function MediaPanelProjectContextMenuMount({
  contextMenu,
  menuRef,
  x,
  y,
  selectedIds,
  items,
  files,
  folders,
  composerReferenceMediaFileIds,
  viewMode,
  proxyFolderName,
  hasClipboard,
  actions,
}: MediaPanelProjectContextMenuMountProps) {
  const multiSelect = selectedIds.length > 1;
  const {
    selectedItem,
    mediaFile,
    composition,
    solidItem,
  } = getMediaContextSelectedItemState({
    itemId: contextMenu.itemId,
    items,
  });
  const contextActionState = getMediaContextActionState({
    contextMenu,
    multiSelect,
    selectedIds,
    files,
    folders,
    composerReferenceMediaFileIds,
    mediaFile,
    viewMode,
  });

  return (
    <MediaContextMenuFrame menuRef={menuRef} x={x} y={y}>
      <MediaContextActionsMenu
        showBoardAnnotationAction={contextActionState.showBoardAnnotationAction}
        hasClipboard={hasClipboard}
        hasSelection={Boolean(contextMenu.itemId || multiSelect)}
        multiSelect={multiSelect}
        selectedCount={selectedIds.length}
        selectedItem={selectedItem}
        selectedIds={selectedIds}
        availableFolders={contextActionState.availableFolders}
        aiReferenceMediaFileIds={contextActionState.aiReferenceMediaFileIds}
        allContextMediaReferenced={contextActionState.allContextMediaReferenced}
        composition={composition}
        solidItem={solidItem}
        mediaFile={mediaFile}
        canRegenerateMediaArtifacts={contextActionState.canRegenerateMediaArtifacts}
        isVideoFile={contextActionState.isVideoFile}
        isImageFile={contextActionState.isImageFile}
        isGenerating={contextActionState.isGenerating}
        hasProxy={contextActionState.hasProxy}
        hasAudio={contextActionState.hasAudio}
        isAudioProxyGenerating={contextActionState.isAudioProxyGenerating}
        hasAudioProxy={contextActionState.hasAudioProxy}
        isSourceAudioAnalysisGenerating={contextActionState.isSourceAudioAnalysisGenerating}
        hasSourceWaveform={contextActionState.hasSourceWaveform}
        hasSourceSpectrogram={contextActionState.hasSourceSpectrogram}
        proxyFolderName={proxyFolderName}
        {...actions}
      />
    </MediaContextMenuFrame>
  );
}
