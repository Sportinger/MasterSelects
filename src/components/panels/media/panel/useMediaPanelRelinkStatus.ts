import { useCallback, useState } from 'react';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import type { MediaFile } from '../../../../stores/mediaStore';

export function useMediaPanelRelinkStatus(files: readonly MediaFile[]) {
  const [showRelinkDialog, setShowRelinkDialog] = useState(false);
  const filesNeedReloadCount = files.filter(mediaNeedsRelink).length;
  const openRelinkDialog = useCallback(() => {
    setShowRelinkDialog(true);
  }, []);
  const closeRelinkDialog = useCallback(() => {
    setShowRelinkDialog(false);
  }, []);

  return {
    filesNeedReload: filesNeedReloadCount > 0,
    filesNeedReloadCount,
    showRelinkDialog,
    openRelinkDialog,
    closeRelinkDialog,
  };
}
