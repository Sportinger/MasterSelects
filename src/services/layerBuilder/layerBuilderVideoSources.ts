import type { LayerSource } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import type { MediaFile } from '../../stores/mediaStore/types';
import { flags } from '../../engine/featureFlags';
import {
  canUseSharedPreviewRuntimeSession,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { getLazyTimelineVideoElementForClip } from '../timeline/lazyMediaElements';
import { selectPausedWebCodecsProvider } from './videoSyncWebCodecsPolicy';
import type { FrameContext } from './types';
import {
  hasWorkerGpuLayerVideoSource,
  isWorkerGpuOnlyRenderHost,
  resolveWorkerGpuLayerVideoSource,
} from './layerBuilderWorkerGpuVideoSources';
import { resolveRuntimeLayerBuilderVideoSource } from './layerBuilderRuntimeVideoSources';

type LayerVideoSource = LayerSource;

export interface LayerBuilderVideoSourceResolution {
  source: LayerVideoSource;
  intrinsicSize?: {
    width?: number;
    height?: number;
  };
}

function getLayerBuilderVideoElement(clip: TimelineClip): HTMLVideoElement | null {
  return getLazyTimelineVideoElementForClip(clip) ?? clip.source?.videoElement ?? null;
}

export function resetLayerBuilderReverseRuntimePresentationForTests(): void {
  // Kept for tests that reset layer-builder preview policy between cases.
}

export interface LayerBuilderVideoSourceDebugInfo {
  hasVideoElement: boolean;
  videoReadyState: number | null;
  hasWebCodecsPlayer: boolean;
  webCodecsFullMode: boolean;
  webCodecsHasFrame: boolean;
  webCodecsPendingSeek: number | null;
}

export function hasLayerBuilderRenderableVideoSource(
  source: TimelineClip['source'] | undefined,
  clip?: TimelineClip,
  mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>,
): boolean {
  if (clip && isWorkerGpuOnlyRenderHost() && flags.useFullWebCodecsPlayback) {
    return hasWorkerGpuLayerVideoSource(clip, mediaFile);
  }
  return !!(
    (clip ? getLayerBuilderVideoElement(clip) : source?.videoElement) ||
    source?.webCodecsPlayer?.isFullMode?.()
  );
}

export function selectLayerBuilderPausedVisualProvider(
  source: TimelineClip['source'],
  runtimeProvider: RuntimeFrameProvider | null,
  targetTime: number,
  options?: { preferFreshRuntime?: boolean },
): RuntimeFrameProvider | undefined {
  return selectPausedWebCodecsProvider(
    source?.webCodecsPlayer,
    runtimeProvider,
    targetTime,
    options,
  ) ?? undefined;
}

export function getLayerBuilderVideoSourceDebugInfo(clip: TimelineClip): LayerBuilderVideoSourceDebugInfo {
  const video = getLayerBuilderVideoElement(clip);
  const provider = clip.source?.webCodecsPlayer;
  return {
    hasVideoElement: !!video,
    videoReadyState: video?.readyState ?? null,
    hasWebCodecsPlayer: !!provider,
    webCodecsFullMode: provider?.isFullMode?.() ?? false,
    webCodecsHasFrame: provider?.hasFrame?.() ?? false,
    webCodecsPendingSeek: provider?.getPendingSeekTime?.() ?? null,
  };
}

export function pauseLayerBuilderVideoSource(clip: TimelineClip, ctx: FrameContext): void {
  const video = getLayerBuilderVideoElement(clip);
  if (video && !video.paused) {
    video.pause();
  }

  const allowSharedPreviewSession = canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime);
  const previewSource = getPreviewRuntimeSource(clip.source, clip.trackId, allowSharedPreviewSession);
  const scrubSource = getScrubRuntimeSource(clip.source, clip.trackId, allowSharedPreviewSession);
  getRuntimeFrameProvider(previewSource)?.pause();
  getRuntimeFrameProvider(scrubSource)?.pause();
  clip.source?.webCodecsPlayer?.pause();
}

export function resolveLayerBuilderVideoSource(params: {
  clip: TimelineClip;
  ctx: FrameContext;
  targetTime: number;
  allowSharedPreviewSession: boolean;
  continuationVideo?: HTMLVideoElement | null;
  workerGpuMediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>;
}): LayerBuilderVideoSourceResolution | null {
  const { clip, ctx, targetTime } = params;
  const workerGpuSource = isWorkerGpuOnlyRenderHost() && flags.useFullWebCodecsPlayback
    ? resolveWorkerGpuLayerVideoSource({
        clip,
        targetTime,
        mediaFile: params.workerGpuMediaFile,
      })
    : null;
  if (workerGpuSource) {
    return workerGpuSource;
  }
  if (isWorkerGpuOnlyRenderHost() && flags.useFullWebCodecsPlayback) {
    return null;
  }

  return resolveRuntimeLayerBuilderVideoSource({
    clip,
    ctx,
    targetTime,
    allowSharedPreviewSession: params.allowSharedPreviewSession,
    continuationVideo: params.continuationVideo,
    getVideoElement: getLayerBuilderVideoElement,
    selectPausedVisualProvider: selectLayerBuilderPausedVisualProvider,
  });
}
