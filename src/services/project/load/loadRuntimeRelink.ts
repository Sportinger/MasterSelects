import { Logger } from '../../logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  createMediaSourceReplacementPatch,
  updateTimelineClips,
} from '../../../stores/mediaStore/slices/fileManageSlice';
import { fileSystemService } from '../../fileSystemService';
import { projectDB } from '../../projectDB';
import { projectFileService, type ProjectFile } from '../../projectFileService';
import { createPrimaryMediaObjectUrl } from '../mediaObjectUrlManager';
import {
  applyRelinkMatch,
  createRelinkCandidateMapFromHandles,
  findRelinkMatch,
} from '../relinkMedia';
import { completeProjectLoadProgress, setProjectLoadProgress, yieldToBrowser } from './loadProgress';
import {
  isProjectMediaThumbnailCandidate,
  refreshMediaMetadata,
  restoreCachedMediaThumbnails,
  restoreDeferredMediaCacheState,
} from './loadMediaCacheHydration';
import { reloadNestedCompositionClips } from './loadTimelineHydration';

const log = Logger.create('ProjectSync');
const EAGER_METADATA_RESTORE_MEDIA_LIMIT = 120;
const DEFERRED_PROJECT_RESTORE_DELAY_MS = 12_000;
const DEFERRED_PROJECT_RESTORE_PLAYBACK_POLL_MS = 500;
const DEFERRED_PROJECT_RESTORE_MAX_PLAYBACK_WAIT_MS = 120_000;

let postLoadRestorationRunId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimelineBusyForDeferredRestore(): boolean {
  const timelineState = useTimelineStore.getState();
  return timelineState.isPlaying || timelineState.playbackWarmup !== null;
}

async function waitForDeferredProjectRestoreWindow(
  runId: number,
  initialDelayMs = DEFERRED_PROJECT_RESTORE_DELAY_MS,
): Promise<boolean> {
  await sleep(initialDelayMs);
  if (runId !== postLoadRestorationRunId) return false;

  for (
    let waitedMs = 0;
    waitedMs <= DEFERRED_PROJECT_RESTORE_MAX_PLAYBACK_WAIT_MS;
    waitedMs += DEFERRED_PROJECT_RESTORE_PLAYBACK_POLL_MS
  ) {
    if (runId !== postLoadRestorationRunId) return false;
    if (!isTimelineBusyForDeferredRestore()) {
      await yieldToBrowser();
      return true;
    }
    await sleep(DEFERRED_PROJECT_RESTORE_PLAYBACK_POLL_MS);
  }

  log.info('Deferred project cache restoration skipped while playback stayed active');
  return false;
}

async function runDeferredProjectCacheRestore(
  projectData: ProjectFile,
  hydrateFiles: boolean,
  runId: number,
): Promise<void> {
  if (!await waitForDeferredProjectRestoreWindow(runId)) return;

  const cachedThumbnailCandidates = projectData.media.filter(isProjectMediaThumbnailCandidate).length;
  if (cachedThumbnailCandidates > 0) {
    const restoredCount = await restoreCachedMediaThumbnails(projectData.media);
    log.info('Restored cached media thumbnails', { restoredCount, candidateCount: cachedThumbnailCandidates });
  }
  if (runId !== postLoadRestorationRunId || !hydrateFiles) return;

  if (projectData.media.length > EAGER_METADATA_RESTORE_MEDIA_LIMIT) {
    log.info('Skipping deferred metadata/cache restoration for large project', {
      mediaCount: projectData.media.length,
    });
    return;
  }

  log.info('Running deferred project metadata/cache restoration', {
    mediaCount: projectData.media.length,
  });
  await refreshMediaMetadata();
  if (runId !== postLoadRestorationRunId) return;
  await yieldToBrowser();
  await restoreDeferredMediaCacheState(projectData.media);
}

export async function runPostLoadRestoration(projectData: ProjectFile, hydrateFiles: boolean): Promise<void> {
  const runId = ++postLoadRestorationRunId;
  try {
    if (hydrateFiles) {
      setProjectLoadProgress({ phase: 'relink', percent: 72, message: 'Checking missing media', blocking: false });
      await autoRelinkFromRawFolder();
    } else {
      log.info('Skipping eager file restoration for native backend; media details are restored lazily');
    }

    await yieldToBrowser();

    completeProjectLoadProgress('Project ready');
    void runDeferredProjectCacheRestore(projectData, hydrateFiles, runId).catch((error: unknown) => {
      log.warn('Deferred project cache restoration finished with warnings', error);
    });
  } catch (error) {
    log.warn('Post-load project restoration finished with warnings', error);
    completeProjectLoadProgress('Project ready with warnings');
  }
}

async function autoRelinkFromRawFolder(): Promise<void> {
  if (!projectFileService.isProjectOpen()) return;

  const mediaState = useMediaStore.getState();
  const missingFiles = mediaState.files.filter(f => !f.liveInput && !f.file && !f.url);
  if (missingFiles.length === 0) {
    log.info(' No missing files to relink');
    return;
  }

  log.info('Attempting auto-relink for ' + missingFiles.length + ' missing files...');

  let rawFiles = await projectFileService.scanRawFolder();
  if (rawFiles.size === 0) {
    log.debug('Raw folder scan returned empty, retrying after delay...');
    await new Promise(resolve => setTimeout(resolve, 200));
    rawFiles = await projectFileService.scanRawFolder();
  }
  const projectFiles = await projectFileService.scanProjectFolder();
  const relinkCandidates = new Map(rawFiles);
  for (const [name, handle] of projectFiles) {
    if (!relinkCandidates.has(name)) relinkCandidates.set(name, handle);
  }

  if (relinkCandidates.size === 0) {
    log.info(' Project media folders are empty or not accessible');
    return;
  }

  log.debug('Found ' + relinkCandidates.size + ' candidate files in project folder', {
    rawFiles: rawFiles.size,
    projectFiles: projectFiles.size,
  });

  let relinkedCount = 0;
  const relinkedByProjectScan = new Set<string>();
  const candidateMap = await createRelinkCandidateMapFromHandles(relinkCandidates.values());

  for (const file of missingFiles) {
    const match = findRelinkMatch(file, candidateMap);
    if (!match) continue;

    const applied = await applyRelinkMatch(file.id, match, { generateThumbnails: false });
    if (applied) {
      relinkedByProjectScan.add(file.id);
      relinkedCount++;
      log.debug('Auto-relinked from project folder', { name: file.name, kind: match.kind });
    }
  }

  let fallbackRelinkedCount = 0;
  const updatedFiles = [...useMediaStore.getState().files];
  for (let i = 0; i < updatedFiles.length; i++) {
    const file = updatedFiles[i];
    if (file.file || file.url) continue;
    if (relinkedByProjectScan.has(file.id)) continue;

    try {
      const storedHandle = await projectDB.getStoredHandle('media_' + file.id);
      if (storedHandle && storedHandle.kind === 'file') {
        const fileHandle = storedHandle as FileSystemFileHandle;
        const permission = await fileHandle.queryPermission({ mode: 'read' });

        if (permission === 'granted') {
          const fileObj = await fileHandle.getFile();
          const url = createPrimaryMediaObjectUrl(file.id, fileObj);
          const sourceReplacementPatch = await createMediaSourceReplacementPatch(fileObj);

          fileSystemService.storeFileHandle(file.id, fileHandle);
          updatedFiles[i] = { ...file, ...sourceReplacementPatch, file: fileObj, url, hasFileHandle: true };

          relinkedCount++;
          fallbackRelinkedCount++;
          log.debug('Auto-relinked from IndexedDB handle: ' + file.name);
        }
      }
    } catch (e) {
      // Silently ignore - will need manual reload
    }
  }

  if (relinkedCount > 0) {
    if (fallbackRelinkedCount > 0) {
      useMediaStore.setState({ files: updatedFiles });
      await new Promise(resolve => setTimeout(resolve, 50));

      for (const file of updatedFiles) {
        if (file.file && !relinkedByProjectScan.has(file.id)) {
          await updateTimelineClips(file.id, file.file, { generateThumbnails: false, fileHash: file.fileHash });
        }
      }
    }

    log.info('Auto-relinked ' + relinkedCount + '/' + missingFiles.length + ' files from project folder or stored handles');
    await reloadNestedCompositionClips();
  } else {
    log.info(' No files could be auto-relinked from project folder');
  }
}
