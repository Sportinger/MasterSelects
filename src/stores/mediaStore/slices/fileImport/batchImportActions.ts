import { bindEditorAsyncStore, captureEditorAsyncMutation, discardUnpublishedMedia, type EditorAsyncMutation } from '../../../../services/project/repository/transaction/editorAsyncMutation';
import { withProjectArtifactWriteBatch } from '../../../../services/project/projectArtifactWriteBatch';
import type { FileImportResult, MediaFile, MediaSliceCreator, MediaState } from '../../types';
import { processGaussianSplatSequenceImport } from '../../helpers/gaussianSplatSequenceImport';
import { processModelSequenceImport } from '../../helpers/modelSequenceImport';
import { processImport } from '../../helpers/importPipeline';
import { fileSystemService } from '../../../../services/fileSystemService';
import { projectDB } from '../../../../services/projectDB';
import type { FileImportActions } from '../fileImportSlice';
import { commitSignalAsset } from './signalAssetCommit';
import {
  resolveImportEntry,
  runSignalImport,
  type ResolvedImportEntry,
  type ResolvedLegacyImportEntry,
  type ResolvedSignalImportEntry,
} from './importPlanning';
import {
  createGaussianSplatSequencePlaceholder,
  createPlaceholder,
  createSequencePlaceholder,
  finalizeImportedMediaFile,
  updatePlaceholderImportProgress,
} from './placeholderLifecycle';
import { splitModelSequenceEntries } from './sequencePlanning';
import { fileImportLog as log } from './log';
import {
  importPremiereProject,
  isPremiereProjectFile,
  type PremiereProjectImportProgress,
} from '../../../../importers/premiereProject';
import { requestPremiereSequenceSelection } from '../../../../importers/premiere/premiereSequenceSelectionRuntime';
import { requestRelinkDialog } from '../../../../services/project/relinkDialogRuntime';
import {
  trackMediaImportPickerCancelled,
  withMediaImportAnalytics,
  type MediaImportAnalyticsContext,
} from '../../../../services/productAnalytics/mediaImportEvents';

type MediaSliceSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)
) => void;

type MediaSliceGet = () => MediaState;

async function commitPremiereProjects(
  set: MediaSliceSet,
  get: MediaSliceGet,
  files: File[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  parentId?: string | null,
): Promise<void> {
  for (const file of files) {
    binding.assertCurrent();
    const updateProgress = (progress: PremiereProjectImportProgress) => {
      set({
        projectLoadProgress: {
          active: progress.phase !== 'complete',
          phase: progress.phase === 'complete' ? 'idle' : 'media',
          percent: progress.percent,
          message: 'Importing Premiere project',
          detail: `${file.name} — ${progress.detail}`,
          blocking: false,
        },
      });
    };
    try {
      updateProgress({ phase: 'reading', percent: 0, detail: 'Starting memory-safe import' });
      const result = await importPremiereProject(file, get().files, parentId ?? null, {
        onProgress: updateProgress,
        selectSequences: (summary) => requestPremiereSequenceSelection(file.name, summary),
      });
      if (!binding.isCurrent()) { result.mediaFiles.forEach(file => discardUnpublishedMedia(file)); throw new DOMException('Premiere import project changed', 'AbortError'); }
      binding.run(() => set((state) => {
        const existingFolderIds = new Set(state.folders.map((folder) => folder.id));
        const existingFileIds = new Set(state.files.map((media) => media.id));
        const existingCompositionIds = new Set(state.compositions.map((composition) => composition.id));
        const existingMediaUpdates = new Map(result.existingMediaUpdates.map((update) => [update.id, update]));
        return {
          folders: existingFolderIds.has(result.folder.id) ? state.folders : [...state.folders, result.folder],
          files: [
            ...state.files.map((media) => {
              const update = existingMediaUpdates.get(media.id);
              return update ? { ...media, ...update } : media;
            }),
            ...result.mediaFiles.filter((media) => !existingFileIds.has(media.id)),
          ],
          compositions: [
            ...state.compositions,
            ...result.compositions.filter((composition) => !existingCompositionIds.has(composition.id)),
          ],
          expandedFolderIds: state.expandedFolderIds.includes(result.folder.id)
            ? state.expandedFolderIds
            : [...state.expandedFolderIds, result.folder.id],
        };
      }));
      log.info(`Imported Premiere project: ${file.name}`, {
        compositions: result.compositions.length,
        missingMedia: result.mediaFiles.length,
        reusedMedia: result.reusedMediaCount,
        proxyMedia: result.proxyMediaCount,
        skippedClips: result.skippedClipCount,
        speedAdjustedClips: result.speedAdjustedClipCount,
      });
      if (result.proxyMediaCount > 0) {
        requestRelinkDialog();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.info(`Premiere project import cancelled: ${file.name}`);
      } else {
        log.error(`Premiere project import failed: ${file.name}`, error);
        analytics.trackFailure(error, 'project_processing');
      }
    } finally {
      set({
        projectLoadProgress: {
          active: false,
          phase: 'idle',
          percent: 0,
          message: '',
          blocking: false,
        },
      });
    }
  }
}

function splitResolvedEntries(entries: ResolvedImportEntry[]): {
  signalEntries: ResolvedSignalImportEntry[];
  modelSequences: ReturnType<typeof splitModelSequenceEntries>['modelSequences'];
  gaussianSplatSequences: ReturnType<typeof splitModelSequenceEntries>['gaussianSplatSequences'];
  singles: ResolvedLegacyImportEntry[];
} {
  const signalEntries = entries.filter((entry): entry is ResolvedSignalImportEntry => entry.route === 'signal');
  const legacyEntries = entries.filter((entry): entry is ResolvedLegacyImportEntry => entry.route === 'legacy-media');
  return {
    signalEntries,
    ...splitModelSequenceEntries(legacyEntries),
  };
}

function addLegacyPlaceholders(
  set: MediaSliceSet,
  groups: ReturnType<typeof splitResolvedEntries>,
  parentId?: string | null,
): void {
  set((state) => ({
    files: [
      ...state.files,
      ...groups.singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
      ...groups.modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ...groups.gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
    ],
  }));
}

async function importSignalEntries(
  set: MediaSliceSet,
  entries: ResolvedSignalImportEntry[],
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  parentId?: string | null,
): Promise<void> {
  for (const entry of entries) {
    binding.assertCurrent();
    try {
      const signalAsset = await runSignalImport(entry, parentId);
      binding.assertCurrent();
      binding.run(() => commitSignalAsset(set, signalAsset));
      imported.push(signalAsset);
    } catch (err) {
      log.error(`Signal import failed: ${entry.file.name}`, err);
      analytics.trackFailure(err, 'signal_processing');
    }
  }
}

async function importModelSequences(
  set: MediaSliceSet,
  get: MediaSliceGet,
  sequences: ReturnType<typeof splitModelSequenceEntries>['modelSequences'],
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  options: { parentId?: string | null; includeParentId: boolean },
): Promise<void> {
  for (const sequence of sequences) {
    binding.assertCurrent();
    const sequenceId = sequence.entries[0]!.id;
    try {
      let lastProgress = -1;
      const result = await processModelSequenceImport({
        id: sequenceId,
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        sequence,
        onProgress: (progress) => {
          const normalized = Math.max(0, Math.min(100, Math.round(progress)));
          if (normalized === lastProgress) return;
          lastProgress = normalized;
          set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
        },
      });
      if (!binding.isCurrent() || get().files.find(candidate => candidate.id === sequenceId)?.file !== sequence.entries[0]?.file) { discardUnpublishedMedia(result); throw new DOMException('Sequence import target changed', 'AbortError'); }
      finalizeImportedMediaFile(set, get, sequenceId, result);
      imported.push(result);
    } catch (err) {
      log.error(`Sequence import failed: ${sequence.displayName}`, err);
      analytics.trackFailure(err, 'sequence_processing', sequence.entries.length);
      set((state) => ({
        files: state.files.filter((f) => f.id !== sequenceId || f.file !== sequence.entries[0]?.file),
      }));
    }
  }
}

async function importGaussianSplatSequences(
  set: MediaSliceSet,
  get: MediaSliceGet,
  sequences: ReturnType<typeof splitModelSequenceEntries>['gaussianSplatSequences'],
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  options: { parentId?: string | null; includeParentId: boolean },
): Promise<void> {
  for (const sequence of sequences) {
    binding.assertCurrent();
    const sequenceId = sequence.entries[0]!.id;
    try {
      let lastProgress = -1;
      const result = await processGaussianSplatSequenceImport({
        id: sequenceId,
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        sequence,
        onProgress: (progress) => {
          const normalized = Math.max(0, Math.min(100, Math.round(progress)));
          if (normalized === lastProgress) return;
          lastProgress = normalized;
          set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
        },
      });
      if (!binding.isCurrent() || get().files.find(candidate => candidate.id === sequenceId)?.file !== sequence.entries[0]?.file) { discardUnpublishedMedia(result); throw new DOMException('Sequence import target changed', 'AbortError'); }
      finalizeImportedMediaFile(set, get, sequenceId, result);
      imported.push(result);
    } catch (err) {
      log.error(`Sequence import failed: ${sequence.displayName}`, err);
      analytics.trackFailure(err, 'sequence_processing', sequence.entries.length);
      set((state) => ({
        files: state.files.filter((f) => f.id !== sequenceId || f.file !== sequence.entries[0]?.file),
      }));
    }
  }
}

async function importPlainSinglesInBatches(
  set: MediaSliceSet,
  get: MediaSliceGet,
  singles: ResolvedLegacyImportEntry[],
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  parentId?: string | null,
): Promise<void> {
  const batchSize = 3;
  for (let i = 0; i < singles.length; i += batchSize) {
    binding.assertCurrent();
    const batch = singles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async ({ file, id, type }) => {
        try {
          const result = await processImport({
            file,
            id,
            parentId,
            generateThumbnail: false,
            typeOverride: type,
          });
          if (!binding.isCurrent() || get().files.find(candidate => candidate.id === id)?.file !== file) { discardUnpublishedMedia(result.mediaFile); throw new DOMException('Media import target changed', 'AbortError'); }
          finalizeImportedMediaFile(set, get, id, result.mediaFile);
          return result.mediaFile;
        } catch (err) {
          log.error(`Import failed: ${file.name}`, err);
          analytics.trackFailure(err, 'media_processing');
          set((state) => ({
            files: state.files.filter((f) => f.id !== id || f.file !== file),
          }));
          return null;
        }
      })
    );
    imported.push(...results.filter((result): result is MediaFile => result !== null));
  }
}

async function importHandleSingles(
  set: MediaSliceSet,
  get: MediaSliceGet,
  singles: ResolvedLegacyImportEntry[],
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  options: { parentId?: string | null; includeParentId: boolean; includeAbsolutePath: boolean },
): Promise<void> {
  for (const { file, handle, absolutePath, id, type } of singles) {
    binding.assertCurrent();
    if (handle) {
      await analytics.withStage('handle_storage', async () => {
        binding.assertCurrent();
        fileSystemService.storeFileHandle(id, handle);
        await projectDB.storeHandle(`media_${id}`, handle);
        log.debug('Stored file handle for ID:', id);
      });
    }

    binding.assertCurrent();
    try {
      const importResult = await processImport({
        file,
        id,
        handle,
        ...(options.includeAbsolutePath ? { absolutePath } : {}),
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        generateThumbnail: false,
        typeOverride: type,
      });
      if (!binding.isCurrent() || get().files.find(candidate => candidate.id === id)?.file !== file) { discardUnpublishedMedia(importResult.mediaFile); throw new DOMException('Media import target changed', 'AbortError'); }
      finalizeImportedMediaFile(set, get, id, importResult.mediaFile);
      imported.push(importResult.mediaFile);
    } catch (err) {
      log.error(`Import failed: ${file.name}`, err);
      analytics.trackFailure(err, 'media_processing');
      set((state) => ({
        files: state.files.filter((f) => f.id !== id || f.file !== file),
      }));
    }
  }
}

async function importGroupedLegacyEntries(
  set: MediaSliceSet,
  get: MediaSliceGet,
  groups: ReturnType<typeof splitResolvedEntries>,
  imported: FileImportResult[],
  analytics: MediaImportAnalyticsContext,
  binding: EditorAsyncMutation,
  options: {
    parentId?: string | null;
    includeParentId: boolean;
    handleSingles: boolean;
    includeAbsolutePath?: boolean;
  },
): Promise<void> {
  await importModelSequences(set, get, groups.modelSequences, imported, analytics, binding, options);
  await importGaussianSplatSequences(set, get, groups.gaussianSplatSequences, imported, analytics, binding, options);

  if (options.handleSingles) {
    await importHandleSingles(set, get, groups.singles, imported, analytics, binding, {
      parentId: options.parentId,
      includeParentId: options.includeParentId,
      includeAbsolutePath: options.includeAbsolutePath === true,
    });
    return;
  }

  await importPlainSinglesInBatches(set, get, groups.singles, imported, analytics, binding, options.parentId);
}

export const createBatchFileImportActions: MediaSliceCreator<Pick<
  FileImportActions,
  'importFiles' | 'importFilesWithPicker' | 'importFilesWithHandles'
>> = (baseSet, baseGet) => ({
  importFiles: async (files: FileList | File[], parentId?: string | null) => {
    const binding = captureEditorAsyncMutation('Import media batch');
    const { set, get } = bindEditorAsyncStore(baseSet, baseGet, binding);
    const fileArray = Array.from(files);
    return withProjectArtifactWriteBatch(() => withMediaImportAnalytics(fileArray, 'input_or_drop', async (analytics) => {
      const premiereProjects = fileArray.filter(isPremiereProjectFile);
      const regularFiles = fileArray.filter((file) => !isPremiereProjectFile(file));
      const imported: FileImportResult[] = [];

      const entries = await analytics.withStage('planning', async () => (
        Promise.all(regularFiles.map(async (file) => resolveImportEntry(file)))
      ));
      binding.assertCurrent();
      const groups = splitResolvedEntries(entries);

      addLegacyPlaceholders(set, groups, parentId);
      await importSignalEntries(set, groups.signalEntries, imported, analytics, binding, parentId);
      await importGroupedLegacyEntries(set, get, groups, imported, analytics, binding, {
        parentId,
        includeParentId: true,
        handleSingles: false,
      });
      await commitPremiereProjects(set, get, premiereProjects, analytics, binding, parentId);

      return imported;
    }));
  },

  importFilesWithPicker: async () => {
    const binding = captureEditorAsyncMutation('Import media batch');
    const { set, get } = bindEditorAsyncStore(baseSet, baseGet, binding);
    const result = await fileSystemService.pickFiles();
    binding.assertCurrent();
    if (!result || result.length === 0) {
      trackMediaImportPickerCancelled();
      return [];
    }

    const selectedFiles = result.map(({ file }) => file);
    return withProjectArtifactWriteBatch(() => withMediaImportAnalytics(selectedFiles, 'picker', async (analytics) => {
      const imported: FileImportResult[] = [];
      const premiereProjects = result.filter(({ file }) => isPremiereProjectFile(file)).map(({ file }) => file);
      const regularFiles = result.filter(({ file }) => !isPremiereProjectFile(file));
      const entries = await analytics.withStage('planning', async () => (
        Promise.all(regularFiles.map(async ({ file, handle }) => (
          resolveImportEntry(file, { handle })
        )))
      ));
      binding.assertCurrent();
      const groups = splitResolvedEntries(entries);

      addLegacyPlaceholders(set, groups);
      await importSignalEntries(set, groups.signalEntries, imported, analytics, binding);
      await importGroupedLegacyEntries(set, get, groups, imported, analytics, binding, {
        includeParentId: false,
        handleSingles: true,
      });
      await commitPremiereProjects(set, get, premiereProjects, analytics, binding);

      return imported;
    }));
  },

  importFilesWithHandles: async (filesWithHandles, parentId?: string | null) => {
    const binding = captureEditorAsyncMutation('Import media batch');
    const { set, get } = bindEditorAsyncStore(baseSet, baseGet, binding);
    const selectedFiles = filesWithHandles.map(({ file }) => file);
    return withProjectArtifactWriteBatch(() => withMediaImportAnalytics(selectedFiles, 'handles', async (analytics) => {
      const imported: FileImportResult[] = [];
      const premiereProjects = filesWithHandles
        .filter(({ file }) => isPremiereProjectFile(file))
        .map(({ file }) => file);
      const regularFiles = filesWithHandles.filter(({ file }) => !isPremiereProjectFile(file));

      const entries = await analytics.withStage('planning', async () => (
        Promise.all(regularFiles.map(async ({ file, handle, absolutePath }) => (
          resolveImportEntry(file, { handle, absolutePath })
        )))
      ));
      binding.assertCurrent();
      const groups = splitResolvedEntries(entries);

      addLegacyPlaceholders(set, groups, parentId);
      await importSignalEntries(set, groups.signalEntries, imported, analytics, binding, parentId);
      await importGroupedLegacyEntries(set, get, groups, imported, analytics, binding, {
        parentId,
        includeParentId: true,
        handleSingles: true,
        includeAbsolutePath: true,
      });
      await commitPremiereProjects(set, get, premiereProjects, analytics, binding, parentId);

      return imported;
    }));
  },
});
