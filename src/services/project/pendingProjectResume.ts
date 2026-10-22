// Resume the last project after the browser asks for folder access again.
//
// Chrome keeps File System Access grants only for the browsing session unless "Allow on every visit"
// was chosen: after a browser restart (or once every tab of the site was closed) a stored project
// folder reports `prompt`. That is not a lost link. One click re-grants the stored handle; Chrome
// then shows its restore prompt, which brings back every folder and file allowed on the last visit.
import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';
import { loadProjectToStores, setProjectLoadProgress } from './projectLoad';
import { markAndroidProjectAutoRestoreReady, prepareAndroidProjectAutoRestore } from './androidProjectAutoRestore';

const log = Logger.create('PendingProjectResume');

/** Must start inside the click handler: the browser prompt needs its user activation. */
export async function resumePendingProject(): Promise<boolean> {
  setProjectLoadProgress({ phase: 'opening', percent: 3, message: 'Allowing project folder access', blocking: true });
  let resumed = false;
  try {
    resumed = await projectFileService.requestPendingPermission();
  } finally {
    if (!resumed) setProjectLoadProgress(null);
  }
  if (!resumed) {
    log.info('Project folder access was not granted; the project stays available to resume');
    return false;
  }
  await prepareAndroidMirror();
  await loadProjectToStores();
  return true;
}

async function prepareAndroidMirror(): Promise<void> {
  const sourceHandle = projectFileService.getProjectHandle();
  if (!sourceHandle) return;
  let copiedFileCount = 0;
  try {
    setProjectLoadProgress({ phase: 'opening', percent: 12, message: 'Preparing automatic Android restore', blocking: true });
    const mirrorHandle = await prepareAndroidProjectAutoRestore(sourceHandle, () => {
      copiedFileCount += 1;
      if (copiedFileCount === 1 || copiedFileCount % 25 === 0) {
        setProjectLoadProgress({
          phase: 'opening',
          percent: Math.min(85, 12 + copiedFileCount),
          message: `Preparing automatic Android restore (${copiedFileCount} files)`,
          blocking: true,
        });
      }
    });
    if (!mirrorHandle) return;
    const alreadyUsingMirror = await sourceHandle.isSameEntry(mirrorHandle);
    const mirrorLoaded = alreadyUsingMirror || await projectFileService.loadProject(mirrorHandle);
    if (mirrorLoaded) markAndroidProjectAutoRestoreReady(mirrorHandle);
    else log.warn('Android project mirror could not be opened; keeping the original project open');
  } catch (error) {
    log.warn('Could not prepare Android project auto-restore; keeping the original project open', error);
  }
}
