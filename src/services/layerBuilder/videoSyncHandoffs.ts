import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { Logger } from '../logger';
import type { FrameContext } from './types';

const log = Logger.create('CutTransition');

export interface VideoSyncTrackState {
  clipId: string;
  fileId: string;
  file: File;
  videoElement: HTMLVideoElement;
  outPoint: number;
}

type GetClipHtmlVideoElement = (clip: TimelineClip) => HTMLVideoElement | null;

const PREVIEW_CONTINUATION_MS = 180;
const PREVIEW_CONTINUATION_TARGET_EPSILON = 0.22;
const PREVIEW_CONTINUATION_OWN_READY_EPSILON = 0.12;

function getClipSourceKey(clip: TimelineClip): string {
  return clip.source?.mediaFileId || clip.mediaFileId || '';
}

function canUsePreviewContinuationVideo(
  video: HTMLVideoElement,
  targetTime: number,
  tolerance: number = PREVIEW_CONTINUATION_TARGET_EPSILON
): boolean {
  return Math.abs(video.currentTime - targetTime) <= tolerance && !video.seeking;
}

function clipNeedsPreviewContinuation(
  video: HTMLVideoElement,
  targetTime: number
): boolean {
  const ownDrift = Math.abs(video.currentTime - targetTime);
  const hasPlayed = (video.played?.length ?? 0) > 0;
  return (
    !hasPlayed ||
    video.readyState < 2 ||
    video.seeking ||
    ownDrift > PREVIEW_CONTINUATION_OWN_READY_EPSILON
  );
}

function isSameSourceSequentialClip(clip: TimelineClip, prev: VideoSyncTrackState): boolean {
  const clipFileId = getClipSourceKey(clip);
  const sameSource = clipFileId ? clipFileId === prev.fileId : clip.file === prev.file;
  return sameSource && Math.abs(clip.inPoint - prev.outPoint) <= 0.1;
}

export class VideoSyncHandoffManager {
  private lastTrackState = new Map<string, VideoSyncTrackState>();
  private activeHandoffs = new Map<string, HTMLVideoElement>();
  private handoffElements = new Set<HTMLVideoElement>();
  private previewContinuationElements = new Map<string, {
    videoElement: HTMLVideoElement;
    expiresAt: number;
  }>();

  reset(): void {
    this.lastTrackState.clear();
    this.activeHandoffs.clear();
    this.handoffElements.clear();
    this.previewContinuationElements.clear();
  }

  setTrackState(trackId: string, state: VideoSyncTrackState): void {
    this.lastTrackState.set(trackId, state);
  }

  getTrackState(trackId: string): VideoSyncTrackState | undefined {
    return this.lastTrackState.get(trackId);
  }

  hasHandoffElement(video: HTMLVideoElement): boolean {
    return this.handoffElements.has(video);
  }

  getHandoffVideoElement(clipId: string): HTMLVideoElement | null {
    return this.activeHandoffs.get(clipId) ?? null;
  }

  setHandoff(clipId: string, video: HTMLVideoElement): void {
    this.activeHandoffs.set(clipId, video);
    this.handoffElements.add(video);
  }

  deleteHandoff(clipId: string, video?: HTMLVideoElement): void {
    const handoffVideo = video ?? this.activeHandoffs.get(clipId);
    if (handoffVideo) {
      this.handoffElements.delete(handoffVideo);
    }
    this.activeHandoffs.delete(clipId);
  }

  compute(
    ctx: FrameContext,
    visibleClips: TimelineClip[],
    getClipHtmlVideoElement: GetClipHtmlVideoElement
  ): void {
    if (ctx.isDraggingPlayhead || ctx.hasClipDragPreview) {
      this.activeHandoffs.clear();
      this.handoffElements.clear();
      return;
    }

    if (!ctx.isPlaying) {
      for (const clipId of [...this.activeHandoffs.keys()]) {
        const settle = scrubSettleState.get(clipId);
        const keepHandoff =
          settle?.reason === 'playback-stop' &&
          scrubSettleState.isPending(clipId);
        if (!keepHandoff) {
          this.activeHandoffs.delete(clipId);
        }
      }

      this.handoffElements.clear();
      for (const handoff of this.activeHandoffs.values()) {
        this.handoffElements.add(handoff);
      }
      return;
    }

    this.activeHandoffs.clear();
    this.handoffElements.clear();

    for (const clip of visibleClips) {
      const clipVideo = getClipHtmlVideoElement(clip);
      if (!clipVideo || !clip.trackId) continue;

      const prev = this.lastTrackState.get(clip.trackId);
      if (!prev) continue;

      if (prev.clipId === clip.id) {
        if (prev.videoElement !== clipVideo) {
          this.setHandoff(clip.id, prev.videoElement);
        }
        continue;
      }

      const clipFileId = getClipSourceKey(clip);
      const sameSource = clipFileId
        ? clipFileId === prev.fileId
        : clip.file === prev.file;

      if (!sameSource) {
        log.debug('Handoff SKIP: different source', {
          track: clip.trackId,
          prevClip: prev.clipId.slice(-6),
          newClip: clip.id.slice(-6),
          prevFileId: prev.fileId?.slice(-6),
          newFileId: clipFileId?.slice(-6),
        });
        continue;
      }

      const inOutGap = Math.abs(clip.inPoint - prev.outPoint);
      const isContinuousCut = inOutGap <= 0.1;
      if (!isContinuousCut) {
        log.debug('Handoff SKIP: non-continuous cut', {
          track: clip.trackId,
          inPoint: clip.inPoint.toFixed(3),
          prevOutPoint: prev.outPoint.toFixed(3),
          gap: inOutGap.toFixed(3),
        });
        continue;
      }

      const elemDrift = Math.abs(prev.videoElement.currentTime - clip.inPoint);
      log.info('Handoff START', {
        track: clip.trackId,
        prevClip: prev.clipId.slice(-6),
        newClip: clip.id.slice(-6),
        elementTime: prev.videoElement.currentTime.toFixed(3),
        inPoint: clip.inPoint.toFixed(3),
        drift: elemDrift.toFixed(3),
      });
      renderHostPort.markVideoFramePresented(prev.videoElement, prev.videoElement.currentTime, clip.id);
      if (!renderHostPort.captureVideoFrameAtTime(prev.videoElement, prev.videoElement.currentTime, clip.id)) {
        renderHostPort.ensureVideoFrameCached(prev.videoElement, clip.id);
      }
      this.setHandoff(clip.id, prev.videoElement);
    }
  }

  getPreviewContinuationVideoElement(
    clip: TimelineClip,
    targetTime: number,
    ownVideo: HTMLVideoElement | null
  ): HTMLVideoElement | null {
    if (!ownVideo || !clip.trackId) {
      return null;
    }

    const activeHandoff = this.activeHandoffs.get(clip.id);
    if (activeHandoff) {
      return activeHandoff;
    }

    const now = performance.now();
    this.clearExpiredPreviewContinuations(now);

    if (!clipNeedsPreviewContinuation(ownVideo, targetTime)) {
      this.previewContinuationElements.delete(clip.id);
      return null;
    }

    const stored = this.previewContinuationElements.get(clip.id);
    if (
      stored &&
      stored.videoElement !== ownVideo &&
      canUsePreviewContinuationVideo(stored.videoElement, targetTime)
    ) {
      return stored.videoElement;
    }

    const prev = this.lastTrackState.get(clip.trackId);
    if (!prev || prev.videoElement === ownVideo) {
      this.previewContinuationElements.delete(clip.id);
      return null;
    }

    const canReusePrevious =
      prev.clipId === clip.id ||
      isSameSourceSequentialClip(clip, prev);
    if (
      !canReusePrevious ||
      !canUsePreviewContinuationVideo(prev.videoElement, targetTime)
    ) {
      this.previewContinuationElements.delete(clip.id);
      return null;
    }

    this.previewContinuationElements.set(clip.id, {
      videoElement: prev.videoElement,
      expiresAt: now + PREVIEW_CONTINUATION_MS,
    });
    return prev.videoElement;
  }

  updateLastTrackState(
    ctx: FrameContext,
    visibleClips: TimelineClip[],
    getClipHtmlVideoElement: GetClipHtmlVideoElement
  ): void {
    for (const clip of visibleClips) {
      const clipVideo = getClipHtmlVideoElement(clip);
      if (!clipVideo || !clip.trackId) continue;

      const handoffElement = this.activeHandoffs.get(clip.id);
      const video = ctx.isPlaying && handoffElement ? handoffElement : clipVideo;

      this.lastTrackState.set(clip.trackId, {
        clipId: clip.id,
        fileId: getClipSourceKey(clip),
        file: clip.file,
        videoElement: video,
        outPoint: clip.outPoint,
      });
    }
  }

  resetClip(clipId: string, video?: HTMLVideoElement): void {
    this.previewContinuationElements.delete(clipId);
    this.deleteHandoff(clipId);

    if (!video) {
      return;
    }

    for (const [trackId, state] of this.lastTrackState.entries()) {
      if (state.clipId === clipId || state.videoElement === video) {
        this.lastTrackState.delete(trackId);
      }
    }
  }

  private clearExpiredPreviewContinuations(now: number = performance.now()): void {
    for (const [clipId, entry] of this.previewContinuationElements.entries()) {
      if (entry.expiresAt <= now) {
        this.previewContinuationElements.delete(clipId);
      }
    }
  }
}
