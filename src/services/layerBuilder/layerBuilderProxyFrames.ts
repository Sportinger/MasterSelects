import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore/types';
import { getExpectedProxyFrameCount } from '../../stores/mediaStore/helpers/proxyCompleteness';
import { renderHostPort } from '../render/renderHostPort';
import { proxyFrameCache } from '../proxyFrameCache';
import { getMediaFileForClip } from './FrameContext';
import { LAYER_BUILDER_CONSTANTS, type FrameContext } from './types';

const SCRUB_PROXY_HOLD_MAX_DRIFT_SECONDS = 0.15;
const PAUSED_PROXY_HOLD_MAX_DRIFT_SECONDS = 0.5;
const PROXY_NEAREST_DISTANCE_DEFAULT = 30;
const PROXY_NEAREST_DISTANCE_SCRUB = 90;

type HeldProxyFrame = {
  frameIndex: number;
  image: HTMLImageElement;
};

export type LayerBuilderProxyFrameSelection = {
  image: HTMLImageElement;
  displayedMediaTime: number;
  targetMediaTime: number;
  previewPath: string;
  proxyFrameIndex: number;
};

export type LayerBuilderProxyFrameOptions = {
  clipId: string;
  mediaFile: MediaFile;
  targetMediaTime: number;
  isDraggingPlayhead: boolean;
  previewPathBase: string;
};

export function canUseHeldLayerBuilderProxyFrame(
  heldFrameIndex: number,
  targetMediaTime: number,
  proxyFps: number,
  isDraggingPlayhead: boolean,
): boolean {
  const heldMediaTime = heldFrameIndex / proxyFps;
  const frameFloor = (isDraggingPlayhead ? 3 : 6) / proxyFps;
  const maxDrift = Math.max(
    frameFloor,
    isDraggingPlayhead
      ? SCRUB_PROXY_HOLD_MAX_DRIFT_SECONDS
      : PAUSED_PROXY_HOLD_MAX_DRIFT_SECONDS,
  );
  return Math.abs(heldMediaTime - targetMediaTime) <= maxDrift;
}

function canUseProxyFrame(mediaFile: MediaFile, frameIndex: number, proxyFps: number): boolean {
  if (mediaFile.proxyFormat === 'mp4-all-intra') {
    return false;
  }

  if (mediaFile.proxyStatus === 'ready') {
    return true;
  }

  if (mediaFile.proxyStatus !== 'generating' || (mediaFile.proxyProgress || 0) <= 0) {
    return false;
  }

  const fallbackDuration = mediaFile.duration || 10;
  const totalFrames =
    getExpectedProxyFrameCount(fallbackDuration, proxyFps) ??
    Math.ceil(fallbackDuration * proxyFps);
  const maxGeneratedFrame = Math.floor(totalFrames * ((mediaFile.proxyProgress || 0) / 100));
  return frameIndex < maxGeneratedFrame;
}

function buildPreviewPath(base: string, suffix?: string): string {
  return suffix ? `${base}-${suffix}` : base;
}

function buildSelection(
  image: HTMLImageElement,
  frameIndex: number,
  proxyFps: number,
  targetMediaTime: number,
  previewPath: string,
): LayerBuilderProxyFrameSelection {
  return {
    image,
    displayedMediaTime: frameIndex / proxyFps,
    targetMediaTime,
    previewPath,
    proxyFrameIndex: frameIndex,
  };
}

export class LayerBuilderProxyFrames {
  private heldFrames = new Map<string, HeldProxyFrame>();
  private loadingFrames = new Set<string>();
  private lastNestedCompLookaheadTime = 0;

  clear(): void {
    this.heldFrames.clear();
    this.loadingFrames.clear();
  }

  selectProxyFrame(options: LayerBuilderProxyFrameOptions): LayerBuilderProxyFrameSelection | null {
    const proxyFps = options.mediaFile.proxyFps || 30;
    const frameIndex = Math.floor(options.targetMediaTime * proxyFps);

    if (!canUseProxyFrame(options.mediaFile, frameIndex, proxyFps)) return null;

    const cacheKey = `${options.mediaFile.id}_${options.clipId}`;
    const cachedFrame = proxyFrameCache.getCachedFrame(options.mediaFile.id, frameIndex, proxyFps);
    if (cachedFrame) {
      this.heldFrames.set(cacheKey, { frameIndex, image: cachedFrame });
      return buildSelection(
        cachedFrame,
        frameIndex,
        proxyFps,
        options.targetMediaTime,
        buildPreviewPath(options.previewPathBase),
      );
    }

    this.ensureProxyImageFrameLoaded(
      options.mediaFile.id,
      frameIndex,
      options.targetMediaTime,
      proxyFps,
      cacheKey,
    );

    const nearestDistance = options.isDraggingPlayhead
      ? PROXY_NEAREST_DISTANCE_SCRUB
      : PROXY_NEAREST_DISTANCE_DEFAULT;
    const nearestFrame = proxyFrameCache.getNearestCachedFrameEntry(
      options.mediaFile.id,
      frameIndex,
      nearestDistance,
    );
    if (nearestFrame) {
      return buildSelection(
        nearestFrame.image,
        nearestFrame.frameIndex,
        proxyFps,
        options.targetMediaTime,
        buildPreviewPath(options.previewPathBase, 'nearest'),
      );
    }

    const heldFrame = this.heldFrames.get(cacheKey);
    if (
      heldFrame?.image &&
      canUseHeldLayerBuilderProxyFrame(
        heldFrame.frameIndex,
        options.targetMediaTime,
        proxyFps,
        options.isDraggingPlayhead,
      )
    ) {
      return buildSelection(
        heldFrame.image,
        heldFrame.frameIndex,
        proxyFps,
        options.targetMediaTime,
        buildPreviewPath(options.previewPathBase, 'hold'),
      );
    }

    if (options.isDraggingPlayhead && heldFrame?.image) {
      return buildSelection(
        heldFrame.image,
        heldFrame.frameIndex,
        proxyFps,
        options.targetMediaTime,
        buildPreviewPath(options.previewPathBase, 'hold-stale'),
      );
    }

    return null;
  }

  prewarmUpcomingNestedCompFrames(ctx: FrameContext): void {
    if (ctx.now - this.lastNestedCompLookaheadTime < LAYER_BUILDER_CONSTANTS.LOOKAHEAD_INTERVAL) {
      return;
    }
    this.lastNestedCompLookaheadTime = ctx.now;

    const lookaheadEnd = ctx.playheadPosition + LAYER_BUILDER_CONSTANTS.LOOKAHEAD_SECONDS;
    const upcomingNestedComps = ctx.clips.filter(clip =>
      clip.isComposition &&
      clip.nestedClips &&
      clip.nestedClips.length > 0 &&
      clip.startTime > ctx.playheadPosition &&
      clip.startTime < lookaheadEnd,
    );

    for (const nestedCompClip of upcomingNestedComps) {
      this.prewarmNestedCompFrames(nestedCompClip, ctx);
    }
  }

  private ensureProxyImageFrameLoaded(
    mediaFileId: string,
    frameIndex: number,
    targetMediaTime: number,
    proxyFps: number,
    cacheKey: string,
  ): void {
    const loadKey = `${mediaFileId}_${frameIndex}`;
    if (this.loadingFrames.has(loadKey)) return;

    this.loadingFrames.add(loadKey);
    proxyFrameCache
      .getFrame(mediaFileId, targetMediaTime, proxyFps)
      .then((image) => {
        if (image) {
          this.heldFrames.set(cacheKey, { frameIndex, image });
          renderHostPort.requestRender();
        }
      })
      .finally(() => {
        this.loadingFrames.delete(loadKey);
      });
  }

  private prewarmNestedCompFrames(nestedCompClip: TimelineClip, ctx: FrameContext): void {
    if (!nestedCompClip.nestedClips) return;

    const nestedStartTime = nestedCompClip.inPoint || 0;

    for (const nestedClip of nestedCompClip.nestedClips) {
      if (!nestedClip.source?.videoElement) continue;

      if (
        nestedStartTime < nestedClip.startTime ||
        nestedStartTime >= nestedClip.startTime + nestedClip.duration
      ) {
        continue;
      }

      const mediaFile = getMediaFileForClip(ctx, nestedClip);
      if (!mediaFile?.proxyFps) continue;
      if (mediaFile.proxyStatus !== 'ready' && mediaFile.proxyStatus !== 'generating') continue;

      const nestedLocalTime = nestedStartTime - nestedClip.startTime;
      const nestedClipTime = nestedClip.reversed
        ? nestedClip.outPoint - nestedLocalTime
        : nestedLocalTime + nestedClip.inPoint;

      const proxyFps = mediaFile.proxyFps;
      const frameIndex = Math.floor(nestedClipTime * proxyFps);
      const framesToPreload = Math.min(60, Math.ceil(proxyFps * 2));
      for (let i = 0; i < framesToPreload; i++) {
        void proxyFrameCache.getFrame(mediaFile.id, (frameIndex + i) / proxyFps, proxyFps);
      }
    }
  }
}
