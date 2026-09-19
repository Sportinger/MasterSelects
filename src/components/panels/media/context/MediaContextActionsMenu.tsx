import type {
  Composition,
  MediaFile,
  MediaFolder,
  ProjectItem,
  SolidItem,
} from '../../../../stores/mediaStore';
import type { VideoFrameExtractionPosition } from '../videoFrameExtraction';
import { MediaAddItemsMenu } from '../import/MediaAddItemsMenu';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';
import { MediaContextExplorerSubmenu } from './MediaContextExplorerSubmenu';
import { MediaContextMoveFolderSubmenu } from './MediaContextMoveFolderSubmenu';
import { MediaContextRegenerateSubmenu } from './MediaContextRegenerateSubmenu';
import { MediaContextSourceSubmenu } from './MediaContextSourceSubmenu';
import { canDownloadMediaFileInBrowser } from './useMediaContextExplorerHandlers';
import { flashBoardMediaBridge } from '../../../../services/flashboard/FlashBoardMediaBridge';
import type { MediaImportAnchor } from '../panel/types';
import type { TrackingAsset } from '../../../../types/trackingAsset';
import type { TrackingAssetAction } from '../../../../services/planarTracking/trackingAssetActions';

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
  trackingAsset: TrackingAsset | null;
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
  onImport: (anchor?: MediaImportAnchor) => void;
  onPaste: () => void;
  onToggleAiPromptReferences: (mediaFileIds: string[]) => void;
  onCopyPrompt: (prompt: string) => void;
  onStartRename: (itemId: string, itemName: string) => void;
  onMoveToFolder: (ids: readonly string[], folderId: string | null) => void;
  onOpenCompositionSettings: (composition: Composition) => void;
  onCreateCompositionFromItem: (item: MediaFile | Composition) => Promise<void>;
  onOpenImageCrop: (mediaFile: MediaFile) => void;
  onOpenSolidSettings: (solidItem: SolidItem) => void;
  onCancelProxyGeneration: (mediaFileId: string) => void;
  onGenerateProxy: (
    mediaFileId: string,
    options: { force?: boolean },
  ) => void;
  onAnalyzeSceneCuts: (mediaFileId: string, options: { force?: boolean }) => void;
  onRegenerateThumbnails: (mediaFile: MediaFile) => void;
  onRegenerateAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  onRegenerateWaveform: (mediaFile: MediaFile) => void;
  onRegenerateSpectrogram: (mediaFile: MediaFile) => void;
  onTranscribeMedia: (mediaFile: MediaFile) => void;
  onAnalyzeMedia: (mediaFile: MediaFile) => void;
  onExtractVideoFrame: (mediaFile: MediaFile, position: VideoFrameExtractionPosition) => Promise<void>;
  onDownloadMediaFile: (mediaFile: MediaFile) => Promise<void>;
  onShowRawInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onShowProxyInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onPickProxyFolder: () => Promise<void>;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTrackingAssetAction: (action: TrackingAssetAction, asset: TrackingAsset) => void;
  onNewComposition: () => void;
  onNewFolder: () => void;
  onNewLiveInput: () => void;
  onImportGaussianSplat: () => void;
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
  trackingAsset,
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
  onCreateCompositionFromItem,
  onOpenImageCrop,
  onOpenSolidSettings,
  onCancelProxyGeneration,
  onGenerateProxy,
  onAnalyzeSceneCuts,
  onRegenerateThumbnails,
  onRegenerateAudioProxy,
  onRegenerateWaveform,
  onRegenerateSpectrogram,
  onTranscribeMedia,
  onAnalyzeMedia,
  onExtractVideoFrame,
  onDownloadMediaFile,
  onShowRawInExplorer,
  onShowProxyInExplorer,
  onPickProxyFolder,
  onCopy,
  onDuplicate,
  onDelete,
  onTrackingAssetAction,
  onNewComposition,
  onNewFolder,
  onNewLiveInput,
  onImportGaussianSplat,
}: MediaContextActionsMenuProps) {
  const generationPrompt = mediaFile ? (flashBoardMediaBridge.getMetadata(mediaFile.id)?.prompt.trim() ?? '') : '';
  const canCopyGenerationPrompt = !multiSelect && generationPrompt.length > 0;
  const canCreateCompositionFromSelection = Boolean(
    composition
    || (mediaFile?.liveInput && mediaFile.liveInput.kind !== 'composition-feedback')
    || ((isVideoFile || isImageFile) && mediaFile?.file),
  );

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
            onNewLiveInput={onNewLiveInput}
            onImportGaussianSplat={onImportGaussianSplat}
          />
        </div>
      </div>
      <div className="context-menu-item" onClick={(event) => {
        onImport({ x: event.clientX, y: event.clientY });
        onClose();
      }}>
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

          {!trackingAsset && (
            <div
              className={`context-menu-item ${!canCopyGenerationPrompt ? 'disabled' : ''}`}
              onClick={() => {
                if (canCopyGenerationPrompt) onCopyPrompt(generationPrompt);
              }}
            >
              Copy Prompt
            </div>
          )}

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

          {!multiSelect && canCreateCompositionFromSelection && (
            <div className="context-menu-item" onClick={() => { void onCreateCompositionFromItem(composition ?? mediaFile!); }}>
              Create Comp
            </div>
          )}

          {!multiSelect && trackingAsset && (
            <>
              <div className="context-menu-item" onClick={() => onTrackingAssetAction('open', trackingAsset)}>
                Open Tracking
              </div>
              <div className="context-menu-item" onClick={() => onTrackingAssetAction('use', trackingAsset)}>
                Use Track
              </div>
              <div className="context-menu-item" onClick={() => onTrackingAssetAction('scene-3d', trackingAsset)}>
                Add to 3D Scene
              </div>
            </>
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

          {!multiSelect && isVideoFile && mediaFile && Boolean(mediaFile.linkedSources?.length) && (
            <MediaContextSourceSubmenu mediaFile={mediaFile} onClose={onClose} />
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
              onAnalyzeSceneCuts={onAnalyzeSceneCuts}
              onRegenerateThumbnails={onRegenerateThumbnails}
              onRegenerateAudioProxy={onRegenerateAudioProxy}
              onRegenerateWaveform={onRegenerateWaveform}
              onRegenerateSpectrogram={onRegenerateSpectrogram}
              onTranscribeMedia={onTranscribeMedia}
              onAnalyzeMedia={onAnalyzeMedia}
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
          {(!trackingAsset || multiSelect) && (
            <>
              <div className="context-menu-item" onClick={onCopy}>
                Copy{multiSelect ? ` (${selectedCount} items)` : ''}
              </div>
              <div className="context-menu-item" onClick={onDuplicate}>
                Duplicate{multiSelect ? ` (${selectedCount} items)` : ''}
              </div>
              <div className="context-menu-separator" />
            </>
          )}
          <div className="context-menu-item danger" onClick={onDelete}>
            Delete{multiSelect ? ` (${selectedCount} items)` : ''}
          </div>
        </>
      )}
    </>
  );
}
