// Why a saved media location could not be opened: missing, or only waiting for the browser prompt.
import { fileSystemService } from '../../fileSystemService';
import { projectDB } from '../../projectDB';
import { getMediaSourceRootHandle } from '../mediaSourceRoots';
import type { ProjectMediaFile } from '../types';
import { canPauseMediaAccess, hasLapsedGrantedLocation, noteMediaAccessRestored, pauseMediaAccess, rememberGrantedLocation } from './folderAccessPause';

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};
type MediaLocation = Pick<ProjectMediaFile, 'id' | 'sourceRootId' | 'projectPath'>;

async function permissionOf(handle: FileSystemHandle | null | undefined, mode: 'read' | 'readwrite' = 'read'): Promise<PermissionState | null> {
  const query = (handle as PermissionHandle | null | undefined)?.queryPermission;
  if (!handle || typeof query !== 'function') return null;
  try { return await query.call(handle, { mode }); } catch { return 'denied'; }
}

async function storedFileHandle(mediaId: string): Promise<FileSystemFileHandle | null> {
  const cached = fileSystemService.getFileHandle(mediaId);
  if (cached) return cached;
  const stored = await projectDB.getStoredHandle(`media_${mediaId}`).catch(() => undefined);
  return stored?.kind === 'file' ? stored as FileSystemFileHandle : null;
}

/** The saved locations of one media item that exist but need the browser prompt again. */
async function locationsAwaitingAccess(media: MediaLocation, projectFolder: FileSystemDirectoryHandle | null): Promise<number> {
  let awaiting = 0;
  if (media.sourceRootId && await permissionOf(await getMediaSourceRootHandle(media.sourceRootId)) === 'prompt') awaiting++;
  if (await permissionOf(await storedFileHandle(media.id)) === 'prompt') awaiting++;
  if (media.projectPath && await permissionOf(projectFolder) === 'prompt') awaiting++;
  return awaiting;
}

/**
 * Called when a saved media location could not be opened. When its location only waits for the
 * browser prompt and access worked earlier in this session, the media is paused (kept unopened, shown
 * in the folder-access banner) instead of offline. Returns true when it was paused.
 */
export async function pauseMediaIfAccessLapsed(media: MediaLocation, projectFolder: FileSystemDirectoryHandle | null): Promise<boolean> {
  if (!canPauseMediaAccess(media.id)) return false;
  if (!await locationsAwaitingAccess(media, projectFolder)) return false;
  // Never granted in this session (e.g. a project opened after a browser restart): the reconnect
  // dialog owns that case with its folder search.
  if (!await hasLapsedGrantedLocation()) return false;
  pauseMediaAccess(media.id); return true;
}

/** A media opened from its saved location: its handles prove access for later lapse checks. */
export async function rememberMediaLocationAccess(media: MediaLocation): Promise<void> {
  noteMediaAccessRestored(media.id);
  const remember = async (key: string, handle: FileSystemHandle | null | undefined) => {
    // Only locations that are allowed right now prove access; a cached handle may never have been granted.
    if (await permissionOf(handle) === 'granted') rememberGrantedLocation(key, handle);
  };
  await remember(`file:${media.id}`, fileSystemService.getFileHandle(media.id));
  if (media.sourceRootId) await remember(`root:${media.sourceRootId}`, await getMediaSourceRootHandle(media.sourceRootId).catch(() => null));
}
