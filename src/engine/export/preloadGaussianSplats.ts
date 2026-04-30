import { Logger } from '../../services/logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import { engine } from '../WebGPUEngine';
import {
  buildSharedSplatRuntimeRequest,
  getUsableSplatFile,
} from '../scene/runtime/SharedSplatRuntimeUtils';

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

  const uniqueSplats = new Map<string, ReturnType<typeof buildSharedSplatRuntimeRequest>>();
  for (const clip of clips) {
    const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    const mediaFile = mediaFileId
      ? useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null
      : null;
    const url = clip.source?.gaussianSplatUrl;
    const fileName =
      clip.source?.gaussianSplatFileName ??
      mediaFile?.file?.name ??
      clip.file?.name ??
      mediaFile?.name ??
      clip.name;
    const file = getUsableSplatFile(clip.file, mediaFile?.file);
    const gaussianSplatSequence = clip.source?.gaussianSplatSequence ?? mediaFile?.gaussianSplatSequence;
    const fileHash = gaussianSplatSequence
      ? undefined
      : (clip.source?.gaussianSplatFileHash ?? mediaFile?.fileHash);
    const request = buildSharedSplatRuntimeRequest({
      clipId: clip.id,
      runtimeKey: clip.source?.gaussianSplatRuntimeKey,
      url,
      file,
      fileName,
      fileHash,
      mediaFileId,
      gaussianSplatSequence,
      gaussianSplatSettings: clip.source?.gaussianSplatSettings,
      requestedMaxSplats: 0,
    });
    uniqueSplats.set(request.sceneKey, request);
  }

  if (uniqueSplats.size === 0) {
    return;
  }

  const nativeSplats = [...uniqueSplats.values()];
  const nativePreloadSplats = nativeSplats.filter(({ url, file }) => !!url || !!file);

  const nativeResults = await Promise.allSettled(
    nativePreloadSplats.map(({ sceneKey, clipId, url, fileName, file }) =>
        engine.ensureGaussianSplatSceneLoaded({
          sceneKey,
          clipId,
          url,
          fileName,
          file,
          showProgress: false,
        }),
      ),
  );

  nativeSplats
    .filter(({ url, file }) => !url && !file)
    .forEach(({ clipId }) => {
      log.warn('Native scene gaussian splat preload skipped because no URL or file was available', { clipId });
    });

  nativeResults.forEach((result, index) => {
    const clip = nativePreloadSplats[index];
    if (!clip) {
      return;
    }
    if (result.status === 'rejected') {
      log.warn('Native scene gaussian splat preload failed', { clipId: clip.clipId, error: result.reason });
      return;
    }
    if (!result.value) {
      log.warn('Native scene gaussian splat preload did not finish with a ready scene', { clipId: clip.clipId });
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

  const rendererReady = await engine.ensureSceneRendererInitialized(options.width, options.height);
  if (!rendererReady) {
    log.warn('Shared scene renderer could not be initialized before export');
    return;
  }

  const modelPreloads = [...new Map(
    clips
      .filter((clip) => clip.source?.type === 'model' && !!clip.source.modelUrl)
      .map((clip) => {
        const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
        const mediaFile = mediaFileId
          ? useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null
          : null;
        const modelSequence = clip.source?.modelSequence ?? mediaFile?.modelSequence;
        const preloadKey = modelSequence
          ? `${clip.source!.modelUrl!}|sequence|${modelSequence.sequenceName ?? ''}|${modelSequence.frameCount}|${modelSequence.fps}`
          : clip.source!.modelUrl!;
        return [
          preloadKey,
          {
            clipId: clip.id,
            modelUrl: clip.source!.modelUrl!,
            fileName: clip.file?.name ?? clip.name,
            ...(modelSequence ? { modelSequence } : {}),
          },
        ] as const;
      }),
  ).values()];

  if (modelPreloads.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    modelPreloads.map((preload) => (
      preload.modelSequence
        ? engine.preloadSceneModelAsset(preload.modelUrl, preload.fileName, preload.modelSequence)
        : engine.preloadSceneModelAsset(preload.modelUrl, preload.fileName)
    )),
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
