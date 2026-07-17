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
  normalizeLoadedTransitionCompositions,
} from './load/loadTimelineHydration';
import {
  createGeneratedMediaItemsForLoad,
  createSignalHydrationStateForLoad,
} from './load/loadSignalsHydration';
import { hydrateDockFlashboardAndWorkspaceFromProject } from './load/loadDockFlashboardHydration';
import { runPostLoadRestoration } from './load/loadRuntimeRelink';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import { liveInputRuntime } from '../mediaRuntime/liveInputRuntime';
import { collectUsedLiveInputIds } from '../liveInputTimeline';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';

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

function normalizeLoadedProjectCompositionState(): void {
  const mediaState = useMediaStore.getState();
  const existingIds = new Set(mediaState.compositions.map((composition) => composition.id));
  const visibleIds = new Set(mediaState.compositions.filter(isUserVisibleComposition).map((composition) => composition.id));
  const fallbackActiveId = mediaState.compositions.find(isUserVisibleComposition)?.id ?? mediaState.compositions[0]?.id ?? null;
  const activeCompositionId =
    mediaState.activeCompositionId && existingIds.has(mediaState.activeCompositionId)
      ? mediaState.activeCompositionId
      : fallbackActiveId;
  const openCompositionIds = [
    ...(activeCompositionId ? [activeCompositionId] : []),
    ...mediaState.openCompositionIds.filter((id) => id !== activeCompositionId && existingIds.has(id)),
  ];
  const slotAssignments = Object.fromEntries(
    Object.entries(mediaState.slotAssignments).filter(([compositionId]) => visibleIds.has(compositionId)),
  );
  const slotClipSettings = Object.fromEntries(
    Object.entries(mediaState.slotClipSettings).filter(([compositionId]) => visibleIds.has(compositionId)),
  );

  useMediaStore.setState({
    activeCompositionId,
    openCompositionIds,
    slotAssignments,
    slotClipSettings,
    selectedSlotCompositionId: mediaState.selectedSlotCompositionId && visibleIds.has(mediaState.selectedSlotCompositionId)
      ? mediaState.selectedSlotCompositionId
      : null,
  });
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
      liveInputRuntime.clear();
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
      normalizeLoadedTransitionCompositions();
      normalizeLoadedProjectCompositionState();

      const mediaStateAfterNormalization = useMediaStore.getState();
      await hydrateActiveCompositionTimeline(
        { ...projectData, activeCompositionId: mediaStateAfterNormalization.activeCompositionId },
        mediaStateAfterNormalization.compositions,
        timelineStore,
      );

      setProjectLoadProgress({ phase: 'ui', percent: 58, message: 'Restoring workspace', blocking: true });
      await hydrateDockFlashboardAndWorkspaceFromProject(projectData);

      const restoredMediaState = useMediaStore.getState();
      const usedLiveInputIds = new Set(collectUsedLiveInputIds(
        useTimelineStore.getState().clips,
        restoredMediaState.compositions,
      ));
      const reconnectRequiredIds = restoredMediaState.files.flatMap((file) => (
        file.liveInput &&
        file.liveInput.kind !== 'composition-feedback' &&
        usedLiveInputIds.has(file.id)
          ? [file.id]
          : []
      ));
      liveInputRuntime.setReconnectRequiredIds(reconnectRequiredIds);
      if (reconnectRequiredIds.length > 0) {
        useDockStore.getState().activatePanelType('clip-properties');
      }

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
