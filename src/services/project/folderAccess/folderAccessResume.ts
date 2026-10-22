// One click resumes a project whose folder access the browser paused mid-session.
import { Logger } from '../../logger';
import { requestLinkedMedia } from '../linkedMediaDemand';
import { requestMediaFileAccess } from '../mediaSourceRootAccess';
import { getProjectMediaSourceRootStates, requestProjectMediaSourceRootAccess } from '../mediaSourceRoots';
import { getActiveRepositorySession, retryEditorRepository } from '../repository/lifecycle/editorRepositoryLifecycle';
import {
  checkGrantedLocations, clearProjectFolderAccessPause, getFolderAccessPause, isFolderAccessLossError,
  lapsedGrantedLocations, rememberGrantedLocation, reportProjectFolderAccessLoss, setFolderAccessPhase, takePausedMedia,
} from './folderAccessPause';

const log = Logger.create('FolderAccess');

type PermissionHandle = FileSystemHandle & {
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

async function reallow(handle: FileSystemHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const request = (handle as PermissionHandle).requestPermission;
  if (typeof request !== 'function') return false;
  try { return await request.call(handle, { mode }) === 'granted'; }
  catch (error) { log.warn('Browser did not show the folder access prompt', { name: handle.name, error }); return false; }
}

/**
 * Must start inside the click handler: browser permission prompts need its user activation, so the
 * project folder is asked first (Chrome's restore prompt then re-grants the other folders too).
 * Re-requests every stored location this session used, republishes the queued saves in their original
 * order and opens the media that waited. Returns true when nothing waits for access any more.
 */
export async function resumeFolderAccess(): Promise<boolean> {
  if (getFolderAccessPause().phase === 'resuming') return false;
  setFolderAccessPhase('resuming', null);
  const refused: string[] = [];
  let failure: string | null = null;
  try {
    const session = getActiveRepositorySession();
    let projectAllowed = true;
    if (session?.location.kind === 'fsa') {
      const mode = session.opening.writable ? 'readwrite' : 'read';
      projectAllowed = await reallow(session.location.handle, mode);
      if (projectAllowed) rememberGrantedLocation('project', session.location.handle, mode);
      else refused.push(session.location.handle.name);
    }
    for (const location of await lapsedGrantedLocations()) {
      if (location.key === 'project') continue;
      if (!await reallow(location.handle, location.mode)) refused.push(location.handle.name);
    }
    for (const root of await getProjectMediaSourceRootStates()) {
      if (root.handle && root.permission === 'prompt' && !await requestProjectMediaSourceRootAccess(root)) refused.push(root.name);
    }
    const paused = getFolderAccessPause();
    await requestMediaFileAccess(paused.mediaIds);

    const savesWaiting = paused.project || isFolderAccessLossError(session?.coordinator.getStatus().error);
    if (savesWaiting && projectAllowed) {
      try {
        // Retries the queued revisions in order and writes the current workspace: nothing edited is lost.
        if (session?.opening.writable) await retryEditorRepository();
        clearProjectFolderAccessPause();
      } catch (error) {
        if (isFolderAccessLossError(error)) reportProjectFolderAccessLoss(error);
        else {
          // Not an access problem any more: the save status reports it with its own retry.
          clearProjectFolderAccessPause();
          log.warn('Queued saves could not be written after folder access was allowed', error);
        }
      }
    }
    // Paused media open again now; any that still cannot be read go to the reconnect dialog.
    await Promise.all(takePausedMedia().map(id => requestLinkedMedia(id)));
    const stillPaused = await checkGrantedLocations();
    if (refused.length) failure = `The browser did not allow access to ${[...new Set(refused)].join(', ')}.`;
    else if (stillPaused) failure = 'Folder access is still paused. Allow access in the browser prompt.';
    if (failure) log.warn('Folder access was not fully restored', { refused: refused.length });
    else log.info('Folder access re-allowed; queued saves and waiting media resumed');
    return !stillPaused;
  } catch (error) {
    failure = 'Folder access could not be restored. Your changes are still in this tab.';
    log.error('Re-allowing folder access failed', error);
    return false;
  } finally {
    setFolderAccessPhase('idle', failure);
  }
}
