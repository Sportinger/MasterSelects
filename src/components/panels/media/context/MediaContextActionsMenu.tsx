import type {
  Composition,
  MediaFile,
  MediaFolder,
  MeshPrimitiveType,
  ProjectItem,
  SolidItem,
} from '../../../../stores/mediaStore';
import type { ShapePrimitive } from '../../../../types/motionDesign';
import type { VideoFrameExtractionPosition } from '../videoFrameExtraction';
import { MediaAddItemsMenu } from '../import/MediaAddItemsMenu';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';
import { MediaContextExplorerSubmenu } from './MediaContextExplorerSubmenu';
import { MediaContextMoveFolderSubmenu } from './MediaContextMoveFolderSubmenu';
import { MediaContextRegenerateSubmenu } from './MediaContextRegenerateSubmenu';
import { canDownloadMediaFileInBrowser } from './useMediaContextExplorerHandlers';
import { flashBoardMediaBridge } from '../../../../services/flashboard/FlashBoardMediaBridge';

export interface MediaContextActionsMenuProps {
  showBoardAnnotationAction: boolean;
  hasClipboard: boolean;
  hasSelection: boolean;
  multiSelect: boolean;
  selectedCount: number;
  selectedItem: ProjectItem | null;
  selectedIds: readonly string[];
  availableFolders: readonly MediaFolder[];
  aiReferenceMediaFileIds: readonly string[];
  allContextMediaReferenced: boolean;
  composition: Composition | null;
  solidItem: SolidItem | null;
  mediaFile: MediaFile | null;
  canRegenerateMediaArtifacts: boolean;
  isVideoFile: boolean;
  isImageFile: boolean;
  isGenerating: boolean;
  hasProxy: boolean;
  hasAudio: boolean;
  isAudioProxyGenerating: boolean;
  hasAudioProxy: boolean;
  isSourceAudioAnalysisGenerating: boolean;
  hasSourceWaveform: boolean;
  hasSourceSpectrogram: boolean;
  proxyFolderName: string | null | undefined;
  onNewBoardAnnotation: () => void;
  onClose: () => void;
  onImport: () => void;
  onPaste: () => void;
  onToggleAiPromptReferences: (mediaFileIds: string[]) => void;
  onCopyPrompt: (prompt: string) => void;
  onStartRename: (itemId: string, itemName: string) => void;
  onMoveToFolder: (ids: readonly string[], folderId: string | null) => void;
  onOpenCompositionSettings: (composition: Composition) => void;
  onOpenImageCrop: (mediaFile: MediaFile) => void;
  onOpenSolidSettings: (solidItem: SolidItem) => void;
  onCancelProxyGeneration: (mediaFileId: string) => void;
  onGenerateProxy: (mediaFileId: string, options: { force: boolean }) => void;
  onRegenerateThumbnails: (mediaFile: MediaFile) => void;
  onRegenerateAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  onRegenerateWaveform: (mediaFile: MediaFile) => void;
  onRegenerateSpectrogram: (mediaFile: MediaFile) => void;
  onExtractVideoFrame: (mediaFile: MediaFile, position: VideoFrameExtractionPosition) => Promise<void>;
  onDownloadMediaFile: (mediaFile: MediaFile) => Promise<void>;
  onShowRawInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onShowProxyInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onPickProxyFolder: () => Promise<void>;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNewComposition: () => void;
  onNewFolder: () => void;
  onNewText: () => void;
  onNewSolid: () => void;
  onNewMesh: (meshType: MeshPrimitiveType) => void;
  onNewText3D: () => void;
  onNewCamera: () => void;
  onNewSplatEffector: () => void;
  onImportGaussianSplat: () => void;
  onNewMathScene: () => void;
  onNewMotionShape: (shapeType: ShapePrimitive) => void;
}

export function MediaContextActionsMenu({
  showBoardAnnotationAction,
  hasClipboard,
  hasSelection,
  multiSelect,
  selectedCount,
  selectedItem,
  selectedIds,
  availableFolders,
  aiReferenceMediaFileIds,
  allContextMediaReferenced,
  composition,
  solidItem,
  mediaFile,
  canRegenerateMediaArtifacts,
  isVideoFile,
  isImageFile,
  isGenerating,
  hasProxy,
  hasAudio,
  isAudioProxyGenerating,
  hasAudioProxy,
  isSourceAudioAnalysisGenerating,
  hasSourceWaveform,
  hasSourceSpectrogram,
  proxyFolderName,
  onNewBoardAnnotation,
  onClose,
  onImport,
  onPaste,
  onToggleAiPromptReferences,
  onCopyPrompt,
  onStartRename,
  onMoveToFolder,
  onOpenCompositionSettings,
  onOpenImageCrop,
  onOpenSolidSettings,
  onCancelProxyGeneration,
  onGenerateProxy,
  onRegenerateThumbnails,
  onRegenerateAudioProxy,
  onRegenerateWaveform,
  onRegenerateSpectrogram,
  onExtractVideoFrame,
  onDownloadMediaFile,
  onShowRawInExplorer,
  onShowProxyInExplorer,
  onPickProxyFolder,
  onCopy,
  onDuplicate,
  onDelete,
  onNewComposition,
  onNewFolder,
  onNewText,
  onNewSolid,
  onNewMesh,
  onNewText3D,
  onNewCamera,
  onNewSplatEffector,
  onImportGaussianSplat,
  onNewMathScene,
  onNewMotionShape,
}: MediaContextActionsMenuProps) {
  const generationPrompt = mediaFile ? (flashBoardMediaBridge.getMetadata(mediaFile.id)?.prompt.trim() ?? '') : '';
  const canCopyGenerationPrompt = !multiSelect && generationPrompt.length > 0;

  return (
    <>
      {showBoardAnnotationAction && (
        <>
          <div className="context-menu-item" onClick={onNewBoardAnnotation}>
            <span>Annotation</span>
          </div>
          <div className="context-menu-separator" />
        </>
      )}
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>Add</span>
        <span className="submenu-arrow">&#9654;</span>
        <div className="context-submenu">
          <MediaAddItemsMenu
            variant="context"
            onClose={onClose}
            onImport={onImport}
            onNewComposition={onNewComposition}
            onNewFolder={onNewFolder}
            onNewText={onNewText}
            onNewSolid={onNewSolid}
            onNewMesh={onNewMesh}
            onNewText3D={onNewText3D}
            onNewCamera={onNewCamera}
            onNewSplatEffector={onNewSplatEffector}
            onImportGaussianSplat={onImportGaussianSplat}
            onNewMathScene={onNewMathScene}
            onNewMotionShape={onNewMotionShape}
          />
        </div>
      </div>
      <div className="context-menu-item" onClick={onImport}>
        Import Media...
      </div>
      {hasClipboard && (
        <div className="context-menu-item" onClick={onPaste}>
          Paste
        </div>
      )}
      {hasSelection && (
        <>
          <div className="context-menu-separator" />

          {aiReferenceMediaFileIds.length > 0 && (
            <div
              className="context-menu-item"
              onClick={() => onToggleAiPromptReferences([...aiReferenceMediaFileIds])}
            >
              {allContextMediaReferenced ? 'Unreference from AI Prompt' : 'Reference in AI Prompt'}
              {aiReferenceMediaFileIds.length > 1 ? ` (${aiReferenceMediaFileIds.length})` : ''}
            </div>
          )}

          <div
            className={`context-menu-item ${!canCopyGenerationPrompt ? 'disabled' : ''}`}
            onClick={() => {
              if (canCopyGenerationPrompt) onCopyPrompt(generationPrompt);
            }}
          >
            Copy Prompt
          </div>

          {!multiSelect && selectedItem && (
            <div className="context-menu-item" onClick={() => onStartRename(selectedItem.id, selectedItem.name)}>
              Rename
            </div>
          )}

          {!multiSelect && mediaFile && canDownloadMediaFileInBrowser(mediaFile) && (
            <div className="context-menu-item" onClick={() => { void onDownloadMediaFile(mediaFile); }}>
              Download
            </div>
          )}

          {!multiSelect && isImageFile && mediaFile && (
            <div className="context-menu-item" onClick={() => onOpenImageCrop(mediaFile)}>
              Crop
            </div>
          )}

          {!multiSelect && isVideoFile && mediaFile && (
            <>
              <div className="context-menu-item" onClick={() => { void onExtractVideoFrame(mediaFile, 'first'); }}>
                Extract First Frame
              </div>
              <div className="context-menu-item" onClick={() => { void onExtractVideoFrame(mediaFile, 'last'); }}>
                Extract Last Frame
              </div>
            </>
          )}

          <MediaContextMoveFolderSubmenu
            folders={availableFolders}
            selectedIds={selectedIds}
            multiSelect={multiSelect}
            onMoveToFolder={onMoveToFolder}
            onClose={onClose}
          />

          {!multiSelect && composition && (
            <div className="context-menu-item" onClick={() => onOpenCompositionSettings(composition)}>
              Composition Settings...
            </div>
          )}

          {!multiSelect && solidItem && (
            <div className="context-menu-item" onClick={() => onOpenSolidSettings(solidItem)}>
              Solid Settings...
            </div>
          )}

          {!multiSelect && canRegenerateMediaArtifacts && mediaFile && (
            <MediaContextRegenerateSubmenu
              mediaFile={mediaFile}
              isVideoFile={isVideoFile}
              isImageFile={isImageFile}
              hasAudio={hasAudio}
              isGenerating={isGenerating}
              hasProxy={hasProxy}
              isAudioProxyGenerating={isAudioProxyGenerating}
              hasAudioProxy={hasAudioProxy}
              isSourceAudioAnalysisGenerating={isSourceAudioAnalysisGenerating}
              hasSourceWaveform={hasSourceWaveform}
              hasSourceSpectrogram={hasSourceSpectrogram}
              onCancelProxyGeneration={onCancelProxyGeneration}
              onGenerateProxy={onGenerateProxy}
              onRegenerateThumbnails={onRegenerateThumbnails}
              onRegenerateAudioProxy={onRegenerateAudioProxy}
              onRegenerateWaveform={onRegenerateWaveform}
              onRegenerateSpectrogram={onRegenerateSpectrogram}
              onClose={onClose}
            />
          )}

          {!multiSelect && isVideoFile && mediaFile?.file && (
            <MediaContextExplorerSubmenu
              mediaFile={mediaFile}
              hasProxy={hasProxy}
              proxyFolderName={proxyFolderName}
              onShowRaw={onShowRawInExplorer}
              onShowProxy={onShowProxyInExplorer}
              onClose={onClose}
            />
          )}

          {!multiSelect && isVideoFile && (
            <div
              className="context-menu-item"
              onClick={() => { void onPickProxyFolder(); }}
            >
              Set Proxy Folder... {proxyFolderName && `(${proxyFolderName})`}
            </div>
          )}

          <div className="context-menu-separator" />
          <div className="context-menu-item" onClick={onCopy}>
            Copy{multiSelect ? ` (${selectedCount} items)` : ''}
          </div>
          <div className="context-menu-item" onClick={onDuplicate}>
            Duplicate{multiSelect ? ` (${selectedCount} items)` : ''}
          </div>
          <div className="context-menu-separator" />
          <div className="context-menu-item danger" onClick={onDelete}>
            Delete{multiSelect ? ` (${selectedCount} items)` : ''}
          </div>
        </>
      )}
    </>
  );
}
