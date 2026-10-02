import { directoryBackend, repositoryPath } from './directoryBackend';
export async function createOpfsRepositoryBackend(path: string) {
  const parts = repositoryPath(path); let root = await navigator.storage.getDirectory();
  for (const part of parts) root = await root.getDirectoryHandle(part, { create: true });
  return directoryBackend(root, `opfs:${location.origin}:${parts.join('/')}`);
}
