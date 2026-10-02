import { lazy, Suspense } from 'react';
import { useMediaUrlDownloadDialogStore } from '../../../../stores/mediaUrlDownloadDialogStore';

const MediaUrlDownloadDialog = lazy(() => import('./MediaUrlDownloadDialog'));

export function MediaUrlDownloadDialogMount() {
  const url = useMediaUrlDownloadDialogStore((state) => state.url);
  const close = useMediaUrlDownloadDialogStore((state) => state.close);
  if (!url) return null;

  return (
    <Suspense fallback={null}>
      <MediaUrlDownloadDialog key={url} url={url} onClose={close} />
    </Suspense>
  );
}
