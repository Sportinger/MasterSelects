import { directoryBackend, repositoryPath, supportsRepositoryWritableStreams } from './directoryBackend';
import { getBrowserStorageRoot, getBrowserStorageRootOf, type BrowserStorageKind } from '../../core/browserStorageRoot';
import { isFallbackStorageHandle } from '../../core/fallbackDirectoryHandle';
/** Identity of a browser-local repository folder; the store prefix differs between OPFS and the fallback. */
export function browserRepositoryLocationId(store: BrowserStorageKind, path: string): string {
  return `${store}:${location.origin}:${repositoryPath(path).join('/')}`;
}
/** Browser-local repository: OPFS, or the IndexedDB fallback when the browser refuses OPFS. */
export async function createOpfsRepositoryBackend(path: string, store?: BrowserStorageKind) {
  const parts = repositoryPath(path); let root = await (store ? getBrowserStorageRootOf(store) : getBrowserStorageRoot());
  const fallback = isFallbackStorageHandle(root);
  for (const part of parts) root = await root.getDirectoryHandle(part, { create: true });
  // Fallback handles write through their own streams, whatever FileSystemFileHandle supports.
  return directoryBackend(root, browserRepositoryLocationId(fallback ? 'indexeddb' : 'opfs', path), true, fallback || supportsRepositoryWritableStreams());
}
