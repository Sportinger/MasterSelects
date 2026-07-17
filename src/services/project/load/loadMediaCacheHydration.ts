import { Logger } from '../../logger';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import { getMediaInfo } from '../../../stores/mediaStore/helpers/mediaInfoHelpers';
import {
  getExpectedProxyFps,
  isProxyFrameIndexSetComplete,
} from '../../../stores/mediaStore/helpers/proxyCompleteness';
import { projectFileService, type ProjectMediaFile } from '../../projectFileService';
import { projectDB } from '../../projectDB';
import { withProjectStoreSyncGuard } from '../projectSave';
import { createThumbnailMediaObjectUrl } from '../mediaObjectUrlManager';
import { yieldToBrowser } from './loadProgress';

const log = Logger.create('ProjectSync');
const CACHED_THUMBNAIL_RESTORE_BATCH_SIZE = 48;

type MediaStoreSnapshot = ReturnType<typeof useMediaStore.getState>;
type MediaStoreUpdate =
  | Partial<MediaStoreSnapshot>
  | ((state: MediaStoreSnapshot) => Partial<MediaStoreSnapshot>);

export function calcRangeCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  const covered = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.min(1, covered / totalDuration);
}

export function projectMediaCanHaveAudio(mediaFile: ProjectMediaFile): boolean {
  if (mediaFile.liveInput) return false;
  if (mediaFile.type === 'audio') return true;
  if (mediaFile.type !== 'video') return false;
  return mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec);
}

export async function applyProjectRestoreMediaUpdate(update: MediaStoreUpdate): Promise<void> {
  await withProjectStoreSyncGuard(async () => {
    useMediaStore.setState(update);
  });
}

export function isProjectMediaThumbnailCandidate(media: ProjectMediaFile): boolean {
  return !media.liveInput && Boolean(media.fileHash) && (media.type === 'image' || media.type === 'video');
}

async function applyCachedThumbnailBatch(thumbnailsById: Map<string, Blob>): Promise<number> {
  if (thumbnailsById.size === 0) return 0;

  let appliedCount = 0;
  await applyProjectRestoreMediaUpdate((state) => ({
    files: state.files.map((file) => {
      const thumbnailBlob = thumbnailsById.get(file.id);
      if (!thumbnailBlob || file.thumbnailUrl) return file;
      const thumbnailUrl = createThumbnailMediaObjectUrl(file.id, thumbnailBlob);
      appliedCount += 1;
      return { ...file, thumbnailUrl };
    }),
  }));

  thumbnailsById.clear();
  return appliedCount;
}

export async function restoreCachedMediaThumbnails(
  projectMedia: ProjectMediaFile[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<number> {
  const candidates = projectMedia.filter(isProjectMediaThumbnailCandidate);
  const thumbnailsById = new Map<string, Blob>();
  let restoredCount = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const media = candidates[index];
    onProgress?.(index, candidates.length, media.name);

    const currentFile = useMediaStore.getState().files.find((file) => file.id === media.id);
    if (currentFile?.thumbnailUrl || !media.fileHash) continue;

    try {
      const storedThumbnail = await projectDB.getThumbnail(media.fileHash);
      let thumbnailBlob = storedThumbnail?.blob ?? null;

      if ((!thumbnailBlob || thumbnailBlob.size <= 0) && projectFileService.isProjectOpen()) {
        thumbnailBlob = await projectFileService.getThumbnail(media.fileHash);
        if (thumbnailBlob && thumbnailBlob.size > 0) {
          void projectDB.saveThumbnail({ fileHash: media.fileHash, blob: thumbnailBlob, createdAt: Date.now() });
        }
      }

      if (thumbnailBlob && thumbnailBlob.size > 0) thumbnailsById.set(media.id, thumbnailBlob);
      if (thumbnailsById.size >= CACHED_THUMBNAIL_RESTORE_BATCH_SIZE) {
        restoredCount += await applyCachedThumbnailBatch(thumbnailsById);
      }
    } catch (error) {
      log.debug('Cached thumbnail restore skipped', { id: media.id, name: media.name, error });
    }

    if (index % 12 === 0) await yieldToBrowser();
  }

  restoredCount += await applyCachedThumbnailBatch(thumbnailsById);
  onProgress?.(candidates.length, candidates.length, '');
  return restoredCount;
}

export async function refreshMediaMetadata(
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<void> {
  const mediaState = useMediaStore.getState();
  const filesToRefresh = mediaState.files.filter(f =>
    (f.type === 'video' || f.type === 'audio' || f.type === 'image') &&
    f.file && (
      f.codec === undefined ||
      f.container === undefined ||
      f.fileSize === undefined ||
      (f.type === 'video' && f.hasAudio === undefined)
    )
  );

  if (filesToRefresh.length === 0) {
    log.debug('No files need metadata refresh');
    return;
  }

  log.info('Refreshing metadata for ' + filesToRefresh.length + ' files...');

  const batchSize = 3;
  let completed = 0;
  for (let i = 0; i < filesToRefresh.length; i += batchSize) {
    const batch = filesToRefresh.slice(i, i + batchSize);

    await Promise.all(batch.map(async (mediaFile) => {
      if (!mediaFile.file) {
        completed++;
        onProgress?.(completed, filesToRefresh.length, mediaFile.name);
        return;
      }

      try {
        const info = await getMediaInfo(mediaFile.file, mediaFile.type as 'video' | 'audio' | 'image');
        await applyProjectRestoreMediaUpdate((state) => ({
          files: state.files.map((f) =>
            f.id === mediaFile.id
              ? {
                  ...f,
                  codec: info.codec || f.codec,
                  audioCodec: info.audioCodec,
                  container: info.container || f.container,
                  bitrate: info.bitrate || f.bitrate,
                  fileSize: info.fileSize || f.fileSize,
                  hasAudio: info.hasAudio ?? f.hasAudio,
                  fps: info.fps || f.fps,
                }
              : f
          ),
        }));

        log.debug('Refreshed metadata for: ' + mediaFile.name, {
          codec: info.codec,
          hasAudio: info.hasAudio,
          bitrate: info.bitrate,
        });
      } catch (e) {
        log.warn('Failed to refresh metadata for: ' + mediaFile.name, e);
      } finally {
        completed++;
        onProgress?.(completed, filesToRefresh.length, mediaFile.name);
      }
    }));
    await yieldToBrowser();
  }

  log.info('Media metadata refresh complete');
}

export async function restoreDeferredMediaCacheState(
  projectMedia: ProjectMediaFile[],
  onProgress?: (done: number, total: number, name: string, itemProgress?: number) => void,
): Promise<void> {
  if (!projectFileService.isProjectOpen() || projectMedia.length === 0) return;

  let completed = 0;
  for (const pm of projectMedia) {
    if (pm.liveInput) {
      completed++;
      onProgress?.(completed, projectMedia.length, pm.name);
      continue;
    }
    onProgress?.(completed, projectMedia.length, pm.name, 0);
    const updates: Partial<MediaFile> = {};

    try {
      const saved = await projectFileService.getTranscript(pm.id);
      if (saved) {
        const words = Array.isArray(saved)
          ? saved as import('../../../types').TranscriptWord[]
          : saved.words as import('../../../types').TranscriptWord[];
        if (words && words.length > 0) {
          updates.transcriptStatus = 'ready';
          updates.transcript = words;
          const transcribedRanges = Array.isArray(saved) ? undefined : saved.transcribedRanges;
          updates.transcribedRanges = transcribedRanges;
          updates.transcriptCoverage = pm.duration && pm.duration > 0
            ? (transcribedRanges?.length
                ? calcRangeCoverage(transcribedRanges, pm.duration)
                : calcRangeCoverage(words.map(w => [w.start, w.end]), pm.duration))
            : 0;
        }
      }
    } catch { /* no transcript file */ }

    try {
      const ranges = await projectFileService.getAnalysisRanges(pm.id);
      if (ranges.length > 0) {
        updates.analysisStatus = 'ready';
        if (pm.duration && pm.duration > 0) {
          const parsed: [number, number][] = ranges.map(key => {
            const [s, e] = key.split('-').map(Number);
            return [s, e];
          });
          updates.analysisCoverage = calcRangeCoverage(parsed, pm.duration);
        }
      }
    } catch { /* no analysis file */ }

    if (pm.type === 'video' && pm.hasProxy) {
      try {
        const proxyFps = getExpectedProxyFps(pm.frameRate);
        const proxyStorageKey = pm.fileHash || pm.id;
        onProgress?.(completed, projectMedia.length, pm.name + ' - proxy frames', 0.5);
        const frameIndices = await projectFileService.getProxyFrameIndices(proxyStorageKey);
        if (isProxyFrameIndexSetComplete(frameIndices, pm.duration, proxyFps)) {
          updates.proxyStatus = 'ready';
          updates.proxyFrameCount = frameIndices.size;
          updates.proxyFps = proxyFps;
          updates.proxyProgress = 100;
          updates.proxyFormat = 'jpeg-sequence';
        } else {
          updates.proxyStatus = 'none';
          updates.proxyFrameCount = undefined;
          updates.proxyFps = undefined;
          updates.proxyProgress = 0;
          updates.proxyFormat = undefined;
        }
      } catch {
        updates.proxyStatus = 'none';
        updates.proxyFrameCount = undefined;
        updates.proxyFps = undefined;
        updates.proxyProgress = 0;
        updates.proxyFormat = undefined;
      }
    }

    if (pm.hasAudioProxy || projectMediaCanHaveAudio(pm)) {
      const audioProxyStorageKey = pm.audioProxyStorageKey || pm.fileHash || pm.id;
      try {
        const hasProxyAudio = await projectFileService.hasProxyAudio(audioProxyStorageKey);
        updates.hasProxyAudio = hasProxyAudio;
        updates.audioProxyStatus = hasProxyAudio ? 'ready' : 'none';
        updates.audioProxyProgress = hasProxyAudio ? 100 : 0;
        updates.audioProxyStorageKey = audioProxyStorageKey;
      } catch {
        updates.hasProxyAudio = false;
        updates.audioProxyStatus = 'none';
        updates.audioProxyProgress = 0;
        updates.audioProxyStorageKey = audioProxyStorageKey;
      }
    }

    if (Object.keys(updates).length > 0) {
      await applyProjectRestoreMediaUpdate((state) => ({
        files: state.files.map((file) => (file.id === pm.id ? { ...file, ...updates } : file)),
      }));
    }

    completed++;
    onProgress?.(completed, projectMedia.length, pm.name);
    await yieldToBrowser();
  }
}
