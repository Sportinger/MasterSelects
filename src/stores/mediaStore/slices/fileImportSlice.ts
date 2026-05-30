// File import actions - unified import logic

import type { FileImportResult, MediaFile, MediaSliceCreator, MediaState, SignalAssetItem } from '../types';
import type { MediaFileStemInfo } from '../../../types/audio';
import { generateId, processImport } from '../helpers/importPipeline';
import { processGaussianSplatSequenceImport } from '../helpers/gaussianSplatSequenceImport';
import { processModelSequenceImport } from '../helpers/modelSequenceImport';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectFileService } from '../../../services/projectFileService';
import { artifactService } from '../../../services/project/domains/ArtifactService';
import { projectDB } from '../../../services/projectDB';
import { Logger } from '../../../services/logger';
import {
  createDefaultUniversalImportOrchestrator,
  type SignalUniversalImportResult,
  type UniversalImportPlan,
} from '../../../importers';
import type { SignalArtifact } from '../../../signals';
import {
  createSignalAssetItem,
  mergeSignalArtifacts,
  remapSignalAssetArtifacts,
} from '../helpers/signalItems';
import {
  groupGaussianSplatSequenceEntries,
  type GroupedGaussianSplatSequence,
} from '../../../utils/gaussianSplatSequence';
import {
  groupModelSequenceEntries,
  type GroupedModelSequence,
  type ModelSequenceImportEntry,
} from '../../../utils/modelSequence';
import { getGaussianSplatContainerLabelFromFileName } from '../helpers/gaussianSplatStats';
import { startMediaFileWaveformGeneration } from '../helpers/mediaWaveformHelpers';
import {
  ensureAudioProxyForMediaFile,
  shouldGenerateAudioProxy,
  type AudioProxyGenerationUpdate,
} from '../../../services/audio/AudioProxyService';

const log = Logger.create('Import');
const universalImportOrchestrator = createDefaultUniversalImportOrchestrator();

type ImportableMediaType = MediaFile['type'];

interface ResolvedLegacyImportEntry extends ModelSequenceImportEntry {
  id: string;
  route: 'legacy-media';
  type: ImportableMediaType;
}

interface ResolvedSignalImportEntry extends ModelSequenceImportEntry {
  id: string;
  route: 'signal';
  plan: Extract<UniversalImportPlan, { route: 'signal' }>;
}

type ResolvedImportEntry = ResolvedLegacyImportEntry | ResolvedSignalImportEntry;

export interface FileImportActions {
  importFile: (file: File, parentId?: string | null, options?: ImportFileOptions) => Promise<FileImportResult>;
  importFiles: (files: FileList | File[], parentId?: string | null) => Promise<FileImportResult[]>;
  importFilesWithPicker: () => Promise<FileImportResult[]>;
  importFilesWithHandles: (filesWithHandles: Array<{
    file: File;
    handle: FileSystemFileHandle;
    absolutePath?: string;
  }>, parentId?: string | null) => Promise<FileImportResult[]>;
  importGaussianAvatar: (file: File, parentId?: string | null) => Promise<MediaFile>;
  importGaussianSplat: (file: File, parentId?: string | null) => Promise<MediaFile>;
}

export interface ImportFileOptions {
  forceCopyToProject?: boolean;
  projectFileName?: string;
  stemInfo?: MediaFileStemInfo;
}

async function resolveImportEntry(
  file: File,
  options: {
    id?: string;
    handle?: FileSystemFileHandle;
    absolutePath?: string;
  } = {},
): Promise<ResolvedImportEntry> {
  const plan = await universalImportOrchestrator.planImport(file);
  const id = options.id ?? generateId();

  if (plan.route === 'legacy-media') {
    return {
      file,
      handle: options.handle,
      absolutePath: options.absolutePath,
      id,
      route: 'legacy-media',
      type: plan.legacyMediaType as ImportableMediaType,
    };
  }

  return {
    file,
    handle: options.handle,
    absolutePath: options.absolutePath,
    id,
    route: 'signal',
    plan,
  };
}

async function persistSignalImportArtifacts(
  result: SignalUniversalImportResult,
): Promise<{ asset: SignalUniversalImportResult['asset']; artifacts: SignalArtifact[] }> {
  const projectHandle = (
    projectFileService as typeof projectFileService & {
      getProjectHandle?: () => FileSystemDirectoryHandle | null;
    }
  ).getProjectHandle?.() ?? null;

  const store = projectHandle
    ? artifactService.createStore(projectHandle)
    : artifactService.createIndexedDBStore();
  const artifactsByOriginalId = new Map<string, SignalArtifact>();

  try {
    for (const payload of result.artifactPayloads) {
      const stored = await store.putArtifact(payload.bytes, {
        mimeType: payload.mimeType,
        encoding: payload.artifact.encoding,
        producer: payload.artifact.producer,
        sourceRefs: payload.artifact.sourceRefs,
        metadata: payload.artifact.metadata,
        createdAt: payload.artifact.createdAt,
      });
      artifactsByOriginalId.set(payload.artifactId, stored.manifest);
    }
  } catch (error) {
    const target = projectHandle ? 'project cache' : 'IndexedDB';
    log.warn(`Signal artifact persistence to ${target} failed; keeping transient memory artifact refs.`, error);
    return {
      asset: result.asset,
      artifacts: result.asset.artifacts,
    };
  }

  const asset = remapSignalAssetArtifacts(result.asset, artifactsByOriginalId);
  return {
    asset,
    artifacts: asset.artifacts,
  };
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
    ...(type === 'gaussian-splat'
      ? {
          container: getGaussianSplatContainerLabelFromFileName(file.name),
          codec: 'Splat',
        }
      : {}),
  };
}

function createSequencePlaceholder(
  sequence: GroupedModelSequence<ResolvedLegacyImportEntry>,
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
    container: `${getGaussianSplatContainerLabelFromFileName(sequence.entries[0]?.file.name ?? '')} Seq`,
    codec: 'Splat Seq',
    splatFrameCount: sequence.frameCount,
    importProgress: 0,
    isImporting: true,
  };
}

function createGaussianSplatSequencePlaceholder(
  sequence: GroupedGaussianSplatSequence<ResolvedLegacyImportEntry>,
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

function updateMediaFileWaveform(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  id: string,
  updates: Partial<Pick<MediaFile, 'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'>>,
): void {
  set((state) => ({
    files: state.files.map((file) => (
      file.id === id
        ? { ...file, ...updates }
        : file
    )),
  }));
}

function updateMediaFileAudioProxy(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  id: string,
  update: AudioProxyGenerationUpdate,
): void {
  set((state) => ({
    files: state.files.map((file) => {
      if (file.id !== id) return file;

      const nextUrl = update.url ?? file.audioProxyUrl;
      if (
        update.url &&
        file.audioProxyUrl &&
        file.audioProxyUrl !== update.url &&
        file.audioProxyUrl.startsWith('blob:')
      ) {
        URL.revokeObjectURL(file.audioProxyUrl);
      }

      return {
        ...file,
        audioProxyStatus: update.status,
        audioProxyProgress: update.progress,
        audioProxyStorageKey: update.storageKey,
        audioProxyUrl: nextUrl,
        hasProxyAudio: update.status === 'ready' ? true : file.hasProxyAudio,
      };
    }),
  }));
}

function startMediaFileAudioProxyGeneration(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  id: string,
): void {
  const mediaFile = get().files.find((file) => file.id === id);
  if (!mediaFile || !shouldGenerateAudioProxy(mediaFile)) return;

  void ensureAudioProxyForMediaFile(mediaFile, {
    onUpdate: (update) => {
      updateMediaFileAudioProxy(set, id, update);
    },
  }).catch((error) => {
    log.warn('Audio proxy generation failed', { mediaFileId: id, error });
  });
}

function startVideoProxyGenerationIfNeeded(get: () => MediaState, id: string): void {
  const state = get() as MediaState & { startProxyGenerationQueue?: () => void };
  if (!state.proxyEnabled) return;

  const mediaFile = state.files.find((file) => file.id === id);
  if (mediaFile?.type !== 'video' || mediaFile.isImporting) return;

  queueMicrotask(() => {
    const latestState = get() as MediaState & { startProxyGenerationQueue?: () => void };
    if (latestState.proxyEnabled) {
      latestState.startProxyGenerationQueue?.();
    }
  });
}

function finalizeImportedMediaFile(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  id: string,
  result: MediaFile,
): void {
  set((state) => finalizePlaceholder(state, id, result));
  const mediaFile = get().files.find((file) => file.id === id) ?? result;
  startMediaFileWaveformGeneration(
    mediaFile,
    (mediaFileId, updates) => updateMediaFileWaveform(set, mediaFileId, updates),
    (mediaFileId) => get().files.find((file) => file.id === mediaFileId),
  );
  startMediaFileAudioProxyGeneration(set, get, id);
  startVideoProxyGenerationIfNeeded(get, id);
}

function splitModelSequenceEntries(entries: ResolvedLegacyImportEntry[]): {
  modelSequences: GroupedModelSequence<ResolvedLegacyImportEntry>[];
  gaussianSplatSequences: GroupedGaussianSplatSequence<ResolvedLegacyImportEntry>[];
  singles: ResolvedLegacyImportEntry[];
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

async function runSignalImport(
  entry: ResolvedSignalImportEntry,
  parentId?: string | null,
): Promise<SignalAssetItem> {
  const result = await universalImportOrchestrator.importPlannedFile(entry.plan, {
    absolutePath: entry.absolutePath,
  });

  if (result.route !== 'signal') {
    throw new Error(`Signal importer resolved "${entry.file.name}" as a legacy media route.`);
  }

  const persisted = await persistSignalImportArtifacts(result);
  return createSignalAssetItem(persisted.asset, {
    parentId,
    diagnostics: result.diagnostics,
    providerId: result.provider.id,
  });
}

export const createFileImportSlice: MediaSliceCreator<FileImportActions> = (set, get) => ({
  importFile: async (file: File, parentId?: string | null, options?: ImportFileOptions) => {
    const existing = get().files.find((f) =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      log.info(`Skipping duplicate: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      if (options?.stemInfo) {
        const updatedExisting = { ...existing, stemInfo: options.stemInfo };
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
      set((state) => ({
        signalAssets: [
          ...state.signalAssets.filter((item) => item.id !== signalAsset.id),
          signalAsset,
        ],
        signalArtifacts: mergeSignalArtifacts(state.signalArtifacts, signalAsset.artifacts),
      }));
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
      const mediaFile = options?.stemInfo
        ? { ...result.mediaFile, stemInfo: options.stemInfo }
        : result.mediaFile;
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
  },

  importFiles: async (files: FileList | File[], parentId?: string | null) => {
    const fileArray = Array.from(files);
    const imported: FileImportResult[] = [];

    const entries = await Promise.all(fileArray.map(async (file) => resolveImportEntry(file)));
    const signalEntries = entries.filter((entry): entry is ResolvedSignalImportEntry => entry.route === 'signal');
    const legacyEntries = entries.filter((entry): entry is ResolvedLegacyImportEntry => entry.route === 'legacy-media');
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(legacyEntries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ],
    }));

    for (const entry of signalEntries) {
      try {
        const signalAsset = await runSignalImport(entry, parentId);
        set((state) => ({
          signalAssets: [
            ...state.signalAssets.filter((item) => item.id !== signalAsset.id),
            signalAsset,
          ],
          signalArtifacts: mergeSignalArtifacts(state.signalArtifacts, signalAsset.artifacts),
        }));
        imported.push(signalAsset);
      } catch (err) {
        log.error(`Signal import failed: ${entry.file.name}`, err);
      }
    }

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
        finalizeImportedMediaFile(set, get, sequenceId, result);
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
        finalizeImportedMediaFile(set, get, sequenceId, result);
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
            finalizeImportedMediaFile(set, get, id, result.mediaFile);
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

    const imported: FileImportResult[] = [];
    const entries = await Promise.all(result.map(async ({ file, handle }) => (
      resolveImportEntry(file, { handle })
    )));
    const signalEntries = entries.filter((entry): entry is ResolvedSignalImportEntry => entry.route === 'signal');
    const legacyEntries = entries.filter((entry): entry is ResolvedLegacyImportEntry => entry.route === 'legacy-media');
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(legacyEntries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id)),
      ],
    }));

    for (const entry of signalEntries) {
      try {
        const signalAsset = await runSignalImport(entry);
        set((state) => ({
          signalAssets: [
            ...state.signalAssets.filter((item) => item.id !== signalAsset.id),
            signalAsset,
          ],
          signalArtifacts: mergeSignalArtifacts(state.signalArtifacts, signalAsset.artifacts),
        }));
        imported.push(signalAsset);
      } catch (err) {
        log.error(`Signal import failed: ${entry.file.name}`, err);
      }
    }

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
        finalizeImportedMediaFile(set, get, sequenceId, importResult);
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
        finalizeImportedMediaFile(set, get, sequenceId, importResult);
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
        finalizeImportedMediaFile(set, get, id, importResult.mediaFile);
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
    const imported: FileImportResult[] = [];

    const entries = await Promise.all(filesWithHandles.map(async ({ file, handle, absolutePath }) => (
      resolveImportEntry(file, { handle, absolutePath })
    )));
    const signalEntries = entries.filter((entry): entry is ResolvedSignalImportEntry => entry.route === 'signal');
    const legacyEntries = entries.filter((entry): entry is ResolvedLegacyImportEntry => entry.route === 'legacy-media');
    const { modelSequences, gaussianSplatSequences, singles } = splitModelSequenceEntries(legacyEntries);

    set((state) => ({
      files: [
        ...state.files,
        ...singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
        ...modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
        ...gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ],
    }));

    for (const entry of signalEntries) {
      try {
        const signalAsset = await runSignalImport(entry, parentId);
        set((state) => ({
          signalAssets: [
            ...state.signalAssets.filter((item) => item.id !== signalAsset.id),
            signalAsset,
          ],
          signalArtifacts: mergeSignalArtifacts(state.signalArtifacts, signalAsset.artifacts),
        }));
        imported.push(signalAsset);
      } catch (err) {
        log.error(`Signal import failed: ${entry.file.name}`, err);
      }
    }

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
        finalizeImportedMediaFile(set, get, sequenceId, importResult);
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
        finalizeImportedMediaFile(set, get, sequenceId, importResult);
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
        finalizeImportedMediaFile(set, get, id, importResult.mediaFile);
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
      isImporting: true,
    };
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    try {
      const result = await processImport({ file, id, parentId, typeOverride: 'gaussian-splat' });
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
