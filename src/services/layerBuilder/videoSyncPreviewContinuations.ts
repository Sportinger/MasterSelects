import type { TimelineClip } from '../../types';

const PREVIEW_CONTINUATION_MS = 180;
const PREVIEW_CONTINUATION_TARGET_EPSILON = 0.22;
const PREVIEW_CONTINUATION_OWN_READY_EPSILON = 0.12;

export interface VideoSyncTrackState {
  clipId: string;
  fileId: string;
  file: File;
  videoElement: HTMLVideoElement;
  outPoint: number;
  continuityKey?: string;
}

export interface PreviewContinuationOptions {
  trackKey?: string;
  continuityKey?: string;
}

function getClipSourceKey(clip: TimelineClip): string {
  return clip.source?.mediaFileId || clip.mediaFileId || '';
}

function isSameSource(clip: TimelineClip, previous: VideoSyncTrackState): boolean {
  const sourceKey = getClipSourceKey(clip);
  return sourceKey ? sourceKey === previous.fileId : clip.file === previous.file;
}

function canUseVideo(video: HTMLVideoElement, targetTime: number): boolean {
  return Math.abs(video.currentTime - targetTime) <= PREVIEW_CONTINUATION_TARGET_EPSILON && !video.seeking;
}

function ownVideoNeedsContinuation(video: HTMLVideoElement, targetTime: number): boolean {
  return (
    (video.played?.length ?? 0) === 0 ||
    video.readyState < 2 ||
    video.seeking ||
    Math.abs(video.currentTime - targetTime) > PREVIEW_CONTINUATION_OWN_READY_EPSILON
  );
}

export class VideoSyncPreviewContinuationManager {
  private elements = new Map<string, {
    clipId: string;
    videoElement: HTMLVideoElement;
    expiresAt: number;
  }>();

  reset(): void {
    this.elements.clear();
  }

  getRetainedVideoElements(now: number): ReadonlySet<HTMLVideoElement> {
    this.clearExpired(now);
    return new Set(Array.from(this.elements.values(), entry => entry.videoElement));
  }

  get(
    clip: TimelineClip,
    targetTime: number,
    ownVideo: HTMLVideoElement | null,
    previous: VideoSyncTrackState | undefined,
    options: PreviewContinuationOptions = {},
  ): HTMLVideoElement | null {
    if (!ownVideo) return null;

    const now = performance.now();
    this.clearExpired(now);
    const entryKey = JSON.stringify([options.trackKey ?? clip.trackId, clip.id]);
    if (!ownVideoNeedsContinuation(ownVideo, targetTime)) {
      this.elements.delete(entryKey);
      return null;
    }

    const stored = this.elements.get(entryKey);
    if (stored && stored.videoElement !== ownVideo && canUseVideo(stored.videoElement, targetTime)) {
      return stored.videoElement;
    }
    if (!previous || previous.videoElement === ownVideo || !isSameSource(clip, previous)) {
      this.elements.delete(entryKey);
      return null;
    }

    const sameLogicalNestedClip = !!options.continuityKey &&
      previous.continuityKey === options.continuityKey;
    const isSequentialCut = Math.abs(clip.inPoint - previous.outPoint) <= 0.1;
    if (
      (previous.clipId !== clip.id && !sameLogicalNestedClip && !isSequentialCut) ||
      !canUseVideo(previous.videoElement, targetTime)
    ) {
      this.elements.delete(entryKey);
      return null;
    }

    this.elements.set(entryKey, {
      clipId: clip.id,
      videoElement: previous.videoElement,
      expiresAt: now + PREVIEW_CONTINUATION_MS,
    });
    return previous.videoElement;
  }

  resetClip(clipId: string): void {
    for (const [key, entry] of this.elements) {
      if (entry.clipId === clipId) this.elements.delete(key);
    }
  }

  private clearExpired(now: number): void {
    for (const [key, entry] of this.elements) {
      if (entry.expiresAt <= now) this.elements.delete(key);
    }
  }
}
