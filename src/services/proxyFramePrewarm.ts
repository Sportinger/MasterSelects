import type { MediaFile } from '../stores/mediaStore/types';
import type { TimelineClip } from '../types';
import { proxyFrameCache } from './proxyFrameCache';

type TimelineProxyPrewarmState = {
  clips: TimelineClip[];
  getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
  getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
};

export type ProxyFramePrewarmRequest = {
  mediaFileId: string;
  mediaTime: number;
  frameIndex: number;
  fps: number;
};

const lastPrewarmFrameByMediaId = new Map<string, number>();

function getMediaFileForClip(mediaFiles: readonly MediaFile[], clip: TimelineClip): MediaFile | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (mediaFileId) {
    return mediaFiles.find(file => file.id === mediaFileId);
  }

  return clip.name ? mediaFiles.find(file => file.name === clip.name) : undefined;
}

function hasVideoProxyCandidate(clip: TimelineClip, mediaFile: MediaFile): boolean {
  if (!clip.source?.videoElement && !clip.source?.webCodecsPlayer) {
    return false;
  }

  if (mediaFile.proxyStatus === 'ready') {
    return true;
  }

  return mediaFile.proxyStatus === 'generating' && (mediaFile.proxyProgress ?? 0) > 0;
}

function getClipProxyMediaTime(
  state: TimelineProxyPrewarmState,
  clip: TimelineClip,
  timelinePosition: number
): number {
  const clipLocalTime = Math.max(0, timelinePosition - clip.startTime);
  const initialSpeed = state.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  const sourceTime = state.getSourceTimeForClip(clip.id, clipLocalTime);
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

export function collectProxyFramePrewarmRequests(
  state: TimelineProxyPrewarmState,
  mediaFiles: readonly MediaFile[],
  timelinePosition: number
): ProxyFramePrewarmRequest[] {
  const requests: ProxyFramePrewarmRequest[] = [];
  const seen = new Set<string>();
  const epsilon = 1e-6;

  for (const clip of state.clips) {
    if (
      timelinePosition + epsilon < clip.startTime ||
      timelinePosition >= clip.startTime + clip.duration
    ) {
      continue;
    }

    const mediaFile = getMediaFileForClip(mediaFiles, clip);
    if (!mediaFile || !hasVideoProxyCandidate(clip, mediaFile)) {
      continue;
    }

    const fps = mediaFile.proxyFps || 30;
    const mediaTime = getClipProxyMediaTime(state, clip, timelinePosition);
    const frameIndex = Math.max(0, Math.floor(mediaTime * fps));
    const key = `${mediaFile.id}:${frameIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    requests.push({
      mediaFileId: mediaFile.id,
      mediaTime,
      frameIndex,
      fps,
    });
  }

  return requests;
}

export function prewarmProxyFramesForTimelinePosition(
  state: TimelineProxyPrewarmState,
  mediaFiles: readonly MediaFile[],
  timelinePosition: number
): void {
  for (const request of collectProxyFramePrewarmRequests(state, mediaFiles, timelinePosition)) {
    const lastFrameIndex = lastPrewarmFrameByMediaId.get(request.mediaFileId);
    if (lastFrameIndex === request.frameIndex) {
      continue;
    }
    lastPrewarmFrameByMediaId.set(request.mediaFileId, request.frameIndex);

    proxyFrameCache.getCachedVideoFrame(request.mediaFileId, request.frameIndex);
    void proxyFrameCache
      .getVideoFrame(request.mediaFileId, request.mediaTime, request.fps)
      .catch(() => {
        // Proxy prewarm is opportunistic; the render path still has normal fallbacks.
      });
  }
}
