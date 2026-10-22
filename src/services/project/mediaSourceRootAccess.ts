import { Logger } from '../logger';
import { projectDB } from '../projectDB';

const log = Logger.create('MediaSourceRootAccess');
const HANDLE_KEY_PREFIX = 'media_source_root:';
/** Beyond this, the reconnect dialog's folder search beats one browser prompt per file. */
export const MAX_MEDIA_FILE_PROMPTS_ON_OPEN = 8;

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function mediaSourceRootHandleKey(rootId: string): string {
  return `${HANDLE_KEY_PREFIX}${rootId}`;
}

/** Re-allows one stored handle; true when the browser reports read access afterwards. */
async function reallow(handle: PermissionHandle): Promise<boolean> {
  if (typeof handle.queryPermission === 'function' && await handle.queryPermission({ mode: 'read' }) === 'granted') return true;
  if (typeof handle.requestPermission !== 'function') return false;
  return await handle.requestPermission({ mode: 'read' }) === 'granted';
}

/**
 * Re-allows a project's media folders from the click that opens it. Chrome keeps folder access only
 * for the browsing session (unless "Allow on every visit" was chosen), so after a browser restart the
 * stored folders ask again, and only during user activation, which the project load would outlast.
 * Anything not granted here is left to the reconnect dialog and reported in the log.
 */
export async function requestMediaSourceRootAccess(rootIds: readonly string[]): Promise<void> {
  for (const rootId of new Set(rootIds)) {
    try {
      const handle = await projectDB.getStoredHandle(mediaSourceRootHandleKey(rootId)) as PermissionHandle | null;
      if (handle?.kind !== 'directory') continue;
      if (!await reallow(handle)) log.warn('Media folder access was not restored on open; the reconnect dialog will offer it', { rootId, name: handle.name });
    } catch (error) {
      log.warn('Media folder access was not restored on open; the reconnect dialog will offer it', { rootId, error });
    }
  }
}

/**
 * Same click, for media linked as single files: their saved file locations need the browser prompt
 * again, not a relink. Chrome's restore prompt usually re-grants them together with the project folder,
 * so already granted files cost nothing; at most a few further prompts are shown.
 */
export async function requestMediaFileAccess(mediaIds: readonly string[], maxPrompts = MAX_MEDIA_FILE_PROMPTS_ON_OPEN): Promise<void> {
  let prompts = 0;
  for (const mediaId of new Set(mediaIds)) {
    try {
      const handle = await projectDB.getStoredHandle(`media_${mediaId}`) as PermissionHandle | null;
      if (handle?.kind !== 'file') continue;
      if (typeof handle.queryPermission === 'function' && await handle.queryPermission({ mode: 'read' }) === 'granted') continue;
      if (prompts >= maxPrompts) {
        log.info('More linked media files need access than one click prompts for; the reconnect dialog offers the rest', { maxPrompts });
        return;
      }
      prompts += 1;
      if (!await reallow(handle)) log.warn('Media file access was not restored on open; the reconnect dialog will offer it', { mediaId, name: handle.name });
    } catch (error) {
      log.warn('Media file access was not restored on open; the reconnect dialog will offer it', { mediaId, error });
    }
  }
}
