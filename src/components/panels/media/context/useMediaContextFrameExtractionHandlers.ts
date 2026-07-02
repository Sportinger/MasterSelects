import { useCallback } from 'react';
import { Logger } from '../../../../services/logger';
import type { MediaFile, useMediaStore } from '../../../../stores/mediaStore';
import { requireMediaFileImportResult } from '../../../../stores/mediaStore/helpers/importResult';
import {
  extractVideoFrameFile,
  type VideoFrameExtractionPosition,
} from '../videoFrameExtraction';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

const log = Logger.create('MediaPanel');

interface UseMediaContextFrameExtractionHandlersInput {
  closeContextMenu: () => void;
  importFile: MediaStoreState['importFile'];
  setSelection: MediaStoreState['setSelection'];
}

export interface MediaContextFrameExtractionHandlers {
  onExtractVideoFrame: (
    mediaFile: MediaFile,
    position: VideoFrameExtractionPosition,
  ) => Promise<void>;
}

export function useMediaContextFrameExtractionHandlers({
  closeContextMenu,
  importFile,
  setSelection,
}: UseMediaContextFrameExtractionHandlersInput): MediaContextFrameExtractionHandlers {
  const onExtractVideoFrame = useCallback(async (
    mediaFile: MediaFile,
    position: VideoFrameExtractionPosition,
  ) => {
    closeContextMenu();

    try {
      const frameFile = await extractVideoFrameFile(mediaFile, position);
      const imported = requireMediaFileImportResult(
        await importFile(frameFile, mediaFile.parentId, {
          forceCopyToProject: Boolean(mediaFile.projectPath),
        }),
        'Video frame extraction',
      );
      setSelection([imported.id]);
    } catch (error) {
      log.warn('Failed to extract video frame', {
        mediaFileId: mediaFile.id,
        name: mediaFile.name,
        position,
        error,
      });
      alert(error instanceof Error ? error.message : 'Could not extract video frame.');
    }
  }, [closeContextMenu, importFile, setSelection]);

  return {
    onExtractVideoFrame,
  };
}
