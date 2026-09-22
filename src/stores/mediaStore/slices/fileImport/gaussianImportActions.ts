import type { MediaFile, MediaSliceCreator } from '../../types';
import { generateId, processImport } from '../../helpers/importPipeline';
import type { FileImportActions } from '../fileImportSlice';
import {
  finalizeImportedMediaFile,
  updatePlaceholderImportProgress,
} from './placeholderLifecycle';
import { fileImportLog as log } from './log';

export const createGaussianImportActions: MediaSliceCreator<Pick<
  FileImportActions,
  'importGaussianAvatar' | 'importGaussianSplat'
>> = (set, get) => ({
  importGaussianAvatar: async (file: File, parentId?: string | null) => {
    void parentId;
    log.warn(`Blocked legacy gaussian-avatar import: ${file.name}`);
    throw new Error('Legacy gaussian-avatar import is disabled. Import a gaussian-splat scene file instead.');
    /*

    // Deduplication: check if file with same name + size already exists
    const existing = get().files.find(f =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      log.info(`Skipping duplicate gaussian avatar: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      return existing;
    }

    const id = generateId();
    log.info(`Starting gaussian avatar import: ${file.name} type: ${file.type} size: ${file.size}`);

    // Phase 1: Add placeholder instantly with forced gaussian-avatar type
    const placeholder: MediaFile = {
      id,
      name: file.name,
      type: 'gaussian-avatar',
      parentId: parentId ?? null,
      createdAt: Date.now(),
      file,
      url: '',
      fileSize: file.size,
      container: getGaussianSplatContainerLabelFromFileName(file.name),
      codec: 'Splat',
      isImporting: true,
    };
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    // Phase 2: Full import in background with type override
    try {
      const result = await processImport({ file, id, parentId, typeOverride: 'gaussian-avatar' });
      finalizeImportedMediaFile(set, get, id, result.mediaFile);
      log.info('Gaussian avatar import complete:', result.mediaFile.name);
      return result.mediaFile;
    } catch (err) {
      log.error(`Gaussian avatar import failed: ${file.name}`, err);
      // Remove placeholder on failure
      set((state) => ({
        files: state.files.filter(f => f.id !== id),
      }));
      throw err;
    }
    */
  },

  importGaussianSplat: async (file: File, parentId?: string | null) => {
    const existing = get().files.find((f) =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      log.info(`Skipping duplicate gaussian splat: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      return existing;
    }

    const id = generateId();
    log.info(`Starting gaussian splat import: ${file.name} type: ${file.type} size: ${file.size}`);

    const placeholder: MediaFile = {
      id,
      name: file.name,
      type: 'gaussian-splat',
      parentId: parentId ?? null,
      createdAt: Date.now(),
      file,
      url: '',
      fileSize: file.size,
      importProgress: 0,
      isImporting: true,
    };
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    try {
      const result = await processImport({
        file,
        id,
        parentId,
        typeOverride: 'gaussian-splat',
        onProgress: (progress) => {
          set((state) => updatePlaceholderImportProgress(state, id, progress));
        },
      });
      finalizeImportedMediaFile(set, get, id, result.mediaFile);
      log.info('Gaussian splat import complete:', result.mediaFile.name);
      return result.mediaFile;
    } catch (err) {
      log.error(`Gaussian splat import failed: ${file.name}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
      }));
      throw err;
    }
  },
});
