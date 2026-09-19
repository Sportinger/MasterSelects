import type { MediaFile, MediaState } from '../../types';
import type { GroupedGaussianSplatSequence } from '../../../../utils/gaussianSplatSequence';
import type { GroupedModelSequence } from '../../../../utils/modelSequence';
import {
  ensureAudioProxyForMediaFile,
  shouldGenerateAudioProxy,
  type AudioProxyGenerationUpdate,
} from '../../../../services/audio/AudioProxyService';
import { getGaussianSplatContainerLabelFromFileName } from '../../helpers/gaussianSplatStats';
import { startMediaFileWaveformGeneration } from '../../helpers/mediaWaveformHelpers';
import type { ImportableMediaType, ResolvedLegacyImportEntry } from './importPlanning';
import { fileImportLog as log } from './log';

type MediaSliceSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)
) => void;

/**
 * Create a placeholder MediaFile that appears instantly in the media panel.
 * Shows as grey/loading while the full import runs in the background.
 */
export function createPlaceholder(
  file: File,
  id: string,
  type: ImportableMediaType,
  parentId?: string | null,
): MediaFile {
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

export function createSequencePlaceholder(
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

export function createGaussianSplatSequencePlaceholder(
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

export function updatePlaceholderImportProgress(
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
  set: MediaSliceSet,
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
  set: MediaSliceSet,
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

export function startMediaFileAudioProxyGeneration(
  set: MediaSliceSet,
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

export function startVideoProxyGenerationIfNeeded(get: () => MediaState, id: string): void {
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

function startMediaFileThumbnailGenerationIfNeeded(get: () => MediaState, id: string): void {
  const mediaFile = get().files.find((file) => file.id === id);
  if (
    !mediaFile
    || mediaFile.thumbnailUrl
    || (mediaFile.type !== 'image' && mediaFile.type !== 'video')
  ) {
    return;
  }

  // A new task lets Safari dismiss the native Photos picker and paint the
  // usable media item before a potentially slow video seek/thumbnail timeout.
  setTimeout(() => {
    const latestState = get() as MediaState & {
      ensureFileThumbnail?: (mediaFileId: string) => Promise<boolean>;
    };
    const latestFile = latestState.files.find((file) => file.id === id);
    if (!latestFile || latestFile.thumbnailUrl || latestFile.isImporting) return;

    void latestState.ensureFileThumbnail?.(id).catch((error) => {
      log.warn('Background thumbnail generation failed', { mediaFileId: id, error });
    });
  }, 0);
}

export function finalizeImportedMediaFile(
  set: MediaSliceSet,
  get: () => MediaState,
  id: string,
  result: MediaFile,
): void {
  set((state) => finalizePlaceholder(state, id, result));
  const mediaFile = get().files.find((file) => file.id === id) ?? result;
  startMediaFileThumbnailGenerationIfNeeded(get, id);
  startMediaFileWaveformGeneration(
    mediaFile,
    (mediaFileId, updates) => updateMediaFileWaveform(set, mediaFileId, updates),
    (mediaFileId) => get().files.find((file) => file.id === mediaFileId),
  );
  startMediaFileAudioProxyGeneration(set, get, id);
  startVideoProxyGenerationIfNeeded(get, id);
}
