import { useEffect, useRef } from 'react';

import type { PreviewPanelData } from '../../types/dock';
import type { EditCameraViewMode } from './previewSceneCameraMath';

export function usePreviewInitialEditCameraView(
  initialEdit: Pick<PreviewPanelData, 'initialEditMode' | 'initialEditCameraView'> | undefined,
  editCameraModeActive: boolean,
  setEditCameraView: (view: EditCameraViewMode) => void,
): void {
  const view = initialEdit?.initialEditCameraView ?? 'camera';
  const appliedRef = useRef(!initialEdit?.initialEditMode || view === 'camera');

  useEffect(() => {
    if (appliedRef.current || !editCameraModeActive) return;
    setEditCameraView(view);
    appliedRef.current = true;
  }, [editCameraModeActive, setEditCameraView, view]);
}
