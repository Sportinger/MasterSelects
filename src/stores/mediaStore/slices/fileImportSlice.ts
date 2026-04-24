// File import actions - unified import logic

import type { MediaFile, MediaSliceCreator } from '../types';
import { generateId, processImport } from '../helpers/importPipeline';
import { processGaussianSplatSequenceImport } from '../helpers/gaussianSplatSequenceImport';
import { processModelSequenceImport } from '../helpers/modelSequenceImport';
import { classifyMediaType } from '../../timeline/helpers/mediaTypeHelpers';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { Logger } from '../../../services/logger';
import {
  groupGaussianSplatSequenceEntries,
  type GroupedGaussianSplatSequence,
} from '../../../utils/gaussianSplatSequence';
import {
  groupModelSequenceEntries,
  type GroupedModelSequence,
  type ModelSequenceImportEntry,
} from '../../../utils/modelSequence';

const log = Logger.create('Import');

type ImportableMediaType = MediaFile['type'];

interface ResolvedImportEntry extends ModelSequenceImportEntry {
  id: string;
  type: ImportableMediaType;
}

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

function createSequencePlaceholder(
  sequence: GroupedModelSequence<ResolvedImportEntry>,
  id: string,
  parentId?: string | null,
): MediaFile {
  const firstFile = sequence.entries[0]?.file;
  return {
    id,
    name: sequence.displayName,
    type: 'model',
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: firstFile,
    url: '',
    fileSize: sequence.entries.reduce((sum, entry) => sum + entry.file.size, 0),
    duration: sequence.frameCount / 30,
    fps: 30,
    importProgress: 0,
    isImporting: true,
  };
}

function createGaussianSplatSequencePlaceholder(
  sequence: GroupedGaussianSplatSequence<ResolvedImportEntry>,
  id: string,
  parentId?: string | null,
): MediaFile {
  const firstFile = sequence.entries[0]?.file;
  return {
    id,
    name: sequence.displayName,
    type: 'gaussian-splat',
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: firstFile,
    url: '',
    fileSize: sequence.entries.reduce((sum, entry) => sum + entry.file.size, 0),
    duration: sequence.frameCount / 30,
    fps: 30,
    importProgress: 0,
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

function updatePlaceholderImportProgress(
  state: { files: MediaFile[] },
  id: string,
  progress: number,
): { files: MediaFile[] } {
  const nextProgress = Math.max(0, Math.min(100, Math.round(progress)));
  return {
    files: state.files.map((f) => {
      if (f.id !== id) return f;
      if (f.importProgress === nextProgress && f.isImporting) return f;
      return {
        ...f,
        importProgress: nextProgress,
        isImporting: true,
      };
    }),
  };
}

function splitModelSequenceEntries(entries: ResolvedImportEntry[]): {
  modelSequences: GroupedModelSequence<ResolvedImportEntry>[];
  gaussianSplatSequences: GroupedGaussianSplatSequence<ResolvedImportEntry>[];
  singles: ResolvedImportEntry[];
} {
  const modelEntries = entries.filter((entry) => entry.type === 'model');
  const gaussianSplatEntries = entries.filter((entry) => entry.type === 'gaussian-splat');
  const nonSequenceEntries = entries.filter((entry) => entry.type !== 'model' && entry.type !== 'gaussian-splat');
  const { sequences, singles: ungroupedModels } = groupModelSequenceEntries(modelEntries);
  const {
    sequences: gaussianSplatSequences,
    singles: ungroupedGaussianSplats,
  } = groupGaussianSplatSequenceEntries(gaussianSplatEntries);

  return {
    modelSequences: sequences,
    gaussianSplatSequences,
    singles: [...nonSequenceEntries, ...ungroupedModels, ...ungroupedGaussianSplats],
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

    const entries: ResolvedImportEntry[] = await Promise.all(fileArray.map(async (file) => ({
      file,
      id: generateId(),
      type: await resolveImportType(file),
    })));
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(entries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ],
    }));

    for (const sequence of modelSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const result = await processModelSequenceImport({
          id: sequenceId,
          parentId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, result));
        imported.push(result);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    for (const sequence of gaussianSplatSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const result = await processGaussianSplatSequenceImport({
          id: sequenceId,
          parentId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, result));
        imported.push(result);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    const batchSize = 3;
    for (let i = 0; i < singles.length; i += batchSize) {
      const batch = singles.slice(i, i + batchSize);
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
    const entries: ResolvedImportEntry[] = await Promise.all(result.map(async ({ file, handle }) => ({
      file,
      handle,
      id: generateId(),
      type: await resolveImportType(file),
    })));
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(entries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id)),
      ],
    }));

    for (const sequence of modelSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const importResult = await processModelSequenceImport({
          id: sequenceId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, importResult));
        imported.push(importResult);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    for (const sequence of gaussianSplatSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const importResult = await processGaussianSplatSequenceImport({
          id: sequenceId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, importResult));
        imported.push(importResult);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    for (const { file, handle, id, type } of singles) {
      if (handle) {
        fileSystemService.storeFileHandle(id, handle);
        await projectDB.storeHandle(`media_${id}`, handle);
        log.debug('Stored file handle for ID:', id);
      }

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

    const entries: ResolvedImportEntry[] = await Promise.all(filesWithHandles.map(async ({ file, handle, absolutePath }) => ({
      file,
      handle,
      absolutePath,
      id: generateId(),
      type: await resolveImportType(file),
    })));
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(entries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ],
    }));

    for (const sequence of modelSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const importResult = await processModelSequenceImport({
          id: sequenceId,
          parentId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, importResult));
        imported.push(importResult);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    for (const sequence of gaussianSplatSequences) {
      const sequenceId = sequence.entries[0]!.id;
      try {
        let lastProgress = -1;
        const importResult = await processGaussianSplatSequenceImport({
          id: sequenceId,
          parentId,
          sequence,
          onProgress: (progress) => {
            const normalized = Math.max(0, Math.min(100, Math.round(progress)));
            if (normalized === lastProgress) return;
            lastProgress = normalized;
            set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
          },
        });
        set((state) => finalizePlaceholder(state, sequenceId, importResult));
        imported.push(importResult);
      } catch (err) {
        log.error(`Sequence import failed: ${sequence.displayName}`, err);
        set((state) => ({
          files: state.files.filter((f) => f.id !== sequenceId),
        }));
      }
    }

    for (const { file, handle, absolutePath, id, type } of singles) {
      if (handle) {
        fileSystemService.storeFileHandle(id, handle);
        await projectDB.storeHandle(`media_${id}`, handle);
        log.debug('Stored file handle for ID:', id);
      }

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
