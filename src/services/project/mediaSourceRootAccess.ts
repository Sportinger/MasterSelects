import { Logger } from '../logger';
import { projectDB } from '../projectDB';

const log = Logger.create('MediaSourceRootAccess');
const HANDLE_KEY_PREFIX = 'media_source_root:';

type PermissionDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function mediaSourceRootHandleKey(rootId: string): string {
  return `${HANDLE_KEY_PREFIX}${rootId}`;
}

/**
 * Re-allows a project's media folders from the click that opens the project. Browsers drop
 * folder access on reload (e.g. after a deploy) and only prompt during user activation, which
 * the project load would outlast. Anything not granted here is left to the reconnect dialog.
 */
export async function requestMediaSourceRootAccess(rootIds: readonly string[]): Promise<void> {
  for (const rootId of new Set(rootIds)) {
    try {
      const handle = await projectDB.getStoredHandle(mediaSourceRootHandleKey(rootId)) as PermissionDirectoryHandle | null;
      if (handle?.kind !== 'directory' || typeof handle.requestPermission !== 'function') continue;
      if (typeof handle.queryPermission === 'function' && await handle.queryPermission({ mode: 'read' }) === 'granted') continue;
      await handle.requestPermission({ mode: 'read' });
    } catch (error) {
      log.debug('Media folder access was not restored on open', { rootId, error });
    }
  }
}
