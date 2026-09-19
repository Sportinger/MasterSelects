import { useCallback, useEffect, useState } from 'react';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { subscribeRelinkDialogRequests } from '../../../../services/project/relinkDialogRuntime';
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

  useEffect(() => subscribeRelinkDialogRequests(openRelinkDialog), [openRelinkDialog]);

  return {
    filesNeedReload: filesNeedReloadCount > 0,
    filesNeedReloadCount,
    showRelinkDialog,
    openRelinkDialog,
    closeRelinkDialog,
  };
}
