import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import { requestMediaBoardPlacement } from '../../panels/media/board/placementRequests';
import type { SourceMonitorImageCropApplyRequest } from './SourceMonitorImageCrop';
import { createSourceMonitorCroppedFile } from './sourceMonitorImageCropFile';

export function useSourceMonitorImageCrop(file: MediaFile, isImage: boolean) {
  const files = useMediaStore(state => state.files);
  const importFile = useMediaStore(state => state.importFile);
  const setSelection = useMediaStore(state => state.setSelection);
  const setSourceMonitorFile = useMediaStore(state => state.setSourceMonitorFile);
  const sourceMonitorCropRequestId = useMediaStore(state => state.sourceMonitorCropRequestId);
  const handledCropRequestIdRef = useRef(0);
  const [cropMode, setCropMode] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    setCropError(null);
    if (!isImage) setCropMode(false);
  }, [file.id, isImage]);

  useEffect(() => {
    if (!isImage || sourceMonitorCropRequestId <= handledCropRequestIdRef.current) return;
    handledCropRequestIdRef.current = sourceMonitorCropRequestId;
    setCropMode(true);
    setCropError(null);
  }, [file.id, isImage, sourceMonitorCropRequestId]);

  const applyImageCrop = useCallback(async ({ image, crop }: SourceMonitorImageCropApplyRequest) => {
    if (!isImage || cropBusy) return;
    setCropBusy(true);
    setCropError(null);

    try {
      const croppedFile = await createSourceMonitorCroppedFile({
        sourceFile: file,
        image,
        crop,
        existingNames: files.map((entry) => entry.name),
      });
      const imported = await importFile(croppedFile, file.parentId, {
        forceCopyToProject: Boolean(file.projectPath),
      });

      if ('url' in imported) {
        setSelection([imported.id]);
        setSourceMonitorFile(imported.id);
        requestMediaBoardPlacement({ itemIds: [imported.id], nearItemId: file.id });
      }
      setCropMode(false);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Could not crop image');
    } finally {
      setCropBusy(false);
    }
  }, [cropBusy, file, files, importFile, isImage, setSelection, setSourceMonitorFile]);

  const cancelImageCrop = useCallback(() => {
    setCropMode(false);
    setCropError(null);
  }, []);

  const toggleImageCrop = useCallback(() => {
    setCropMode((active) => !active);
    setCropError(null);
  }, []);

  return {
    applyImageCrop,
    cancelImageCrop,
    cropBusy,
    cropError,
    cropMode,
    toggleImageCrop,
  };
}
