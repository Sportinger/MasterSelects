import { withProjectArtifactWriteBatch } from '../../../../services/project/projectArtifactWriteBatch';
import type { MediaSliceCreator, MediaState } from '../../types';
import { generateId, processImport } from '../../helpers/importPipeline';
import type { FileImportActions, ImportFileOptions } from '../fileImportSlice';
import type { FileManageActions } from '../fileManageSlice';
import { commitSignalAsset } from './signalAssetCommit';
import { resolveImportEntry, runSignalImport } from './importPlanning';
import {
  createPlaceholder,
  finalizeImportedMediaFile,
  startMediaFileAudioProxyGeneration,
  startVideoProxyGenerationIfNeeded,
} from './placeholderLifecycle';
import { fileImportLog as log } from './log';

function importMetadata(options?: ImportFileOptions) {
  return {
    ...(options?.stemInfo ? { stemInfo: structuredClone(options.stemInfo) } : {}),
    ...(options?.externalOrigin ? { externalOrigin: structuredClone(options.externalOrigin) } : {}),
  };
}

export const createSingleFileImportActions: MediaSliceCreator<Pick<FileImportActions, 'importFile'>> = (
  set,
  get,
) => ({
  importFile: async (file: File, parentId?: string | null, options?: ImportFileOptions) => withProjectArtifactWriteBatch(async () => {
    const existing = get().files.find((f) =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      const sourceIsMissing = !existing.file || existing.file.size <= 0;
      if (sourceIsMissing) {
        log.info(`Repairing missing source from re-import: ${file.name} (${file.size} bytes)`);
        set((state) => ({
          files: state.files.map((candidate) => (
            candidate.id === existing.id
              ? { ...candidate, isImporting: true }
              : candidate
          )),
        }));

        try {
          const result = await processImport({
            file,
            id: existing.id,
            parentId: existing.parentId,
            forceCopyToProject: true,
            typeOverride: existing.type,
          });
          const repairedMediaFile = {
            ...existing,
            ...result.mediaFile,
            ...importMetadata(options),
          };
          finalizeImportedMediaFile(set, get, existing.id, repairedMediaFile);

          // The complete media store also owns reloadFile, which rebinds any
          // already-restored timeline clips to the repaired project source.
          const reloadFile = (get() as MediaState & Partial<FileManageActions>).reloadFile;
          if (typeof reloadFile === 'function') {
            await reloadFile(existing.id);
          }

          return get().files.find((candidate) => candidate.id === existing.id) ?? repairedMediaFile;
        } catch (error) {
          set((state) => ({
            files: state.files.map((candidate) => (
              candidate.id === existing.id
                ? { ...candidate, isImporting: false }
                : candidate
            )),
          }));
          throw error;
        }
      }

      log.info(`Skipping duplicate: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      if (options?.stemInfo || options?.externalOrigin) {
        const updatedExisting = { ...existing, ...importMetadata(options) };
        set((state) => ({
          files: state.files.map((candidate) => candidate.id === existing.id ? updatedExisting : candidate),
        }));
        startMediaFileAudioProxyGeneration(set, get, existing.id);
        startVideoProxyGenerationIfNeeded(get, existing.id);
        return updatedExisting;
      }
      startMediaFileAudioProxyGeneration(set, get, existing.id);
      startVideoProxyGenerationIfNeeded(get, existing.id);
      return existing;
    }

    const id = generateId();
    const resolved = await resolveImportEntry(file, { id });

    if (resolved.route === 'signal') {
      const existingSignal = get().signalAssets.find((item) =>
        item.name === file.name && item.fileSize === file.size
      );
      if (existingSignal) {
        log.info(`Skipping duplicate SignalAsset: ${file.name} (${file.size} bytes) - already exists as ${existingSignal.id}`);
        return existingSignal;
      }

      log.info(`Starting Signal import: ${file.name} provider: ${resolved.plan.provider.id} size: ${file.size}`);
      const signalAsset = await runSignalImport(resolved, parentId);
      commitSignalAsset(set, signalAsset);
      log.info('Signal import complete:', signalAsset.name);
      return signalAsset;
    }

    const type = resolved.type;
    log.info(`Starting: ${file.name} type: ${type} size: ${file.size}`);

    const placeholder = createPlaceholder(file, id, type, parentId);
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    try {
      const result = await processImport({
        file,
        id,
        parentId,
        forceCopyToProject: options?.forceCopyToProject === true,
        projectFileName: options?.projectFileName,
        typeOverride: type,
      });
      const mediaFile = { ...result.mediaFile, ...importMetadata(options) };
      finalizeImportedMediaFile(set, get, id, mediaFile);
      log.info('Complete:', mediaFile.name);
      return mediaFile;
    } catch (err) {
      log.error(`Import failed: ${file.name}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
      }));
      throw err;
    }
  }),
});
