import { directoryBackend } from './directoryBackend';
import { registerFsaLocation } from './browserOwner';
export async function createFsaRepositoryBackend(root: FileSystemDirectoryHandle) {
  const permissionHandle = root as FileSystemDirectoryHandle & { queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState> };
  const permission = permissionHandle.queryPermission ? await permissionHandle.queryPermission({ mode: 'readwrite' }) : 'denied';
  let locationId: string;
  try { locationId = await registerFsaLocation(root); }
  catch { locationId = `fsa-readonly:${crypto.randomUUID()}`; }
  return directoryBackend(root, locationId, permission === 'granted');
}
