import type { MediaFile } from '../../stores/mediaStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { MediaSourceSelection } from '../../types/mediaMetadata';
import { linkedMediaSourceRuntime } from '../mediaRuntime/linkedMediaSourceRuntime';
import { releaseClipSourceRuntime } from '../mediaRuntime/clipBindings';
import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';
import { projectFileService } from '../projectFileService';
import { createPrimaryMediaObjectUrl } from './mediaObjectUrlManager';
import { updateTimelineClips } from '../../stores/mediaStore/slices/fileManageSlice';
import { getMediaInfo } from '../../stores/mediaStore/helpers/mediaInfoHelpers';
import { createThumbnail } from '../../stores/mediaStore/helpers/thumbnailHelpers';

let linkedThumbnailQueue: Promise<void> = Promise.resolve();

export function getLinkedMediaHandleKey(mediaId: string, sourceId: string): string {
  return `${mediaId}_linked_${sourceId}`;
}

export async function attachLinkedMediaSourceFile(
  mediaId: string,
  sourceId: string,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<boolean> {
  const media = useMediaStore.getState().files.find((candidate) => candidate.id === mediaId);
  if (!media?.linkedSources?.some((source) => source.id === sourceId)) return false;

  rememberOriginalRuntime(media);
  linkedMediaSourceRuntime.setLinked(mediaId, sourceId, { file, handle });
  if (handle) await storeLinkedHandle(mediaId, sourceId, handle);

  const selection = media.sourceSelection ?? { mode: 'auto' as const };
  if (selection.mode === 'original') return true;
  if (selection.mode === 'linked' && selection.sourceId !== sourceId) return true;
  await activateRuntimeFile(media, file, selection, { kind: 'linked', sourceId });
  return true;
}

export async function selectMediaSource(
  mediaId: string,
  selection: MediaSourceSelection,
  options: { invalidateCaches?: boolean; persistSelection?: boolean } = {},
): Promise<boolean> {
  const media = useMediaStore.getState().files.find((candidate) => candidate.id === mediaId);
  if (!media) return false;
  rememberOriginalRuntime(media);
  if (options.persistSelection !== false) {
    setSourceSelection(media.id, selection);
  }

  if (selection.mode === 'original') {
    const original = await resolveOriginal(media, true);
    if (!original) {
      setOfflineSource(media, selection);
      return true;
    }
    await activateRuntimeFile(media, original.file, selection, { kind: 'original' }, options);
    return true;
  }

  if (selection.mode === 'linked') {
    const linked = await resolveLinked(media, selection.sourceId, true);
    if (!linked) return false;
    await activateRuntimeFile(
      media,
      linked.file,
      selection,
      { kind: 'linked', sourceId: selection.sourceId },
      options,
    );
    return true;
  }

  const original = await resolveOriginal(media, false);
  if (original) {
    await activateRuntimeFile(media, original.file, selection, { kind: 'original' }, options);
    return true;
  }
  for (const source of media.linkedSources ?? []) {
    const linked = await resolveLinked(media, source.id, false);
    if (!linked) continue;
    await activateRuntimeFile(
      media,
      linked.file,
      selection,
      { kind: 'linked', sourceId: source.id },
      options,
    );
    return true;
  }
  setOfflineSource(media, selection);
  return true;
}

export async function restoreSelectedMediaSource(mediaId: string): Promise<boolean> {
  const media = useMediaStore.getState().files.find((candidate) => candidate.id === mediaId);
  if (!media?.linkedSources?.length) return false;
  return selectMediaSource(
    mediaId,
    media.sourceSelection ?? { mode: 'auto' },
    { invalidateCaches: false, persistSelection: false },
  );
}

function rememberOriginalRuntime(media: MediaFile): void {
  const active = linkedMediaSourceRuntime.getActive(media.id);
  if (active?.kind === 'linked' || !media.file) return;
  linkedMediaSourceRuntime.rememberOriginal(media.id, {
    file: media.file,
    handle: fileSystemService.getFileHandle(media.id),
  });
  linkedMediaSourceRuntime.setActive(media.id, { kind: 'original' });
}

async function resolveOriginal(media: MediaFile, requestPermission: boolean) {
  const cached = linkedMediaSourceRuntime.getOriginal(media.id);
  if (cached) return cached;
  const entry = await readStoredHandle(media.id, requestPermission);
  if (entry) linkedMediaSourceRuntime.rememberOriginal(media.id, entry);
  return entry;
}

async function resolveLinked(media: MediaFile, sourceId: string, requestPermission: boolean) {
  if (!media.linkedSources?.some((source) => source.id === sourceId)) return undefined;
  const cached = linkedMediaSourceRuntime.getLinked(media.id, sourceId);
  if (cached) return cached;
  const entry = await readStoredHandle(getLinkedMediaHandleKey(media.id, sourceId), requestPermission);
  if (entry) linkedMediaSourceRuntime.setLinked(media.id, sourceId, entry);
  return entry;
}

async function readStoredHandle(cacheKey: string, requestPermission: boolean) {
  const handle = fileSystemService.getFileHandle(cacheKey)
    ?? await projectDB.getStoredHandle(`media_${cacheKey}`) as FileSystemFileHandle | undefined;
  if (!handle || handle.kind !== 'file') return undefined;
  const permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') {
    if (!requestPermission || await handle.requestPermission({ mode: 'read' }) !== 'granted') return undefined;
  }
  const file = await handle.getFile();
  fileSystemService.storeFileHandle(cacheKey, handle);
  return { file, handle };
}

async function storeLinkedHandle(mediaId: string, sourceId: string, handle: FileSystemFileHandle): Promise<void> {
  const key = getLinkedMediaHandleKey(mediaId, sourceId);
  fileSystemService.storeFileHandle(key, handle);
  try {
    await projectDB.storeHandle(`media_${key}`, handle);
  } catch {
    // Native-helper pseudo handles cannot be cloned into IndexedDB.
  }
}

async function activateRuntimeFile(
  media: MediaFile,
  file: File,
  selection: MediaSourceSelection,
  active: { kind: 'original' } | { kind: 'linked'; sourceId: string },
  options: { invalidateCaches?: boolean } = {},
): Promise<void> {
  const playbackMetadata = media.type === 'video'
    ? await readLinkedVideoPlaybackMetadata(file)
    : {};
  const url = createPrimaryMediaObjectUrl(media.id, file);
  useMediaStore.setState((state) => ({
    files: state.files.map((candidate) => candidate.id === media.id
      ? {
          ...candidate,
          ...playbackMetadata,
          file,
          url,
          hasFileHandle: true,
          sourceSelection: selection,
        }
      : candidate),
  }));
  linkedMediaSourceRuntime.setActive(media.id, active);
  markTimelineClipsForReload(media.id);
  await updateTimelineClips(media.id, file, {
    generateThumbnails: false,
    invalidateCaches: options.invalidateCaches,
  });
  if (media.type === 'video' && !media.thumbnailUrl) {
    queueLinkedVideoThumbnail(media, file, playbackMetadata.videoCodecId);
  }
}

async function readLinkedVideoPlaybackMetadata(file: File): Promise<Partial<MediaFile>> {
  try {
    const info = await getMediaInfo(file, 'video');
    return {
      videoCodecId: info.videoCodecId,
      codec: info.codec,
      audioCodec: info.audioCodec,
      container: info.container,
      fps: info.fps,
      codedWidth: info.codedWidth,
      codedHeight: info.codedHeight,
      rotation: info.rotation,
      pixelAspectRatio: info.pixelAspectRatio,
      videoColorSpace: info.videoColorSpace,
      hasHighDynamicRange: info.hasHighDynamicRange,
      canBeTransparent: info.canBeTransparent,
      hasAudio: info.hasAudio,
    };
  } catch {
    return {};
  }
}

function queueLinkedVideoThumbnail(
  media: MediaFile,
  file: File,
  videoCodecId: string | undefined,
): void {
  linkedThumbnailQueue = linkedThumbnailQueue.then(async () => {
    const thumbnailUrl = await createThumbnail(file, 'video', {
      videoCodecId,
      duration: media.duration,
    });
    if (!thumbnailUrl) return;
    useMediaStore.setState((state) => ({
      files: state.files.map((candidate) => candidate.id === media.id && candidate.file === file
        ? { ...candidate, thumbnailUrl }
        : candidate),
    }));
  }).catch(() => undefined);
}

function setOfflineSource(media: MediaFile, selection: MediaSourceSelection): void {
  useMediaStore.setState((state) => ({
    files: state.files.map((candidate) => candidate.id === media.id
      ? { ...candidate, file: undefined, url: '', hasFileHandle: false, sourceSelection: selection }
      : candidate),
  }));
  if (selection.mode === 'original') {
    linkedMediaSourceRuntime.setActive(media.id, { kind: 'original' });
  } else {
    linkedMediaSourceRuntime.clearActive(media.id);
  }
  markTimelineClipsForReload(media.id);
}

function setSourceSelection(mediaId: string, selection: MediaSourceSelection): void {
  let didChange = false;
  useMediaStore.setState((state) => {
    const media = state.files.find((candidate) => candidate.id === mediaId);
    if (!media || isSourceSelectionEqual(media.sourceSelection, selection)) return state;
    didChange = true;
    return {
      files: state.files.map((candidate) => candidate.id === mediaId
        ? { ...candidate, sourceSelection: selection }
        : candidate),
    };
  });
  if (didChange && projectFileService.isProjectOpen()) projectFileService.markDirty();
}

function isSourceSelectionEqual(
  current: MediaSourceSelection | undefined,
  next: MediaSourceSelection,
): boolean {
  const currentMode = current?.mode ?? 'auto';
  return currentMode === next.mode
    && (next.mode !== 'linked' || (current?.mode === 'linked' && current.sourceId === next.sourceId));
}

function markTimelineClipsForReload(mediaId: string): void {
  const timeline = useTimelineStore.getState();
  for (const clip of timeline.clips) {
    if (clip.source?.mediaFileId !== mediaId) continue;
    releaseClipSourceRuntime(clip);
    timeline.updateClip(clip.id, {
      file: undefined,
      needsReload: true,
      isLoading: false,
      source: {
        ...clip.source,
        runtimeSourceId: undefined,
        runtimeSessionKey: undefined,
      },
    });
  }
}
