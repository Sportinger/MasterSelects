import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { Logger } from '../logger';
import type { FrameContext } from './types';
import {
  VideoSyncPreviewContinuationManager,
  type PreviewContinuationOptions,
  type VideoSyncTrackState,
} from './videoSyncPreviewContinuations';

export type { PreviewContinuationOptions, VideoSyncTrackState } from './videoSyncPreviewContinuations';

const log = Logger.create('CutTransition');

type GetClipHtmlVideoElement = (clip: TimelineClip) => HTMLVideoElement | null;

function getClipSourceKey(clip: TimelineClip): string {
  return clip.source?.mediaFileId || clip.mediaFileId || '';
}

export class VideoSyncHandoffManager {
  private lastTrackState = new Map<string, VideoSyncTrackState>();
  private activeHandoffs = new Map<string, HTMLVideoElement>();
  private handoffElements = new Set<HTMLVideoElement>();
  private previewContinuations = new VideoSyncPreviewContinuationManager();

  reset(): void {
    this.lastTrackState.clear();
    this.activeHandoffs.clear();
    this.handoffElements.clear();
    this.previewContinuations.reset();
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

  getRetainedVideoElements(now: number = performance.now()): ReadonlySet<HTMLVideoElement> {
    const retained = new Set(this.handoffElements);
    this.previewContinuations.getRetainedVideoElements(now).forEach(video => retained.add(video));
    return retained;
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
    ownVideo: HTMLVideoElement | null,
    options: PreviewContinuationOptions = {},
  ): HTMLVideoElement | null {
    const activeHandoff = this.activeHandoffs.get(clip.id);
    if (activeHandoff) return activeHandoff;
    const trackKey = options.trackKey ?? clip.trackId;
    return this.previewContinuations.get(
      clip,
      targetTime,
      ownVideo,
      trackKey ? this.lastTrackState.get(trackKey) : undefined,
      options,
    );
  }

  rememberPreviewVideo(
    trackKey: string,
    clip: TimelineClip,
    videoElement: HTMLVideoElement,
    continuityKey?: string,
  ): void {
    this.lastTrackState.set(trackKey, {
      clipId: clip.id,
      fileId: getClipSourceKey(clip),
      file: clip.file,
      videoElement,
      outPoint: clip.outPoint,
      continuityKey,
    });
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
    this.previewContinuations.resetClip(clipId);
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

}
