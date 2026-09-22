import type { Layer, TimelineClip } from '../../types';
import { resolveSceneEffectorsEnabled } from '../../engine/scene/SceneEffectorUtils';
import { prewarmGaussianSplatRuntime } from '../../engine/scene/runtime/SharedSplatRuntimeCache';
import { resolveSharedSplatUseNativeRenderer } from '../../engine/scene/runtime/SharedSplatRuntimeUtils';
import { useMediaStore } from '../../stores/mediaStore';
import { getReusableModelUrl } from '../../stores/timeline/restoredMediaSource';
import {
  getGaussianSplatSequenceFrame,
  getGaussianSplatSequenceFrameRuntimeKey,
  getGaussianSplatSequenceFrameUrl,
  resolveGaussianSplatSequenceData,
} from '../../utils/gaussianSplatSequence';
import { getModelSequenceFrame, getModelSequenceFrameUrl, resolveModelSequenceData } from '../../utils/modelSequence';
import { getMediaFileForClip, isVideoTrackVisible } from './FrameContext';
import { LAYER_BUILDER_CONSTANTS, type FrameContext } from './types';

export function getRenderableLayerFile(file: File | undefined): File | undefined {
  return file && (typeof file.size !== 'number' || file.size > 0) ? file : undefined;
}

export function getClipModelSequence(clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)
    : undefined;

  return resolveModelSequenceData(clip.source?.modelSequence, mediaFile?.modelSequence);
}

export function resolveClipModelFrame(clip: TimelineClip, sourceTime: number) {
  return getModelSequenceFrame(getClipModelSequence(clip), sourceTime);
}

export function resolveClipModelUrl(clip: TimelineClip, sourceTime: number): string | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)
    : undefined;

  return getModelSequenceFrameUrl(
    getClipModelSequence(clip),
    sourceTime,
    clip.source?.modelUrl ?? getReusableModelUrl(mediaFile),
  );
}

function getClipGaussianSplatSequence(clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const mediaSequence = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)?.gaussianSplatSequence
    : undefined;

  return resolveGaussianSplatSequenceData(clip.source?.gaussianSplatSequence, mediaSequence);
}

function resolveClipGaussianSplatFrame(clip: TimelineClip, sourceTime: number) {
  return getGaussianSplatSequenceFrame(
    getClipGaussianSplatSequence(clip),
    sourceTime,
  );
}

function resolveClipGaussianSplatUrl(clip: TimelineClip, sourceTime: number): string | undefined {
  return getGaussianSplatSequenceFrameUrl(
    getClipGaussianSplatSequence(clip),
    sourceTime,
    clip.source?.gaussianSplatUrl,
  );
}

function resolveClipGaussianSplatFile(
  clip: TimelineClip,
  sourceTime: number,
  mediaFile?: { file?: File },
): File | undefined {
  return (
    getRenderableLayerFile(resolveClipGaussianSplatFrame(clip, sourceTime)?.file) ??
    getRenderableLayerFile(mediaFile?.file) ??
    getRenderableLayerFile(clip.source?.file) ??
    getRenderableLayerFile(clip.file)
  );
}

export function buildGaussianSplatSourcePayload(
  clip: TimelineClip,
  clipLocalTime: number,
  mediaFile?: { id?: string; fileHash?: string; file?: File | undefined },
): Layer['source'] {
  const gaussianSplatSequence = getClipGaussianSplatSequence(clip);
  const sequenceFrame = resolveClipGaussianSplatFrame(clip, clipLocalTime);
  const useNativeRenderer = resolveSharedSplatUseNativeRenderer(clip.source?.gaussianSplatSettings);

  return {
    type: 'gaussian-splat',
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    file: resolveClipGaussianSplatFile(clip, clipLocalTime, mediaFile),
    gaussianSplatUrl: resolveClipGaussianSplatUrl(clip, clipLocalTime),
    gaussianSplatFileName: sequenceFrame?.name ?? clip.source?.gaussianSplatFileName ?? clip.file?.name ?? clip.name,
    gaussianSplatFileHash: gaussianSplatSequence ? undefined : mediaFile?.fileHash,
    gaussianSplatRuntimeKey: getGaussianSplatSequenceFrameRuntimeKey(
      gaussianSplatSequence,
      clipLocalTime,
      clip.source?.gaussianSplatRuntimeKey ??
        clip.source?.gaussianSplatFileHash ??
        clip.source?.gaussianSplatFileName ??
        clip.source?.gaussianSplatUrl ??
        clip.id,
    ),
    gaussianSplatSequence,
    gaussianSplatSettings: clip.source?.gaussianSplatSettings
      ? {
          ...clip.source.gaussianSplatSettings,
          render: {
            ...clip.source.gaussianSplatSettings.render,
            useNativeRenderer,
          },
        }
      : clip.source?.gaussianSplatSettings,
    threeDEffectorsEnabled: resolveSceneEffectorsEnabled(clip.source?.threeDEffectorsEnabled),
    mediaTime: clipLocalTime,
  };
}

export function prewarmGaussianSplatClips(ctx: FrameContext, lastSplatLookaheadTime: number): number {
  if (ctx.now - lastSplatLookaheadTime < LAYER_BUILDER_CONSTANTS.LOOKAHEAD_INTERVAL) {
    return lastSplatLookaheadTime;
  }

  const lookBehind = ctx.isDraggingPlayhead ? 1.25 : 0.1;
  const lookAhead = ctx.isPlaying ? LAYER_BUILDER_CONSTANTS.LOOKAHEAD_SECONDS : 1.25;
  const rangeStart = Math.max(0, ctx.playheadPosition - lookBehind);
  const rangeEnd = ctx.playheadPosition + lookAhead;

  for (const clip of ctx.clips) {
    if (clip.source?.type !== 'gaussian-splat') continue;
    if (!isVideoTrackVisible(ctx, clip.trackId)) continue;
    if (clip.startTime > rangeEnd || clip.startTime + clip.duration < rangeStart) continue;
    // Native rendering owns its own parse/upload cache. Preparing the legacy
    // texture runtime as well duplicates large-file work and can monopolize the
    // main thread immediately after an import.
    if (resolveSharedSplatUseNativeRenderer(clip.source.gaussianSplatSettings)) continue;

    const mediaFile = getMediaFileForClip(ctx, clip);
    if (clip.source?.gaussianSplatSequence || mediaFile?.gaussianSplatSequence) continue;
    const file = mediaFile?.file ?? clip.file;
    if (!file) continue;

    prewarmGaussianSplatRuntime({
      cacheKey:
        mediaFile?.fileHash ??
        mediaFile?.id ??
        clip.source?.mediaFileId ??
        clip.id,
      fileHash: mediaFile?.fileHash,
      file,
      url: clip.source?.gaussianSplatUrl,
      fileName: file.name || clip.name,
      requestedMaxSplats: clip.source?.gaussianSplatSettings?.render.maxSplats ?? 0,
    });
  }

  return ctx.now;
}
