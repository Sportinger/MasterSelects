// Project Load - load project file data into stores + background restoration

import { Logger } from '../logger';
import { useMediaStore, type Composition } from '../../stores/mediaStore';
import { type ProjectFile } from '../projectFileService';
import { withProjectStoreSyncGuard } from './projectSave';
import {
  revokeAllMediaObjectUrls,
  revokeMediaFileObjectUrls,
} from './mediaObjectUrlManager';
import { readProjectDataForLoad } from './load/loadParse';
import {
  completeProjectLoadProgress,
  failProjectLoadProgress,
  setProjectLoadProgress,
} from './load/loadProgress';
import {
  convertProjectFolderToStore,
  convertProjectMediaToStore,
  normalizeFolderParents,
  normalizeItemFolderParents,
} from './load/loadMediaHydration';
import {
  clearProjectTimelineForLoad,
  convertProjectCompositionToStore,
  hydrateActiveCompositionTimeline,
} from './load/loadTimelineHydration';
import {
  createGeneratedMediaItemsForLoad,
  createSignalHydrationStateForLoad,
} from './load/loadSignalsHydration';
import { hydrateDockFlashboardAndWorkspaceFromProject } from './load/loadDockFlashboardHydration';
import { runPostLoadRestoration } from './load/loadRuntimeRelink';

export { setProjectLoadProgress } from './load/loadProgress';
export { reloadNestedCompositionClips } from './load/loadTimelineHydration';

const log = Logger.create('ProjectSync');

function createDefaultComposition(projectData: ProjectFile): Composition {
  return {
    id: 'comp-' + Date.now(),
    name: 'Comp 1',
    type: 'composition',
    parentId: null,
    createdAt: Date.now(),
    width: projectData.settings.width,
    height: projectData.settings.height,
    frameRate: projectData.settings.frameRate,
    duration: 60,
    backgroundColor: '#000000',
  };
}

export async function loadProjectToStores(): Promise<void> {
  let backgroundProjectData: ProjectFile | null = null;
  let backgroundHydrateFiles = true;

  setProjectLoadProgress({
    phase: 'opening',
    percent: 5,
    message: 'Opening project',
    blocking: true,
  });

  try {
    await withProjectStoreSyncGuard(async () => {
      const parsedProject = readProjectDataForLoad();
      if (!parsedProject) return;

      const { projectData, hydrateFiles } = parsedProject;
      backgroundProjectData = projectData;
      backgroundHydrateFiles = hydrateFiles;

      setProjectLoadProgress({
        phase: 'media',
        percent: 12,
        message: 'Loading media references',
        itemsDone: 0,
        itemsTotal: projectData.media.length,
        blocking: true,
      });
      for (const currentFile of useMediaStore.getState().files) {
        revokeMediaFileObjectUrls(currentFile);
      }
      revokeAllMediaObjectUrls();

      const loadedFiles = await convertProjectMediaToStore(projectData.media, {
        hydrateFiles,
        deferCacheChecks: true,
        onProgress: (done, total, name) => {
          const mediaPercent = total > 0 ? done / total : 1;
          setProjectLoadProgress({
            phase: 'media',
            percent: 12 + mediaPercent * 24,
            message: 'Loading media references',
            detail: name,
            itemsDone: done,
            itemsTotal: total,
            blocking: true,
          });
        },
      });

      const folders = normalizeFolderParents(convertProjectFolderToStore(projectData.folders));
      const validFolderIds = new Set(folders.map((folder) => folder.id));
      const files = normalizeItemFolderParents(loadedFiles, validFolderIds, 'files');

      setProjectLoadProgress({
        phase: 'timeline',
        percent: 40,
        message: 'Restoring timeline',
        blocking: true,
      });
      const compositions = normalizeItemFolderParents(
        convertProjectCompositionToStore(projectData.compositions, projectData.uiState?.compositionViewState),
        validFolderIds,
        'compositions',
      );

      const timelineStore = clearProjectTimelineForLoad();
      const generatedItems = createGeneratedMediaItemsForLoad(projectData, validFolderIds);
      const signalState = createSignalHydrationStateForLoad(projectData, validFolderIds);

      useMediaStore.setState({
        files,
        compositions: compositions.length > 0 ? compositions : [createDefaultComposition(projectData)],
        folders,
        ...generatedItems,
        ...signalState,
        activeCompositionId: projectData.activeCompositionId,
        openCompositionIds: projectData.openCompositionIds || [],
        expandedFolderIds: projectData.expandedFolderIds || [],
        slotAssignments: projectData.slotAssignments || {},
        slotClipSettings: projectData.slotClipSettings || {},
        selectedSlotCompositionId: null,
      });

      await hydrateActiveCompositionTimeline(projectData, compositions, timelineStore);

      setProjectLoadProgress({ phase: 'ui', percent: 58, message: 'Restoring workspace', blocking: true });
      await hydrateDockFlashboardAndWorkspaceFromProject(projectData);

      setProjectLoadProgress({
        phase: 'ready',
        percent: 70,
        message: 'Project visible',
        detail: projectData.name,
        blocking: false,
      });

      log.info(' Loaded project to stores:', projectData.name);
    });

    if (backgroundProjectData) {
      void runPostLoadRestoration(backgroundProjectData, backgroundHydrateFiles);
    } else {
      completeProjectLoadProgress();
    }
  } catch (error) {
    failProjectLoadProgress(error);
    throw error;
  }
}
