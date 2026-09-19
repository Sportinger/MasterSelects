import type { Dispatch, RefObject, SetStateAction } from 'react';
import { RelinkDialog } from '../../../common/RelinkDialog';
import type { LabelColor } from '../../../../stores/mediaStore/types';
import type { MediaFile, MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { CompositionSettingsDialog } from '../CompositionSettingsDialog';
import type { CompositionSettingsValues } from '../CompositionSettingsDialog';
import { SolidSettingsDialog } from '../SolidSettingsDialog';
import { LabelColorPicker } from '../LabelColorPicker';
import {
  MEDIA_BOARD_ANNOTATION_COLOR_OPTIONS,
  type MediaBoardAnnotation,
} from '../board/annotations';
import type { MediaBoardAnnotationPatch } from '../board/useMediaBoardAnnotationState';
import { renderMediaAnnotationContextMenuMount } from '../context/MediaAnnotationContextMenuMount';
import {
  MediaPanelProjectContextMenuMount,
  type MediaPanelProjectContextMenuActions,
} from '../context/MediaPanelProjectContextMenuMount';
import type { MediaPanelContextMenu } from '../context/types';
import { MediaDeleteConfirmationDialog } from './MediaDeleteConfirmationDialog';
import { MediaDropOverlay } from './MediaDropOverlay';
import {
  MediaFloatingFeedbackPortal,
  type MediaFloatingFeedbackItem,
} from './MediaFloatingFeedbackPortal';
import { MediaGenerationTrayMount } from './MediaGenerationTrayMount';
import type { MediaDeleteConfirmationRequest } from './useMediaPanelRenameDeleteCommands';
import type { MediaPanelViewMode } from './types';

export type MediaPanelCompositionSettingsDialogState = CompositionSettingsValues & (
  | {
      kind: 'edit';
      compositionId: string;
      originalSettings: CompositionSettingsValues;
    }
  | {
      kind: 'create';
      parentId: string | null;
      boardPosition?: { x: number; y: number };
    }
);

interface MediaPanelOverlayMountsProps {
  floatingTexts: readonly MediaFloatingFeedbackItem[];
  isMediaBoardDeepZoomActive: boolean;
  isGenerativeTrayExpanded: boolean;
  setGenerativeTrayExpanded: (expanded: boolean) => void;
  isExternalDragOver: boolean;
  contextMenu: MediaPanelContextMenu | null;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  contextMenuPosition: { x: number; y: number } | null;
  mediaBoardAnnotations: readonly MediaBoardAnnotation[];
  updateMediaBoardAnnotation: (id: string, patch: MediaBoardAnnotationPatch) => void;
  closeContextMenu: () => void;
  selectedIds: string[];
  allProjectItems: readonly ProjectItem[];
  files: readonly MediaFile[];
  folders: readonly MediaFolder[];
  composerReferenceMediaFileIds: readonly string[];
  viewMode: MediaPanelViewMode;
  hasClipboard: boolean;
  proxyFolderName: string | null | undefined;
  projectContextActions: MediaPanelProjectContextMenuActions;
  deleteConfirmation: MediaDeleteConfirmationRequest | null;
  deleteConfirmationBusy: boolean;
  setDeleteConfirmation: Dispatch<SetStateAction<MediaDeleteConfirmationRequest | null>>;
  confirmMediaDelete: () => Promise<void>;
  settingsDialog: MediaPanelCompositionSettingsDialogState | null;
  changeCompositionSettings: (settings: CompositionSettingsValues) => void;
  saveCompositionSettings: () => void;
  cancelCompositionSettings: () => void;
  solidSettingsDialog: {
    solidItemId: string;
    width: number;
    height: number;
    color: string;
  } | null;
  setSolidSettingsDialog: Dispatch<SetStateAction<{
    solidItemId: string;
    width: number;
    height: number;
    color: string;
  } | null>>;
  updateSolidItem: (solidItemId: string, updates: { color: string; width: number; height: number }) => void;
  labelPickerItemId: string | null;
  labelPickerPos: { x: number; y: number } | null;
  setLabelPickerItemId: (itemId: string | null) => void;
  setLabelPickerPos: (position: { x: number; y: number } | null) => void;
  setLabelColor: (itemIds: string[], color: LabelColor) => void;
  showRelinkDialog: boolean;
  closeRelinkDialog: () => void;
}

export function MediaPanelOverlayMounts({
  floatingTexts,
  isMediaBoardDeepZoomActive,
  isGenerativeTrayExpanded,
  setGenerativeTrayExpanded,
  isExternalDragOver,
  contextMenu,
  contextMenuRef,
  contextMenuPosition,
  mediaBoardAnnotations,
  updateMediaBoardAnnotation,
  closeContextMenu,
  selectedIds,
  allProjectItems,
  files,
  folders,
  composerReferenceMediaFileIds,
  viewMode,
  hasClipboard,
  proxyFolderName,
  projectContextActions,
  deleteConfirmation,
  deleteConfirmationBusy,
  setDeleteConfirmation,
  confirmMediaDelete,
  settingsDialog,
  changeCompositionSettings,
  saveCompositionSettings,
  cancelCompositionSettings,
  solidSettingsDialog,
  setSolidSettingsDialog,
  updateSolidItem,
  labelPickerItemId,
  labelPickerPos,
  setLabelPickerItemId,
  setLabelPickerPos,
  setLabelColor,
  showRelinkDialog,
  closeRelinkDialog,
}: MediaPanelOverlayMountsProps) {
  return (
    <>
      <MediaFloatingFeedbackPortal items={floatingTexts} />
      <MediaGenerationTrayMount
        suppressed={isMediaBoardDeepZoomActive && !isGenerativeTrayExpanded}
        expanded={isGenerativeTrayExpanded}
        onExpandedChange={setGenerativeTrayExpanded}
      />
      {isExternalDragOver && (
        <MediaDropOverlay />
      )}

      {contextMenu && (() => {
        const annotationContextMenu = renderMediaAnnotationContextMenuMount({
          annotationId: contextMenu.annotationId,
          annotations: mediaBoardAnnotations,
          colorOptions: MEDIA_BOARD_ANNOTATION_COLOR_OPTIONS,
          menuRef: contextMenuRef,
          x: contextMenuPosition?.x ?? contextMenu.x,
          y: contextMenuPosition?.y ?? contextMenu.y,
          onUpdateColor: (annotationId, target, value) => {
            updateMediaBoardAnnotation(annotationId, { [target]: value });
          },
          onClose: closeContextMenu,
        });

        if (annotationContextMenu) {
          return annotationContextMenu;
        }

        return (
          <MediaPanelProjectContextMenuMount
            contextMenu={contextMenu}
            menuRef={contextMenuRef}
            x={contextMenuPosition?.x ?? contextMenu.x}
            y={contextMenuPosition?.y ?? contextMenu.y}
            selectedIds={selectedIds}
            items={allProjectItems}
            files={files}
            folders={folders}
            composerReferenceMediaFileIds={composerReferenceMediaFileIds}
            viewMode={viewMode}
            hasClipboard={hasClipboard}
            proxyFolderName={proxyFolderName}
            actions={projectContextActions}
          />
        );
      })()}

      {deleteConfirmation && (
        <MediaDeleteConfirmationDialog
          deleteConfirmation={deleteConfirmation}
          deleteConfirmationBusy={deleteConfirmationBusy}
          setDeleteConfirmation={setDeleteConfirmation}
          confirmMediaDelete={confirmMediaDelete}
        />
      )}

      {settingsDialog && (
        <CompositionSettingsDialog
          settings={settingsDialog}
          isCreating={settingsDialog.kind === 'create'}
          onSettingsChange={changeCompositionSettings}
          onSave={saveCompositionSettings}
          onCancel={cancelCompositionSettings}
        />
      )}

      {solidSettingsDialog && (
        <SolidSettingsDialog
          settings={solidSettingsDialog}
          onSettingsChange={setSolidSettingsDialog}
          onSave={() => {
            updateSolidItem(solidSettingsDialog.solidItemId, {
              color: solidSettingsDialog.color,
              width: solidSettingsDialog.width,
              height: solidSettingsDialog.height,
            });
            setSolidSettingsDialog(null);
          }}
          onCancel={() => setSolidSettingsDialog(null)}
        />
      )}

      {labelPickerItemId && labelPickerPos && (
        <LabelColorPicker
          position={labelPickerPos}
          selectedIds={selectedIds}
          labelPickerItemId={labelPickerItemId}
          onSelect={(ids, colorKey) => {
            setLabelColor(ids, colorKey);
            setLabelPickerItemId(null);
            setLabelPickerPos(null);
          }}
          onClose={() => {
            setLabelPickerItemId(null);
            setLabelPickerPos(null);
          }}
        />
      )}

      {showRelinkDialog && (
        <RelinkDialog onClose={closeRelinkDialog} />
      )}
    </>
  );
}
