import { Logger } from '../../services/logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import { engine } from '../WebGPUEngine';
import { waitForTargetPreparedSplatRuntime } from '../three/splatRuntimeCache';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';

const log = Logger.create('ExportAssetPreload');
const MAX_EXPORT_NESTING_DEPTH = 4;

interface PreloadOptions {
  startTime: number;
  endTime: number;
}

interface Preload3DOptions extends PreloadOptions {
  width: number;
  height: number;
}

function clipOverlapsRange(
  clip: { startTime: number; duration: number },
  startTime: number,
  endTime: number,
): boolean {
  return clip.startTime < endTime && clip.startTime + clip.duration > startTime;
}

function getVisibleVideoTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  const videoTracks = tracks.filter((track) => track.type === 'video');
  const anyVideoSolo = videoTracks.some((track) => track.solo);
  return videoTracks.filter((track) => track.visible !== false && (!anyVideoSolo || track.solo));
}

function collectRenderableClipsRecursive(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  startTime: number,
  endTime: number,
  depth: number,
  result: TimelineClip[],
): void {
  if (depth >= MAX_EXPORT_NESTING_DEPTH) {
    return;
  }

  for (const track of getVisibleVideoTracks(tracks)) {
    const overlappingClips = clips.filter((clip) =>
      clip.trackId === track.id &&
      clipOverlapsRange(clip, startTime, endTime),
    );

    for (const clip of overlappingClips) {
      result.push(clip);

      if (!clip.isComposition || !clip.nestedClips || !clip.nestedTracks) {
        continue;
      }

      const overlapStart = Math.max(startTime, clip.startTime);
      const overlapEnd = Math.min(endTime, clip.startTime + clip.duration);
      if (overlapEnd <= overlapStart) {
        continue;
      }

      const nestedStart = overlapStart - clip.startTime + (clip.inPoint || 0);
      const nestedEnd = overlapEnd - clip.startTime + (clip.inPoint || 0);
      collectRenderableClipsRecursive(
        clip.nestedClips,
        clip.nestedTracks,
        nestedStart,
        nestedEnd,
        depth + 1,
        result,
      );
    }
  }
}

export function collectRenderableExportClipsInRange(
  startTime: number,
  endTime: number,
  tracks: TimelineTrack[] = useTimelineStore.getState().tracks,
  clips: TimelineClip[] = useTimelineStore.getState().clips,
): TimelineClip[] {
  const result: TimelineClip[] = [];
  collectRenderableClipsRecursive(clips, tracks, startTime, endTime, 0, result);
  return result;
}

export async function preloadGaussianSplatsForExport(options: PreloadOptions): Promise<void> {
  const clips = collectRenderableExportClipsInRange(options.startTime, options.endTime).filter((clip) =>
    clip.source?.type === 'gaussian-splat',
  );

  if (clips.length === 0) {
    return;
  }

  const uniqueSplats = new Map<string, {
    cacheKey: string;
    clipId: string;
    url: string;
    fileName: string;
    fileHash?: string;
    file?: File;
    useNativeRenderer: boolean;
  }>();
  for (const clip of clips) {
    const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    const mediaFile = mediaFileId
      ? useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null
      : null;
    const url = clip.source?.gaussianSplatUrl;
    if (!url) continue;
    const fileName =
      clip.source?.gaussianSplatFileName ??
      mediaFile?.file?.name ??
      clip.file?.name ??
      mediaFile?.name ??
      clip.name;
    const file = clip.file && (typeof clip.file.size !== 'number' || clip.file.size > 0)
      ? clip.file
      : mediaFile?.file && (typeof mediaFile.file.size !== 'number' || mediaFile.file.size > 0)
        ? mediaFile.file
      : undefined;
    const fileHash = clip.source?.gaussianSplatSequence || mediaFile?.gaussianSplatSequence
      ? undefined
      : (clip.source?.gaussianSplatFileHash ?? mediaFile?.fileHash);
    const useNativeRenderer =
      clip.source?.gaussianSplatSettings?.render.useNativeRenderer ??
      DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.useNativeRenderer;
    const cacheKey = fileHash ?? mediaFileId ?? `${fileName || url || clip.id}|${url || clip.id}`;
    uniqueSplats.set(cacheKey, {
      cacheKey,
      clipId: clip.id,
      url,
      fileName,
      fileHash,
      file,
      useNativeRenderer,
    });
  }

  if (uniqueSplats.size === 0) {
    return;
  }

  const splatEntries = [...uniqueSplats.values()];
  const nativeSplats = splatEntries.filter((entry) => entry.useNativeRenderer);
  const threeSplats = splatEntries.filter((entry) => !entry.useNativeRenderer);

  const nativeResults = await Promise.allSettled(
    nativeSplats.map(({ clipId, url, fileName }) =>
      engine.ensureGaussianSplatSceneLoaded(clipId, url, fileName),
    ),
  );

  let threeResults: PromiseSettledResult<unknown>[] = [];
  if (threeSplats.length > 0) {
    const initialized = await engine.ensureThreeSceneRendererInitialized(1, 1);
    if (!initialized) {
      log.warn('Three.js renderer could not be initialized for gaussian splat export preloading');
    } else {
      threeResults = await Promise.allSettled(
        threeSplats.map(({ cacheKey, fileHash, file, url, fileName }) =>
          waitForTargetPreparedSplatRuntime({
            cacheKey,
            fileHash,
            file,
            url,
            fileName,
            // Export should build the full splat runtime, regardless of preview cap.
            requestedMaxSplats: 0,
          }),
        ),
      );
    }
  }

  nativeResults.forEach((result, index) => {
    const clip = nativeSplats[index];
    if (result.status === 'rejected') {
      log.warn('Gaussian splat preload failed', { clipId: clip.clipId, error: result.reason });
      return;
    }
    if (!result.value) {
      log.warn('Gaussian splat preload did not finish with a ready scene', { clipId: clip.clipId });
    }
  });

  threeResults.forEach((result, index) => {
    const clip = threeSplats[index];
    if (result.status === 'rejected') {
      log.warn('Three.js gaussian splat runtime preload failed', { clipId: clip.clipId, error: result.reason });
    }
  });
}

export async function preload3DAssetsForExport(options: Preload3DOptions): Promise<void> {
  const clips = collectRenderableExportClipsInRange(options.startTime, options.endTime).filter((clip) =>
    clip.is3D === true &&
    clip.source?.type !== 'gaussian-splat' &&
    clip.source?.type !== 'camera' &&
    clip.source?.type !== 'splat-effector'
  );

  if (clips.length === 0) {
    return;
  }

  const rendererReady = await engine.ensureThreeSceneRendererInitialized(options.width, options.height);
  if (!rendererReady) {
    log.warn('Three.js renderer could not be initialized before export');
    return;
  }

  const modelPreloads = [...new Map(
    clips
      .filter((clip) => clip.source?.type === 'model' && !!clip.source.modelUrl)
      .map((clip) => [
        clip.source!.modelUrl!,
        {
          clipId: clip.id,
          modelUrl: clip.source!.modelUrl!,
          fileName: clip.file?.name ?? clip.name,
        },
      ]),
  ).values()];

  if (modelPreloads.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    modelPreloads.map((preload) =>
      engine.preloadThreeModelAsset(preload.modelUrl, preload.fileName),
    ),
  );
  results.forEach((result, index) => {
    const clip = modelPreloads[index];
    if (!clip) return;
    if (result.status === 'rejected') {
      log.warn('3D model preload failed', { clipId: clip.clipId, error: result.reason });
      return;
    }
    if (!result.value) {
      log.warn('3D model preload completed without a cached model', { clipId: clip.clipId });
    }
  });
}
