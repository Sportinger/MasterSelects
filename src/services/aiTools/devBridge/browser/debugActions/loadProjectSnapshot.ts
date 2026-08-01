import { useMediaStore, type MediaFile } from '../../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../../stores/timeline';
import type { ProjectFile } from '../../../../projectFileService';
import {
  clearProjectTimelineForLoad,
  convertProjectCompositionToStore,
  hydrateActiveCompositionTimeline,
  reloadNestedCompositionClips,
} from '../../../../project/load/loadTimelineHydration';
import {
  convertProjectFolderToStore,
  normalizeFolderParents,
  normalizeItemFolderParents,
} from '../../../../project/load/loadMediaHydration';
import { createGeneratedMediaItemsForLoad } from '../../../../project/load/loadSignalsHydration';
import { renderHostPort } from '../../../../render/renderHostPort';
import { handleImportLocalFiles } from '../../../handlers/media';

interface SnapshotMediaSource {
  projectMediaId: string;
  path: string;
}

interface ImportedMediaResult {
  id: string;
  name: string;
  path: string;
}

interface ImportLocalFilesResult {
  imported?: ImportedMediaResult[];
  errors?: Array<{ path: string; error: string }>;
}

/**
 * Dev-only project hydration for Playwright reference snapshots.
 *
 * It imports real files through the normal local-file broker, then applies the
 * captured project model to the stores without requiring the optional Native
 * Helper. The checked snapshot remains read-only and no project is opened for
 * autosave.
 */
export async function loadProjectSnapshotForDebug(args: Record<string, unknown>) {
  const project = parseProject(args.project);
  const mediaSources = parseMediaSources(args.mediaSources);
  const expectedMediaIds = new Set(project.media.map((media) => media.id));
  if (
    mediaSources.length !== project.media.length
    || mediaSources.some((source) => !expectedMediaIds.has(source.projectMediaId))
  ) {
    return { success: false, error: 'Snapshot media mapping does not match the project media contract.' };
  }

  const mediaStore = useMediaStore.getState();
  mediaStore.newProject();
  await useTimelineStore.getState().loadState(undefined);

  const importResult = await handleImportLocalFiles({
    paths: mediaSources.map((source) => source.path),
    addToTimeline: false,
  }, useMediaStore.getState(), 'devBridge');
  if (!importResult.success) {
    return {
      success: false,
      error: importResult.error ?? 'Reference snapshot media import failed.',
      data: importResult.data,
    };
  }

  const importData = importResult.data as ImportLocalFilesResult | undefined;
  const imported = importData?.imported ?? [];
  if (imported.length !== mediaSources.length) {
    return {
      success: false,
      error: `Reference snapshot imported ${imported.length}/${mediaSources.length} media files.`,
      data: { imported, errors: importData?.errors },
    };
  }

  const runtimeMediaById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const runtimeIdByProjectId = new Map<string, string>();
  mediaSources.forEach((source, index) => {
    const importedId = imported[index]?.id;
    if (importedId) runtimeIdByProjectId.set(source.projectMediaId, importedId);
  });

  const projectMediaById = new Map(project.media.map((media) => [media.id, media]));
  const files = mediaSources.map((source): MediaFile => {
    const importedId = runtimeIdByProjectId.get(source.projectMediaId);
    const runtimeFile = importedId ? runtimeMediaById.get(importedId) : undefined;
    const projectMedia = projectMediaById.get(source.projectMediaId);
    if (!runtimeFile || !projectMedia) {
      throw new Error(`Imported snapshot media could not be resolved: ${source.projectMediaId}`);
    }
    return {
      ...runtimeFile,
      name: projectMedia.name,
      parentId: projectMedia.folderId,
      duration: projectMedia.duration,
      width: projectMedia.width,
      height: projectMedia.height,
      fps: projectMedia.frameRate,
      fileHash: projectMedia.fileHash,
    };
  });

  const hydratedProject = structuredClone(project);
  for (const composition of hydratedProject.compositions) {
    for (const clip of composition.clips) {
      const runtimeMediaId = runtimeIdByProjectId.get(clip.mediaId);
      if (runtimeMediaId) clip.mediaId = runtimeMediaId;
    }
  }

  const folders = normalizeFolderParents(convertProjectFolderToStore(hydratedProject.folders));
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const compositions = normalizeItemFolderParents(
    convertProjectCompositionToStore(
      hydratedProject.compositions,
      hydratedProject.uiState?.compositionViewState,
    ),
    validFolderIds,
    'compositions',
  );
  const normalizedFiles = normalizeItemFolderParents(files, validFolderIds, 'files');
  const generatedItems = createGeneratedMediaItemsForLoad(hydratedProject, validFolderIds);

  useMediaStore.setState({
    files: normalizedFiles,
    compositions,
    folders,
    ...generatedItems,
    activeCompositionId: hydratedProject.activeCompositionId,
    openCompositionIds: hydratedProject.openCompositionIds,
    expandedFolderIds: hydratedProject.expandedFolderIds,
    slotAssignments: hydratedProject.slotAssignments ?? {},
    slotClipSettings: hydratedProject.slotClipSettings ?? {},
    selectedIds: [],
    selectedSlotCompositionId: null,
  });
  useMediaStore.getState().setProjectName(hydratedProject.name);

  const timelineStore = clearProjectTimelineForLoad();
  await hydrateActiveCompositionTimeline(hydratedProject, compositions, timelineStore);
  await reloadNestedCompositionClips();
  useTimelineStore.getState().invalidateCache();
  renderHostPort.requestRender();

  return {
    success: true,
    data: {
      projectName: hydratedProject.name,
      activeCompositionId: hydratedProject.activeCompositionId,
      mediaCount: normalizedFiles.length,
      compositionCount: compositions.length,
      imported,
    },
  };
}

function parseProject(value: unknown): ProjectFile {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.name !== 'string'
    || !Array.isArray(value.media)
    || !Array.isArray(value.compositions)
    || !Array.isArray(value.folders)
    || !Array.isArray(value.openCompositionIds)
    || !Array.isArray(value.expandedFolderIds)
  ) {
    throw new Error('Invalid Playwright project snapshot payload.');
  }
  return value as unknown as ProjectFile;
}

function parseMediaSources(value: unknown): SnapshotMediaSource[] {
  if (!Array.isArray(value)) throw new Error('Missing Playwright snapshot media sources.');
  return value.map((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.projectMediaId !== 'string'
      || typeof entry.path !== 'string'
      || !entry.projectMediaId.trim()
      || !entry.path.trim()
    ) {
      throw new Error('Invalid Playwright snapshot media source.');
    }
    return {
      projectMediaId: entry.projectMediaId,
      path: entry.path,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
