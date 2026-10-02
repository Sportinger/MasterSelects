import type { MediaFile, SignalAssetItem } from '../../stores/mediaStore';
import type { FileImportResult } from '../../stores/mediaStore/types';
import {
  isMediaFileImportResult,
  isSignalAssetImportResult,
} from '../../stores/mediaStore/helpers/importResult';
import { useMediaStore } from '../../stores/mediaStore';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { createPrimaryMediaObjectUrl } from '../project/mediaObjectUrlManager';
import { Logger } from '../logger';
import { isLinkedMediaDeferred, requestLinkedMedia } from '../project/linkedMediaDemand';

const log = Logger.create('TimelineExternalDropMediaResolver');
const TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS = 750;

type FileWithPath = File & { path?: string };

const CLIP_TYPED_MEDIA_TYPES = new Set<MediaFile['type']>(['gaussian-splat', 'lottie', 'rive', 'model']);

export function setTimelineDroppedFilePath(file: File, filePath?: string): void {
  if (filePath) {
    (file as FileWithPath).path = filePath;
  }
}

export function getTimelineDropMediaTypeOverride(mediaFile: MediaFile): string | undefined {
  return CLIP_TYPED_MEDIA_TYPES.has(mediaFile.type) ? mediaFile.type : undefined;
}

function getPlaceholderMimeType(mediaFile: MediaFile): string {
  const name = mediaFile.name.toLowerCase();

  if (mediaFile.type === 'model') {
    if (name.endsWith('.glb')) return 'model/gltf-binary';
    if (name.endsWith('.gltf')) return 'model/gltf+json';
    if (name.endsWith('.obj')) return 'model/obj';
  }

  if (mediaFile.type === 'gaussian-splat') {
    if (name.endsWith('.ply')) return 'application/octet-stream';
    if (name.endsWith('.spz')) return 'application/octet-stream';
  }

  return '';
}

export function createPlaceholderFileForTimelineMedia(mediaFile: MediaFile): File {
  const file = new File([], mediaFile.name, { type: getPlaceholderMimeType(mediaFile) });
  setTimelineDroppedFilePath(file, mediaFile.absolutePath ?? mediaFile.filePath);
  return file;
}

function mediaFileHasLazy3DSource(mediaFile: MediaFile): boolean {
  if (mediaFile.file || mediaFile.url || mediaFile.absolutePath || mediaFile.projectPath) {
    return true;
  }

  if (mediaFile.modelSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.modelUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  )) {
    return true;
  }

  return Boolean(mediaFile.gaussianSplatSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.splatUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  ));
}

function findMatchingMediaFile(file: File, excludedIds?: Set<string>): MediaFile | null {
  const mediaFiles = useMediaStore.getState().files;
  return mediaFiles.find((mediaFile) =>
    mediaFile.name === file.name &&
    mediaFile.fileSize === file.size &&
    !excludedIds?.has(mediaFile.id)
  ) ?? null;
}

async function waitForTimelineDropImportPlaceholder(
  file: File,
  excludedIds: Set<string>,
  timeoutMs = TIMELINE_DROP_IMPORT_PLACEHOLDER_TIMEOUT_MS,
): Promise<MediaFile | null> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    const placeholder = findMatchingMediaFile(file, excludedIds);
    if (placeholder) {
      return placeholder;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  return null;
}

export type TimelineDropImportResult =
  | { kind: 'media-file'; mediaFile: MediaFile }
  | { kind: 'signal-asset'; signalAsset: SignalAssetItem };

function firstTimelineDropImportResult(
  result: FileImportResult | FileImportResult[],
): TimelineDropImportResult | null {
  const results = Array.isArray(result) ? result : [result];
  const mediaFile = results.find(isMediaFileImportResult);
  if (mediaFile) {
    return { kind: 'media-file', mediaFile };
  }

  const signalAsset = results.find(isSignalAssetImportResult);
  return signalAsset ? { kind: 'signal-asset', signalAsset } : null;
}

export async function resolveTimelineDropImportResult(params: {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  waitForMediaPlaceholder?: boolean;
}): Promise<TimelineDropImportResult | null> {
  const { file, handle, absolutePath, waitForMediaPlaceholder = true } = params;
  const existing = findMatchingMediaFile(file);
  if (existing) {
    return { kind: 'media-file', mediaFile: existing };
  }

  const mediaStore = useMediaStore.getState();
  const excludedIds = new Set(mediaStore.files.map((mediaFile) => mediaFile.id));
  const importPromise: Promise<FileImportResult | FileImportResult[]> = handle
    ? mediaStore.importFilesWithHandles([{ file, handle, absolutePath }])
    : mediaStore.importFile(file);
  void importPromise.catch(() => undefined);

  const placeholder = waitForMediaPlaceholder
    ? await waitForTimelineDropImportPlaceholder(file, excludedIds)
    : null;
  if (placeholder) {
    void importPromise.catch((error) => {
      log.warn('Timeline drop media import failed after placeholder creation', {
        name: file.name,
        error,
      });
    });
    return { kind: 'media-file', mediaFile: placeholder };
  }

  try {
    return firstTimelineDropImportResult(await importPromise);
  } catch (error) {
    log.warn('Timeline drop media import failed', { name: file.name, error });
    return null;
  }
}

export async function resolveTimelineDropMediaFile(params: {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}): Promise<MediaFile | null> {
  const result = await resolveTimelineDropImportResult(params);
  return result?.kind === 'media-file' ? result.mediaFile : null;
}

export async function resolveMediaFileForTimelineDrop(mediaFile: MediaFile): Promise<File | null> {
  if (isLinkedMediaDeferred(mediaFile.id)) {
    if (!await requestLinkedMedia(mediaFile.id)) return null;
    mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFile.id) ?? mediaFile;
  }
  if (mediaFile.file) {
    return mediaFile.file;
  }

  if (mediaFile.type === 'model' || mediaFile.type === 'gaussian-splat') {
    return mediaFileHasLazy3DSource(mediaFile) ? createPlaceholderFileForTimelineMedia(mediaFile) : null;
  }

  const nativeReferenceUrl = NativeHelperClient.parseFileReferenceUrl(mediaFile.url)
    ? mediaFile.url
    : mediaFile.absolutePath
      ? NativeHelperClient.getFileReferenceUrl(mediaFile.absolutePath)
      : null;

  if (!nativeReferenceUrl) {
    return null;
  }

  try {
    const file = await NativeHelperClient.getReferencedFile(nativeReferenceUrl, mediaFile.name);
    if (!file) {
      return null;
    }

    const referencedPath = NativeHelperClient.parseFileReferenceUrl(nativeReferenceUrl) ?? mediaFile.absolutePath;
    setTimelineDroppedFilePath(file, referencedPath ?? undefined);
    const url = createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });

    useMediaStore.setState((state) => ({
      files: state.files.map((currentFile) =>
        currentFile.id === mediaFile.id
          ? {
              ...currentFile,
              file,
              url,
              hasFileHandle: true,
              absolutePath: currentFile.absolutePath ?? referencedPath ?? undefined,
            }
          : currentFile
      ),
    }));

    return file;
  } catch (error) {
    log.warn('Could not resolve restored media file for timeline drop', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      error,
    });
    return null;
  }
}
