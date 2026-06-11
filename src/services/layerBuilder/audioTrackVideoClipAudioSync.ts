import type { TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext, AudioSyncState, AudioSyncTarget } from './types';
import { getClipTimeInfo, getMediaFileForClip, getClipForTrack, isVideoTrackVisible } from './FrameContext';
import { proxyFrameCache } from '../proxyFrameCache';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { useTimelineStore } from '../../stores/timeline';
import type { LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { hasUsableAudioProxy } from './audioTrackElementUtils';

export interface AudioTrackVideoClipAudioSyncOptions {
  getClipVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  getLinkedAudioClipAtPlayhead: (ctx: FrameContext, clip: TimelineClip) => TimelineClip | undefined;
  getVideoAudioProxyElementForClip: (mediaFileId: string, clipId: string) => HTMLAudioElement | null;
  getClipAudioRouteSettings: (
    ctx: FrameContext,
    clip: TimelineClip,
    track: TimelineTrack | undefined,
    clipLocalTime: number,
    clipSourceTime: number,
  ) => LiveAudioRouteSettings;
  syncPreviewAudioElement: (
    target: AudioSyncTarget,
    ctx: FrameContext,
    state: AudioSyncState,
  ) => void;
}

export class AudioTrackVideoClipAudioSync {
  private readonly options: AudioTrackVideoClipAudioSyncOptions;

  constructor(options: AudioTrackVideoClipAudioSyncOptions) {
    this.options = options;
  }

  sync(ctx: FrameContext, state: AudioSyncState): Set<string> {
    const activeVideoClipIds = new Set<string>();
    let hasScrubAudioSource = false;
    const regionGainPreview = useTimelineStore.getState().audioRegionGainPreview;

    for (const track of ctx.videoTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip || clip.isComposition) continue;
      const videoElement = this.options.getClipVideoElement(clip);
      if (!videoElement) continue;

      const mediaFile = getMediaFileForClip(ctx, clip);
      const timeInfo = getClipTimeInfo(ctx, clip);
      const isMuted = !isVideoTrackVisible(ctx, track.id);
      const mediaFileId = mediaFile?.id || clip.mediaFileId || clip.id;
      const linkedAudioClip = this.options.getLinkedAudioClipAtPlayhead(ctx, clip);
      const audioSettingsClip = linkedAudioClip ?? clip;
      const audioSettingsTimeInfo = linkedAudioClip ? getClipTimeInfo(ctx, linkedAudioClip) : timeInfo;
      const linkedAudioTrack = linkedAudioClip
        ? ctx.audioTracks.find(candidate => candidate.id === linkedAudioClip.trackId)
        : undefined;
      const audioSettingsTrack = linkedAudioTrack ?? track;

      const routeSettings = this.options.getClipAudioRouteSettings(
        ctx,
        audioSettingsClip,
        audioSettingsTrack,
        audioSettingsTimeInfo.clipLocalTime,
        audioSettingsTimeInfo.clipTime,
      );
      const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(
        audioSettingsClip,
        audioSettingsTimeInfo.clipTime,
        regionGainPreview,
      );
      const effectiveVolume = routeSettings.volume * editPreviewVolume;
      let audioMuted = isMuted || routeSettings.muted || effectiveVolume <= 0.01;

      if (!audioMuted && linkedAudioClip) {
        const linkedTrackMuted = !ctx.unmutedAudioTrackIds.has(linkedAudioClip.trackId);
        if (linkedTrackMuted) audioMuted = true;
      } else if (!audioMuted && clip.linkedClipId && !ctx.clips.some(c => c.id === clip.linkedClipId)) {
        audioMuted = true;
      }

      const useVarispeedScrubAudio =
        ctx.isDraggingPlayhead && !audioMuted && proxyFrameCache.hasAudioBuffer(mediaFileId);

      if (ctx.isDraggingPlayhead && !audioMuted) {
        hasScrubAudioSource = true;
        if (!videoElement.muted) videoElement.muted = true;
        proxyFrameCache.playScrubAudio(
          mediaFileId,
          timeInfo.clipTime,
          undefined,
          videoElement.currentSrc || videoElement.src,
          {
            volume: effectiveVolume,
            eqGains: routeSettings.eqGains,
            pan: routeSettings.pan,
            processors: routeSettings.processors,
            masterRoute: routeSettings.master,
          }
        );
        const scrubMeter = proxyFrameCache.getScrubMeterSnapshot(ctx.now);
        if (scrubMeter) {
          useTimelineStore.getState().updateRuntimeAudioMeter(audioSettingsTrack.id, scrubMeter);
        }
      }

      const shouldUseAudioProxy = hasUsableAudioProxy(mediaFile);

      if (shouldUseAudioProxy && mediaFile && !linkedAudioClip) {
        activeVideoClipIds.add(clip.id);

        if (!videoElement.muted) videoElement.muted = true;

        const audioProxy = this.options.getVideoAudioProxyElementForClip(mediaFile.id, clip.id);
        if (audioProxy) {
          const shouldUseAudioProxyScrubFallback =
            ctx.isDraggingPlayhead &&
            !linkedAudioClip &&
            !useVarispeedScrubAudio;

          if (!ctx.isDraggingPlayhead || shouldUseAudioProxyScrubFallback) {
            this.options.syncPreviewAudioElement({
              element: audioProxy,
              clip,
              clipTime: timeInfo.clipTime,
              absSpeed: timeInfo.absSpeed,
              isMuted: audioMuted,
              canBeMaster: !state.masterSet,
              type: 'audioProxy',
              volume: effectiveVolume,
              eqGains: routeSettings.eqGains,
              pan: routeSettings.pan,
              processors: routeSettings.processors,
              masterRoute: routeSettings.master,
              meterTrackId: audioSettingsTrack.id,
            }, ctx, state);
          } else if (!audioProxy.paused) {
            audioProxy.pause();
          }
        } else {
          proxyFrameCache.preloadAudioProxy(mediaFile.id);
        }
      }
    }

    if (!ctx.isDraggingPlayhead || !hasScrubAudioSource) {
      proxyFrameCache.stopScrubAudio();
    }

    return activeVideoClipIds;
  }
}
