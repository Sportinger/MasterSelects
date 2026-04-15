// File import actions - unified import logic

import type { MediaFile, MediaSliceCreator } from '../types';
import { generateId, processImport } from '../helpers/importPipeline';
import { classifyMediaType } from '../../timeline/helpers/mediaTypeHelpers';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { Logger } from '../../../services/logger';

const log = Logger.create('Import');

type ImportableMediaType = MediaFile['type'];

export interface FileImportActions {
  importFile: (file: File, parentId?: string | null, options?: { forceCopyToProject?: boolean }) => Promise<MediaFile>;
  importFiles: (files: FileList | File[], parentId?: string | null) => Promise<MediaFile[]>;
  importFilesWithPicker: () => Promise<MediaFile[]>;
  importFilesWithHandles: (filesWithHandles: Array<{
    file: File;
    handle: FileSystemFileHandle;
    absolutePath?: string;
  }>, parentId?: string | null) => Promise<MediaFile[]>;
  importGaussianAvatar: (file: File, parentId?: string | null) => Promise<MediaFile>;
  importGaussianSplat: (file: File, parentId?: string | null) => Promise<MediaFile>;
}

async function resolveImportType(file: File): Promise<ImportableMediaType> {
  const type = await classifyMediaType(file);
  if (type === 'unknown') {
    throw new Error(`Unsupported media type: ${file.name}`);
  }
  return type as ImportableMediaType;
}

/**
 * Create a placeholder MediaFile that appears instantly in the media panel.
 * Shows as grey/loading while the full import runs in the background.
 */
function createPlaceholder(file: File, id: string, type: ImportableMediaType, parentId?: string | null): MediaFile {
  return {
    id,
    name: file.name,
    type,
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file,
    url: '',
    fileSize: file.size,
    isImporting: true,
  };
}

/**
 * Merge import result into placeholder, preserving any state changes
 * that may have happened during import (e.g. folder moves).
 */
function finalizePlaceholder(state: { files: MediaFile[] }, id: string, result: MediaFile): { files: MediaFile[] } {
  return {
    files: state.files.map((f) => {
      if (f.id !== id) return f;
      return {
        ...result,
        parentId: f.parentId,
        labelColor: f.labelColor,
        isImporting: false,
      };
    }),
  };
}

export const createFileImportSlice: MediaSliceCreator<FileImportActions> = (set, get) => ({
  importFile: async (file: File, parentId?: string | null, options?: { forceCopyToProject?: boolean }) => {
    const existing = get().files.find((f) =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      log.info(`Skipping duplicate: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      return existing;
    }

    const id = generateId();
    const type = await resolveImportType(file);
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
        typeOverride: type,
      });
      set((state) => finalizePlaceholder(state, id, result.mediaFile));
      log.info('Complete:', result.mediaFile.name);
      return result.mediaFile;
    } catch (err) {
      log.error(`Import failed: ${file.name}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
      }));
      throw err;
    }
  },

  importFiles: async (files: FileList | File[], parentId?: string | null) => {
    const fileArray = Array.from(files);
    const imported: MediaFile[] = [];

    const entries = await Promise.all(fileArray.map(async (file) => ({
      file,
      id: generateId(),
      type: await resolveImportType(file),
    })));

    set((state) => ({
      files: [
        ...state.files,
        ...entries.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
      ],
    }));

    const batchSize = 3;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async ({ file, id, type }) => {
          try {
            const result = await processImport({ file, id, parentId, typeOverride: type });
            set((state) => finalizePlaceholder(state, id, result.mediaFile));
            return result.mediaFile;
          } catch (err) {
            log.error(`Import failed: ${file.name}`, err);
            set((state) => ({
              files: state.files.filter((f) => f.id !== id),
            }));
            return null;
          }
        })
      );
      imported.push(...results.filter((result): result is MediaFile => result !== null));
    }

    return imported;
  },

  importFilesWithPicker: async () => {
    const result = await fileSystemService.pickFiles();
    if (!result || result.length === 0) return [];

    const imported: MediaFile[] = [];
    const entries = await Promise.all(result.map(async ({ file, handle }) => ({
      file,
      handle,
      id: generateId(),
      type: await resolveImportType(file),
    })));

    set((state) => ({
      files: [
        ...state.files,
        ...entries.map((entry) => createPlaceholder(entry.file, entry.id, entry.type)),
      ],
    }));

    for (const { file, handle, id, type } of entries) {
      fileSystemService.storeFileHandle(id, handle);
      await projectDB.storeHandle(`media_${id}`, handle);
      log.debug('Stored file handle for ID:', id);

      try {
        const importResult = await processImport({ file, id, handle, typeOverride: type });
        set((state) => finalizePlaceholder(state, id, importResult.mediaFile));
        imported.push(importResult.mediaFile);
      } catch (err) {
        log.error(`Import failed: ${file.name}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== id),
        }));
      }
    }

    return imported;
  },

  importFilesWithHandles: async (filesWithHandles, parentId?: string | null) => {
    const imported: MediaFile[] = [];

    const entries = await Promise.all(filesWithHandles.map(async ({ file, handle, absolutePath }) => ({
      file,
      handle,
      absolutePath,
      id: generateId(),
      type: await resolveImportType(file),
    })));

    set((state) => ({
      files: [
        ...state.files,
        ...entries.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
      ],
    }));

    for (const { file, handle, absolutePath, id, type } of entries) {
      fileSystemService.storeFileHandle(id, handle);
      await projectDB.storeHandle(`media_${id}`, handle);
      log.debug('Stored file handle for ID:', id);

      try {
        const importResult = await processImport({ file, id, handle, absolutePath, parentId, typeOverride: type });
        set((state) => finalizePlaceholder(state, id, importResult.mediaFile));
        imported.push(importResult.mediaFile);
      } catch (err) {
        log.error(`Import failed: ${file.name}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== id),
        }));
      }
    }

    return imported;
  },

  importGaussianAvatar: async (file: File, parentId?: string | null) => {
    void parentId;
    log.warn(`Blocked legacy gaussian-avatar import: ${file.name}`);
    throw new Error('Legacy gaussian-avatar import is disabled. Import .ply or .splat instead.');
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
      isImporting: true,
    };
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    // Phase 2: Full import in background with type override
    try {
      const result = await processImport({ file, id, parentId, typeOverride: 'gaussian-avatar' });
      set((state) => finalizePlaceholder(state, id, result.mediaFile));
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
      isImporting: true,
    };
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    try {
      const result = await processImport({ file, id, parentId, typeOverride: 'gaussian-splat' });
      set((state) => finalizePlaceholder(state, id, result.mediaFile));
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
