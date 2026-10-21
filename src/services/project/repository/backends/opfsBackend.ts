import { directoryBackend, repositoryPath, supportsRepositoryWritableStreams } from './directoryBackend';
import { getBrowserStorageRoot } from '../../core/browserStorageRoot';
import { isFallbackStorageHandle } from '../../core/fallbackDirectoryHandle';
/** Browser-local repository: OPFS, or the IndexedDB fallback when the browser refuses OPFS. */
export async function createOpfsRepositoryBackend(path: string) {
  const parts = repositoryPath(path); let root = await getBrowserStorageRoot();
  const fallback = isFallbackStorageHandle(root);
  for (const part of parts) root = await root.getDirectoryHandle(part, { create: true });
  // Fallback handles write through their own streams, whatever FileSystemFileHandle supports.
  return directoryBackend(root, `${fallback ? 'indexeddb' : 'opfs'}:${location.origin}:${parts.join('/')}`, true, fallback || supportsRepositoryWritableStreams());
}
