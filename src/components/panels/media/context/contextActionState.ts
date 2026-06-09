import type { MediaFile, MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { isImportedMediaFileItem } from '../itemTypeGuards';
import type { MediaPanelViewMode } from '../panel/types';
import type { MediaPanelContextMenu } from './types';

interface GetMediaContextActionStateInput {
  contextMenu: Pick<MediaPanelContextMenu, 'itemId' | 'boardPosition'>;
  multiSelect: boolean;
  selectedIds: readonly string[];
  files: readonly MediaFile[];
  folders: readonly MediaFolder[];
  composerReferenceMediaFileIds: readonly string[];
  mediaFile: MediaFile | null;
  viewMode: MediaPanelViewMode;
}

export interface MediaContextActionState {
  showBoardAnnotationAction: boolean;
  availableFolders: readonly MediaFolder[];
  aiReferenceMediaFileIds: readonly string[];
  allContextMediaReferenced: boolean;
  canRegenerateMediaArtifacts: boolean;
  isVideoFile: boolean;
  isAudioFile: boolean;
  isImageFile: boolean;
  isGenerating: boolean;
  hasProxy: boolean;
  hasAudio: boolean;
  isAudioProxyGenerating: boolean;
  hasAudioProxy: boolean;
  isSourceAudioAnalysisGenerating: boolean;
  hasSourceWaveform: boolean;
  hasSourceSpectrogram: boolean;
}

function isAiReferenceMediaFile(item: ProjectItem | null | undefined): item is MediaFile {
  if (!item) return false;
  return isImportedMediaFileItem(item) && (
    item.type === 'image' ||
    item.type === 'video' ||
    item.type === 'audio'
  );
}

function mediaFileHasAudio(mediaFile: MediaFile | null): boolean {
  if (!mediaFile) return false;
  if (mediaFile.type === 'audio') return true;
  if (mediaFile.type !== 'video') return false;
  return mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec);
}

export function getMediaContextActionState({
  contextMenu,
  multiSelect,
  selectedIds,
  files,
  folders,
  composerReferenceMediaFileIds,
  mediaFile,
  viewMode,
}: GetMediaContextActionStateInput): MediaContextActionState {
  const isVideoFile = mediaFile?.type === 'video';
  const isAudioFile = mediaFile?.type === 'audio';
  const isImageFile = mediaFile?.type === 'image';
  const hasAudio = mediaFileHasAudio(mediaFile);
  const contextSelectionIds = multiSelect && contextMenu.itemId && selectedIds.includes(contextMenu.itemId)
    ? selectedIds
    : contextMenu.itemId
      ? [contextMenu.itemId]
      : [];
  const aiReferenceMediaFileIds = contextSelectionIds.filter((id) => {
    const candidate = files.find((file) => file.id === id);
    return isAiReferenceMediaFile(candidate);
  });

  return {
    showBoardAnnotationAction: viewMode === 'board' && Boolean(contextMenu.boardPosition) && !contextMenu.itemId,
    availableFolders: folders.filter(f => !selectedIds.includes(f.id)),
    aiReferenceMediaFileIds,
    allContextMediaReferenced: aiReferenceMediaFileIds.length > 0
      && aiReferenceMediaFileIds.every((id) => composerReferenceMediaFileIds.includes(id)),
    canRegenerateMediaArtifacts: Boolean(
      mediaFile && (
        isVideoFile ||
        isAudioFile ||
        isImageFile ||
        hasAudio
      )
    ),
    isVideoFile,
    isAudioFile,
    isImageFile,
    isGenerating: mediaFile?.proxyStatus === 'generating',
    hasProxy: mediaFile?.proxyStatus === 'ready',
    hasAudio,
    isAudioProxyGenerating: mediaFile?.audioProxyStatus === 'generating',
    hasAudioProxy: mediaFile?.audioProxyStatus === 'ready' || mediaFile?.hasProxyAudio === true,
    isSourceAudioAnalysisGenerating: mediaFile?.waveformStatus === 'generating',
    hasSourceWaveform: Boolean(mediaFile?.waveform?.length || mediaFile?.audioAnalysisRefs?.waveformPyramidId),
    hasSourceSpectrogram: Boolean(mediaFile?.audioAnalysisRefs?.spectrogramTileSetIds?.[0]),
  };
}
