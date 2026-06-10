import { Logger } from '../../logger';
import { useMediaStore } from '../../../stores/mediaStore';
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

export async function runPostLoadRestoration(projectData: ProjectFile, hydrateFiles: boolean): Promise<void> {
  try {
    if (hydrateFiles) {
      setProjectLoadProgress({ phase: 'relink', percent: 72, message: 'Checking missing media', blocking: false });
      await autoRelinkFromRawFolder();
    } else {
      log.info('Skipping eager file restoration for native backend; media details are restored lazily');
    }

    await yieldToBrowser();

    const cachedThumbnailCandidates = projectData.media.filter(isProjectMediaThumbnailCandidate).length;
    if (cachedThumbnailCandidates > 0) {
      setProjectLoadProgress({
        phase: 'thumbnails',
        percent: 78,
        message: 'Restoring cached thumbnails',
        itemsDone: 0,
        itemsTotal: cachedThumbnailCandidates,
        blocking: false,
      });
      const restoredCount = await restoreCachedMediaThumbnails(projectData.media, (done, total, name) => {
        const ratio = total > 0 ? done / total : 1;
        setProjectLoadProgress({
          phase: 'thumbnails',
          percent: 78 + ratio * 8,
          message: 'Restoring cached thumbnails',
          detail: name,
          itemsDone: done,
          itemsTotal: total,
          blocking: false,
        });
      });
      log.info('Restored cached media thumbnails', { restoredCount, candidateCount: cachedThumbnailCandidates });
    }

    if (!hydrateFiles) {
      completeProjectLoadProgress('Project ready');
      return;
    }

    const eagerMetadataLimit = 120;
    if (projectData.media.length <= eagerMetadataLimit) {
      setProjectLoadProgress({ phase: 'metadata', percent: 86, message: 'Refreshing media metadata', blocking: false });
      await refreshMediaMetadata((done, total, name) => {
        const ratio = total > 0 ? done / total : 1;
        setProjectLoadProgress({
          phase: 'metadata',
          percent: 86 + ratio * 6,
          message: 'Refreshing media metadata',
          detail: name,
          itemsDone: done,
          itemsTotal: total,
          blocking: false,
        });
      });

      setProjectLoadProgress({
        phase: 'caches',
        percent: 92,
        message: 'Checking project caches',
        itemsDone: 0,
        itemsTotal: projectData.media.length,
        blocking: false,
      });
      await restoreDeferredMediaCacheState(projectData.media, (done, total, name, itemProgress) => {
        const ratio = total > 0 ? (done + (itemProgress ?? 0)) / total : 1;
        setProjectLoadProgress({
          phase: 'caches',
          percent: 92 + ratio * 7,
          message: 'Checking project caches',
          detail: name,
          itemsDone: done,
          itemsTotal: total,
          blocking: false,
        });
      });
    } else {
      log.info('Skipping eager metadata/cache restoration for large project', { mediaCount: projectData.media.length });
    }

    completeProjectLoadProgress('Project ready');
  } catch (error) {
    log.warn('Post-load project restoration finished with warnings', error);
    completeProjectLoadProgress('Project ready with warnings');
  }
}

async function autoRelinkFromRawFolder(): Promise<void> {
  if (!projectFileService.isProjectOpen()) return;

  const mediaState = useMediaStore.getState();
  const missingFiles = mediaState.files.filter(f => !f.file && !f.url);
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
