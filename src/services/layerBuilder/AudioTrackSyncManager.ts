// AudioTrackSyncManager - Handles audio element synchronization with playhead
// Extracted from LayerBuilderService for separation of concerns

import type { ClipAudioStemLayer, TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext, AudioSyncState, AudioSyncTarget, ClipTimeInfo } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';
import { createFrameContext, getClipTimeInfo, getMediaFileForClip, getClipForTrack, isVideoTrackVisible } from './FrameContext';
import { AudioSyncHandler, createAudioSyncState, finalizeAudioSync, resumeAudioContextIfNeeded } from './AudioSyncHandler';
import { proxyFrameCache } from '../proxyFrameCache';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { Logger } from '../logger';
import { createLiveAudioRouteSettings, type LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import { getClipAudioEditPreviewVolumeMultiplier } from '../audio/clipAudioEditPreview';
import { audioRoutingManager } from '../audioRoutingManager';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { createCurrentAudioArtifactStore } from '../audio/timelineWaveformPyramidCache';
import { StemAudioSourceResolver, STEM_SOURCE_LAYER_ID } from '../audio/stemSeparation';
import { calculateAudioMeterSnapshot, createSilentAudioMeterSnapshot } from '../audio/audioMetering';
import { registerTimelineAudioPlaybackStopper } from '../audio/timelineAudioPlaybackStopper';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { clearMasterAudio, playheadState, setMasterAudioClock } from './PlayheadState';

const log = Logger.create('CutTransition');

interface StemAudioElementEntry {
  key: string;
  element: HTMLAudioElement | null;
  loading: boolean;
  error?: string;
  url?: string;
}

interface StemAudioElementSet {
  key: string;
  entries: Map<string, StemAudioElementEntry>;
}

interface StemBufferMixerLayer {
  id: string;
  mediaFileId: string;
  gain: number;
  required: boolean;
}

interface StemBufferMixerSession {
  key: string;
  clipId: string;
  context: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
  stereoSplitter: ChannelSplitterNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;
  meterSamples: Float32Array<ArrayBuffer>;
  leftMeterSamples: Float32Array<ArrayBuffer>;
  rightMeterSamples: Float32Array<ArrayBuffer>;
  meterTrackId: string;
  getSourceTime: () => number | null;
  sources: AudioBufferSourceNode[];
  gains: Map<string, GainNode>;
  startedAtContextTime: number;
  startedClipTime: number;
  sourceCount: number;
  lastGainSignature: string;
  lastMeterPublishAt: number;
}

type ClipStemSeparationState = NonNullable<NonNullable<TimelineClip['audioState']>['stemSeparation']>;

interface StemBufferMixerSyncOptions {
  clip: TimelineClip;
  stemSeparation: ClipStemSeparationState;
  audibleStemLayers: ClipAudioStemLayer[];
  shouldUseSourceAudio: boolean;
  sourceGain: number;
  routeSettings: LiveAudioRouteSettings;
  timeInfo: ClipTimeInfo;
  effectiveVolume: number;
  trackMuted: boolean;
  meterTrackId: string;
  canBeMaster: boolean;
}

const STEM_MIXER_START_DELAY_SECONDS = 0.035;
const STEM_MIXER_RESTART_DRIFT_SECONDS = 0.2;
const STEM_MIXER_METER_INTERVAL_MS = 100;

function createStemLayerSetKey(clip: TimelineClip): string | null {
  const stemSeparation = clip.audioState?.stemSeparation;
  if (!stemSeparation || stemSeparation.stems.length === 0) return null;

  return JSON.stringify({
    clipId: clip.id,
    activeSetId: stemSeparation.activeSetId,
    modelId: stemSeparation.modelId,
    modelVersion: stemSeparation.modelVersion,
    sourceFingerprint: stemSeparation.sourceFingerprint,
    stems: stemSeparation.stems.map(stem => ({
      id: stem.id,
      payloadArtifactId: stem.payloadRef.artifactId,
      manifestArtifactId: stem.manifestArtifactId,
      mediaFileId: stem.mediaFileId,
    })),
  });
}

function getAudibleStemLayers(stemSeparation: NonNullable<TimelineClip['audioState']>['stemSeparation']): ClipAudioStemLayer[] {
  if (!stemSeparation || stemSeparation.mixMode === 'original' || stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
    return [];
  }
  if (stemSeparation.soloStemId) {
    return stemSeparation.stems.filter(stem => stem.id === stemSeparation.soloStemId);
  }
  return stemSeparation.stems.filter(stem => stem.enabled !== false);
}

function usesSourceAudioLayer(stemSeparation: NonNullable<TimelineClip['audioState']>['stemSeparation']): boolean {
  return !stemSeparation ||
    stemSeparation.mixMode === 'original' ||
    stemSeparation.mixMode === 'hybrid' ||
    stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID;
}

function clipUsesSourceAudioLayer(clip: TimelineClip): boolean {
  return usesSourceAudioLayer(clip.audioState?.stemSeparation);
}

function hasUsableAudioProxy(mediaFile: { hasProxyAudio?: boolean; audioProxyStatus?: string } | undefined): boolean {
  return mediaFile?.hasProxyAudio === true || mediaFile?.audioProxyStatus === 'ready';
}

function dbToLinearGain(db: number | undefined): number {
  return Number.isFinite(db) ? 10 ** ((db ?? 0) / 20) : 1;
}

function routeHasEq(eqGains: readonly number[] | undefined): boolean {
  return eqGains?.some(gain => Math.abs(gain) > 0.01) ?? false;
}

function canUseStemBufferMixer(
  routeSettings: LiveAudioRouteSettings,
  absSpeed: number,
): boolean {
  return Math.abs(absSpeed - 1) <= 0.001 &&
    Math.abs(routeSettings.pan) <= 0.001 &&
    !routeHasEq(routeSettings.eqGains) &&
    !routeHasEq(routeSettings.master.eqGains) &&
    routeSettings.processors.length === 0 &&
    routeSettings.master.processors.length === 0;
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channelIndex) =>
    buffer.getChannelData(channelIndex)
  );
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channelIndex]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: 'audio/wav' });
}

function createAudioElementFromBuffer(buffer: AudioBuffer): { element: HTMLAudioElement; url: string } {
  const url = URL.createObjectURL(audioBufferToWavBlob(buffer));
  const element = document.createElement('audio');
  element.src = url;
  element.preload = 'auto';
  return { element, url };
}

function createAudioElementFromUrl(url: string): HTMLAudioElement {
  const element = document.createElement('audio');
  element.src = url;
  element.preload = 'auto';
  return element;
}

function createAudioProxyInstance(base: HTMLAudioElement): HTMLAudioElement | null {
  const src = base.currentSrc || base.src;
  if (!src) return null;

  const element = document.createElement('audio');
  element.src = src;
  element.preload = 'auto';
  element.crossOrigin = base.crossOrigin;
  return element;
}

function pauseAudioElement(element: HTMLAudioElement | HTMLVideoElement | null | undefined): void {
  if (!element) return;
  element.pause();
}

function getClipAudioRouteSettings(
  ctx: FrameContext,
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  clipLocalTime: number,
  clipSourceTime: number,
): LiveAudioRouteSettings {
  return createLiveAudioRouteSettings({
    clip,
    track,
    masterAudioState: ctx.masterAudioState,
    interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, clipLocalTime),
    sourceTime: clipSourceTime,
  });
}

export class AudioTrackSyncManager {
  // Sub-module
  private audioSyncHandler = new AudioSyncHandler();

  // Audio sync throttling
  private lastAudioSyncTime = 0;
  private playbackStartFrames = 0;

  // Active audio proxies tracking
  private activeAudioProxies = new Map<string, HTMLAudioElement>();
  private activeAudioTrackProxies = new Map<string, HTMLAudioElement>();
  private stemAudioElements = new Map<string, StemAudioElementSet>();
  private stemBufferMixerContext: AudioContext | null = null;
  private stemBufferMixers = new Map<string, StemBufferMixerSession>();

  // Seamless audio cut transition: keep old audio element playing through cuts
  // (same approach as video handoff in VideoSyncManager)
  private lastAudioTrackState = new Map<string, {
    clipId: string;
    fileId: string;
    file: File;
    audioElement: HTMLAudioElement;
    outPoint: number;
  }>();
  private audioHandoffs = new Map<string, HTMLAudioElement>();
  private audioHandoffElements = new Set<HTMLAudioElement>();

  constructor() {
    registerTimelineAudioPlaybackStopper(() => this.stopAllAudioPlayback());
  }

  private clearAudioHandoffState(): void {
    this.lastAudioTrackState.clear();
    this.audioHandoffs.clear();
    this.audioHandoffElements.clear();
  }

  stopAllAudioPlayback(): void {
    clearMasterAudio();
    this.clearAudioHandoffState();
    audioRoutingManager.pauseAllRoutedMedia();
    this.audioSyncHandler.stopScrubAudio();
    const timelineState = useTimelineStore.getState();
    for (const clip of timelineState.clips) {
      pauseAudioElement(clip.source?.audioElement);
      pauseAudioElement(clip.mixdownAudio);
    }

    for (const set of this.stemAudioElements.values()) {
      for (const entry of set.entries.values()) {
        pauseAudioElement(entry.element);
        if (entry.element) {
          audioRoutingManager.removeRoute(entry.element);
        }
      }
    }

    for (const audioProxy of this.activeAudioTrackProxies.values()) {
      pauseAudioElement(audioProxy);
      audioRoutingManager.removeRoute(audioProxy);
    }
    this.activeAudioTrackProxies.clear();

    for (const audioProxy of this.activeAudioProxies.values()) {
      pauseAudioElement(audioProxy);
      audioRoutingManager.removeRoute(audioProxy);
    }
    this.activeAudioProxies.clear();

    this.stopAllStemBufferMixers();
    if (this.stemBufferMixerContext?.state === 'running') {
      void this.stemBufferMixerContext.suspend();
    }
    timelineState.clearStaleRuntimeAudioMeters(0, performance.now());
  }

  /**
   * Sync audio elements to current playhead
   */
  syncAudioElements(): void {
    const ctx = createFrameContext();

    // At non-standard playback speeds (reverse or fast-forward), mute all audio
    // Audio can't play backwards and fast-forward sounds bad
    if (ctx.playbackSpeed !== 1 && ctx.isPlaying) {
      this.muteAllAudio(ctx);
      useTimelineStore.getState().clearStaleRuntimeAudioMeters(0, ctx.now);
      return;
    }

    // Handle playback start
    const isStartup = playheadState.playbackJustStarted;
    if (isStartup) {
      this.playbackStartFrames++;
      if (this.playbackStartFrames > 10) {
        playheadState.playbackJustStarted = false;
        this.playbackStartFrames = 0;
      }
    } else {
      // Throttle audio sync
      if (ctx.now - this.lastAudioSyncTime < LAYER_BUILDER_CONSTANTS.AUDIO_SYNC_INTERVAL) {
        return;
      }
    }
    this.lastAudioSyncTime = ctx.now;

    // Resume audio context if needed
    resumeAudioContextIfNeeded(ctx.isPlaying, ctx.isDraggingPlayhead);
    if (!ctx.isPlaying || ctx.isDraggingPlayhead || ctx.playbackSpeed !== 1) {
      this.clearAudioHandoffState();
      this.stopAllStemBufferMixers();
    }
    if (!ctx.isDraggingPlayhead) {
      this.audioSyncHandler.resetScrubState();
      if (!ctx.isPlaying) {
        this.audioSyncHandler.stopScrubAudio();
      }
    }

    // Compute audio handoffs for seamless cut transitions only while playing.
    // Paused/stopped sync must not retain stale proxy elements across resumes.
    if (ctx.isPlaying && !ctx.isDraggingPlayhead) {
      this.computeAudioHandoffs(ctx);
    }

    // Create sync state
    const state = createAudioSyncState();

    // Sync audio track clips
    this.syncAudioTrackClips(ctx, state);

    // Sync video clip audio (proxies and elements)
    this.syncVideoClipAudio(ctx, state);

    // Sync nested comp mixdown
    this.syncNestedCompMixdown(ctx, state);

    // Pause inactive audio
    this.pauseInactiveAudio(ctx);

    // Update audio track state for next frame's handoff detection only during playback.
    if (ctx.isPlaying && !ctx.isDraggingPlayhead) {
      this.updateLastAudioTrackState(ctx);
    }

    // Pre-buffer audio for upcoming clips (audio lookahead)
    this.preBufferUpcomingAudio(ctx);

    // Sync background layer audio elements
    layerPlaybackManager.syncAudioElements(ctx.playheadPosition, ctx.isPlaying);

    // Finalize
    finalizeAudioSync(state, ctx.isPlaying);
    useTimelineStore.getState().clearStaleRuntimeAudioMeters(650, ctx.now);
  }

  private syncPreviewAudioElement(
    target: AudioSyncTarget,
    ctx: FrameContext,
    state: AudioSyncState,
  ): void {
    this.audioSyncHandler.syncAudioElement(target, ctx, state);
  }

  /**
   * Sync audio track clips
   */
  private syncAudioTrackClips(ctx: FrameContext, state: AudioSyncState): void {
    const regionGainPreview = useTimelineStore.getState().audioRegionGainPreview;
    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source) continue;

      const timeInfo = getClipTimeInfo(ctx, clip);
      const routeSettings = getClipAudioRouteSettings(ctx, clip, track, timeInfo.clipLocalTime, timeInfo.clipTime);
      const editPreviewVolume = getClipAudioEditPreviewVolumeMultiplier(clip, timeInfo.clipTime, regionGainPreview);
      const effectiveVolume = routeSettings.volume * editPreviewVolume;
      const trackMuted = !ctx.unmutedAudioTrackIds.has(track.id) || routeSettings.muted || effectiveVolume <= 0.01;
      const stemSeparation = clip.audioState?.stemSeparation;
      const audibleStemLayers = getAudibleStemLayers(stemSeparation);
      const shouldUseStemAudio = audibleStemLayers.length > 0;
      const shouldUseSourceAudio = usesSourceAudioLayer(stemSeparation);
      const sourceGain = dbToLinearGain(stemSeparation?.sourceGainDb);
      const shouldPreferStemBufferMixer = Boolean(
        stemSeparation &&
        ctx.isPlaying &&
        !ctx.isDraggingPlayhead &&
        shouldUseStemAudio &&
        canUseStemBufferMixer(routeSettings, timeInfo.absSpeed) &&
        timeInfo.speed > 0,
      );
      if (stemSeparation && ctx.isPlaying && !ctx.isDraggingPlayhead) {
        const canBeStemMaster = !state.masterSet;
        const mixerSourceCount = this.syncStemBufferMixer({
          clip,
          stemSeparation,
          audibleStemLayers,
          shouldUseSourceAudio,
          sourceGain,
          routeSettings,
          timeInfo,
          effectiveVolume,
          trackMuted,
          meterTrackId: track.id,
          canBeMaster: canBeStemMaster,
        });
        if (mixerSourceCount > 0) {
          const existingSourceProxy = this.activeAudioTrackProxies.get(clip.id);
          pauseAudioElement(existingSourceProxy);
          if (existingSourceProxy) {
            audioRoutingManager.removeRoute(existingSourceProxy);
            this.activeAudioTrackProxies.delete(clip.id);
          }
          pauseAudioElement(clip.source.audioElement);
          this.pauseStemAudioElements(clip.id);
          state.audioPlayingCount += mixerSourceCount;
          if (canBeStemMaster) state.masterSet = true;
          continue;
        }
        if (shouldPreferStemBufferMixer && !shouldUseSourceAudio) {
          const existingSourceProxy = this.activeAudioTrackProxies.get(clip.id);
          pauseAudioElement(existingSourceProxy);
          if (existingSourceProxy) {
            audioRoutingManager.removeRoute(existingSourceProxy);
            this.activeAudioTrackProxies.delete(clip.id);
          }
          pauseAudioElement(clip.source.audioElement);
          this.pauseStemAudioElements(clip.id);
          this.publishSilentStemMeter(track.id, ctx.now);
          continue;
        }
      } else {
        this.stopStemBufferMixer(clip.id);
      }

      if (stemSeparation && !shouldUseStemAudio) {
        this.disposeStemAudioSet(clip.id);
      }
      const needsStemAudioElements = shouldUseStemAudio && (
        ctx.isDraggingPlayhead ||
        (ctx.isPlaying && !shouldPreferStemBufferMixer)
      );
      if (shouldUseStemAudio && !needsStemAudioElements) {
        this.pauseStemAudioElements(clip.id);
      }
      const stemAudioElements = needsStemAudioElements ? this.getStemAudioElements(clip) : null;
      const stemAudioReady = audibleStemLayers.every(stem => Boolean(stemAudioElements?.get(stem.id)?.element));
      if (needsStemAudioElements && !stemAudioReady && !shouldUseSourceAudio) {
        pauseAudioElement(this.activeAudioTrackProxies.get(clip.id));
        pauseAudioElement(clip.source.audioElement);
        this.publishSilentStemMeter(track.id, ctx.now);
        continue;
      }

      const needsSourceElement = !stemSeparation || shouldUseSourceAudio;
      const sourceAudioProxy = needsSourceElement ? this.getAudioProxyElementForClip(clip) : null;
      const sourceAudioElement = sourceAudioProxy ?? clip.source.audioElement;

      if (needsSourceElement) {
        if (!sourceAudioElement) continue;

        if (this.shouldSuppressLinkedAudioClipScrub(ctx, clip)) {
          if (!sourceAudioElement.paused) {
            sourceAudioElement.pause();
          }
          continue;
        }

        // Skip audio elements without a valid source (e.g., empty audio from nested comps without audio)
        if (!sourceAudioElement.src && sourceAudioElement.readyState === 0) continue;
      }

      if (sourceAudioProxy) {
        this.activeAudioTrackProxies.set(clip.id, sourceAudioProxy);
        if (clip.source.audioElement && !clip.source.audioElement.paused) {
          clip.source.audioElement.pause();
        }
      }
      if (!shouldUseSourceAudio) {
        pauseAudioElement(sourceAudioElement);
        const existingSourceProxy = this.activeAudioTrackProxies.get(clip.id);
        if (existingSourceProxy) {
          audioRoutingManager.removeRoute(existingSourceProxy);
          this.activeAudioTrackProxies.delete(clip.id);
        }
      }

      // Use handoff element if available (seamless cut transition)
      const handoffAudio = this.audioHandoffs.get(clip.id);
      if (shouldUseSourceAudio && sourceAudioElement) {
        this.syncPreviewAudioElement({
          element: handoffAudio ?? sourceAudioElement,
          clip,
          clipTime: timeInfo.clipTime,
          absSpeed: timeInfo.absSpeed,
          isMuted: trackMuted,
          canBeMaster: true,
          type: 'audioTrack',
          volume: effectiveVolume * sourceGain,
          eqGains: routeSettings.eqGains,
          pan: routeSettings.pan,
          processors: routeSettings.processors,
          masterRoute: routeSettings.master,
          meterTrackId: track.id,
        }, ctx, state);
      }

      if (stemAudioElements && stemSeparation) {
        const audibleStemIds = new Set(audibleStemLayers.map(stem => stem.id));
        let stemMeterAssigned = shouldUseSourceAudio;
        let stemMasterAssigned = shouldUseSourceAudio;
        for (const stem of stemSeparation.stems) {
          const stemAudio = stemAudioElements.get(stem.id)?.element;
          if (!stemAudio) continue;
          const stemIsAudible = audibleStemIds.has(stem.id);
          if (!stemIsAudible) {
            pauseAudioElement(stemAudio);
            audioRoutingManager.removeRoute(stemAudio);
            continue;
          }

          const canBeStemMaster = !stemMasterAssigned && stemIsAudible;
          if (canBeStemMaster) stemMasterAssigned = true;
          const meterTrackId = !stemMeterAssigned ? track.id : undefined;
          if (meterTrackId) stemMeterAssigned = true;

          this.syncPreviewAudioElement({
            element: stemAudio,
            clip,
            clipTime: timeInfo.clipTime,
            absSpeed: timeInfo.absSpeed,
            isMuted: trackMuted || !stemIsAudible,
            canBeMaster: canBeStemMaster,
            type: 'stemAudioTrack',
            volume: stemIsAudible ? effectiveVolume * dbToLinearGain(stem.gainDb) : 0,
            eqGains: routeSettings.eqGains,
            pan: routeSettings.pan,
            processors: routeSettings.processors,
            masterRoute: routeSettings.master,
            meterTrackId,
          }, ctx, state);
        }
      }
    }
  }

  /**
   * Sync video clip audio (proxies and varispeed scrubbing)
   */
  private syncVideoClipAudio(ctx: FrameContext, state: AudioSyncState): void {
    const activeVideoClipIds = new Set<string>();
    let hasScrubAudioSource = false;
    const regionGainPreview = useTimelineStore.getState().audioRegionGainPreview;

    for (const track of ctx.videoTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source?.videoElement || clip.isComposition) continue;

      const mediaFile = getMediaFileForClip(ctx, clip);
      const timeInfo = getClipTimeInfo(ctx, clip);
      const isMuted = !isVideoTrackVisible(ctx, track.id);
      const mediaFileId = mediaFile?.id || clip.mediaFileId || clip.id;
      const linkedAudioClip = this.getLinkedAudioClipAtPlayhead(ctx, clip);
      const audioSettingsClip = linkedAudioClip ?? clip;
      const audioSettingsTimeInfo = linkedAudioClip ? getClipTimeInfo(ctx, linkedAudioClip) : timeInfo;
      const linkedAudioTrack = linkedAudioClip
        ? ctx.audioTracks.find(candidate => candidate.id === linkedAudioClip.trackId)
        : undefined;
      const audioSettingsTrack = linkedAudioTrack ?? track;

      // Varispeed scrubbing should follow the effective audio clip settings.
      const routeSettings = getClipAudioRouteSettings(
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
        // Linked audio clip was deleted - mute scrub audio.
        audioMuted = true;
      }

      const useVarispeedScrubAudio = ctx.isDraggingPlayhead && !audioMuted && proxyFrameCache.hasAudioBuffer(mediaFileId);

      if (ctx.isDraggingPlayhead && !audioMuted) {
        hasScrubAudioSource = true;
        const video = clip.source.videoElement;
        if (!video.muted) video.muted = true;
        proxyFrameCache.playScrubAudio(
          mediaFileId,
          timeInfo.clipTime,
          undefined,
          video.currentSrc || video.src,
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

      if (mediaFile && (mediaFile.audioProxyStatus === 'generating' || hasUsableAudioProxy(mediaFile))) {
        void proxyFrameCache.getAudioBuffer(mediaFile.id);
      }

      // Audio proxy handling. Audio proxies are independent from the video
      // proxy switch because they make timeline playback/scrubbing predictable.
      const shouldUseAudioProxy = hasUsableAudioProxy(mediaFile);

      if (shouldUseAudioProxy && mediaFile && !linkedAudioClip) {
        activeVideoClipIds.add(clip.id);

        const video = clip.source.videoElement;
        if (!video.muted) video.muted = true;

        const audioProxy = this.getVideoAudioProxyElementForClip(mediaFile.id, clip.id);
        if (audioProxy) {
          this.activeAudioProxies.set(clip.id, audioProxy);

          const shouldUseAudioProxyScrubFallback =
            ctx.isDraggingPlayhead &&
            !linkedAudioClip &&
            !useVarispeedScrubAudio;

          if (!ctx.isDraggingPlayhead || shouldUseAudioProxyScrubFallback) {
            this.syncPreviewAudioElement({
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
          // Trigger preload
          proxyFrameCache.preloadAudioProxy(mediaFile.id);
          proxyFrameCache.getAudioBuffer(mediaFile.id);
        }
      }
    }

    // Pause inactive audio proxies
    for (const [clipId, audioProxy] of this.activeAudioProxies) {
      if (!activeVideoClipIds.has(clipId)) {
        if (!audioProxy.paused) audioProxy.pause();
        audioRoutingManager.removeRoute(audioProxy);
        this.activeAudioProxies.delete(clipId);
      }
    }

    if (!ctx.isDraggingPlayhead || !hasScrubAudioSource) {
      proxyFrameCache.stopScrubAudio();
    }
  }

  /**
   * Sync nested composition mixdown audio
   */
  private syncNestedCompMixdown(ctx: FrameContext, state: AudioSyncState): void {
    for (const clip of ctx.clipsAtTime) {
      if (!clip.isComposition || !clip.mixdownAudio || !clip.hasMixdownAudio) continue;

      const timeInfo = getClipTimeInfo(ctx, clip);
      const track = ctx.videoTracks.find(t => t.id === clip.trackId);
      const isMuted = track ? !isVideoTrackVisible(ctx, track.id) : false;
      const routeSettings = getClipAudioRouteSettings(ctx, clip, track, timeInfo.clipLocalTime, timeInfo.clipTime);

      this.syncPreviewAudioElement({
        element: clip.mixdownAudio,
        clip,
        clipTime: timeInfo.clipTime,
        absSpeed: timeInfo.absSpeed,
        isMuted: isMuted || routeSettings.muted,
        canBeMaster: !state.masterSet,
        type: 'mixdown',
        volume: routeSettings.volume,
        eqGains: routeSettings.eqGains,
        pan: routeSettings.pan,
        processors: routeSettings.processors,
        masterRoute: routeSettings.master,
        meterTrackId: track?.id,
      }, ctx, state);
    }
  }

  /**
   * Pause audio not at playhead
   */
  private pauseInactiveAudio(ctx: FrameContext): void {
    const activeClipIds = new Set(ctx.clipsAtTime.map(clip => clip.id));
    const knownClipIds = new Set(ctx.clips.map(clip => clip.id));
    for (const clip of ctx.clips) {
      const isAtPlayhead = activeClipIds.has(clip.id);

      if (clip.source?.audioElement && !isAtPlayhead && !clip.source.audioElement.paused
          && !this.audioHandoffElements.has(clip.source.audioElement)) {
        clip.source.audioElement.pause();
      }

      const audioTrackProxy = this.activeAudioTrackProxies.get(clip.id);
      if (audioTrackProxy && !isAtPlayhead) {
        if (!audioTrackProxy.paused && !this.audioHandoffElements.has(audioTrackProxy)) {
          audioTrackProxy.pause();
        }
        audioRoutingManager.removeRoute(audioTrackProxy);
        this.activeAudioTrackProxies.delete(clip.id);
      }

      if (clip.mixdownAudio && !isAtPlayhead && !clip.mixdownAudio.paused) {
        clip.mixdownAudio.pause();
      }
    }

    for (const [clipId, set] of this.stemAudioElements) {
      if (!knownClipIds.has(clipId)) {
        this.disposeStemAudioSet(clipId);
        this.stopStemBufferMixer(clipId);
        continue;
      }
      if (!activeClipIds.has(clipId)) {
        for (const entry of set.entries.values()) {
          pauseAudioElement(entry.element);
        }
        this.stopStemBufferMixer(clipId);
      }
    }

    for (const clipId of Array.from(this.stemBufferMixers.keys())) {
      if (!knownClipIds.has(clipId) || !activeClipIds.has(clipId) || !ctx.isPlaying) {
        this.stopStemBufferMixer(clipId);
      }
    }

    for (const [clipId, audioProxy] of this.activeAudioTrackProxies) {
      if (!knownClipIds.has(clipId)) {
        if (!audioProxy.paused) audioProxy.pause();
        audioRoutingManager.removeRoute(audioProxy);
        this.activeAudioTrackProxies.delete(clipId);
      }
    }
  }

  /**
   * Detect same-source sequential audio clips for seamless handoff.
   * Same logic as video handoff: compare mediaFileId (not blob URL).
   */
  private computeAudioHandoffs(ctx: FrameContext): void {
    this.audioHandoffs.clear();
    this.audioHandoffElements.clear();

    // Handoffs are needed during playback (seamless cut transitions)
    // Only skip during scrubbing where we don't need seamless audio
    if (ctx.isDraggingPlayhead) return;

    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source) continue;
      if (!clipUsesSourceAudioLayer(clip)) continue;

      const currentAudioElement = this.getAudioProxyElementForClip(clip) ?? clip.source.audioElement;
      if (!currentAudioElement) continue;

      const prev = this.lastAudioTrackState.get(track.id);
      if (!prev) continue;

      if (prev.clipId === clip.id) {
        // Same clip as last frame - persist handoff if we were using one.
        // Without this, the handoff only lasts 1 frame and then the clip's
        // cold element takes over (causing an audio click/gap).
        if (prev.audioElement !== currentAudioElement) {
          this.audioHandoffs.set(clip.id, prev.audioElement);
          this.audioHandoffElements.add(prev.audioElement);
        }
        continue;
      }

      // Different clip - detect same-source sequential cut for new handoff
      const clipFileId = clip.source.mediaFileId || clip.mediaFileId;
      const sameSource = clipFileId
        ? clipFileId === prev.fileId
        : clip.file === prev.file;
      if (!sameSource) {
        log.debug('Audio handoff SKIP: different source', { track: track.id });
        continue;
      }

      const inOutGap = Math.abs(clip.inPoint - prev.outPoint);
      if (inOutGap > 0.1) {
        log.debug('Audio handoff SKIP: non-continuous', { gap: inOutGap.toFixed(3) });
        continue;
      }

      const elemDrift = Math.abs(prev.audioElement.currentTime - clip.inPoint);
      if (elemDrift > 0.5) {
        log.debug('Audio handoff SKIP: element too far', {
          elementTime: prev.audioElement.currentTime.toFixed(3),
          inPoint: clip.inPoint.toFixed(3),
          drift: elemDrift.toFixed(3),
        });
        continue;
      }

      log.info('Audio handoff START', {
        track: track.id.slice(-6),
        prevClip: prev.clipId.slice(-6),
        newClip: clip.id.slice(-6),
        drift: elemDrift.toFixed(3),
      });
      this.audioHandoffs.set(clip.id, prev.audioElement);
      this.audioHandoffElements.add(prev.audioElement);
    }
  }

  /**
   * Update per-track audio state for next frame's handoff detection
   */
  private updateLastAudioTrackState(ctx: FrameContext): void {
    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source) {
        this.lastAudioTrackState.delete(track.id);
        continue;
      }
      if (!clipUsesSourceAudioLayer(clip)) {
        this.lastAudioTrackState.delete(track.id);
        continue;
      }

      const currentAudioElement = this.getAudioProxyElementForClip(clip) ?? clip.source.audioElement;
      if (!currentAudioElement) continue;

      const handoffElement = this.audioHandoffs.get(clip.id);
      const audio = handoffElement ?? currentAudioElement;
      const fileId = clip.source.mediaFileId || clip.mediaFileId || '';

      this.lastAudioTrackState.set(track.id, {
        clipId: clip.id,
        fileId,
        file: clip.file,
        audioElement: audio,
        outPoint: clip.outPoint,
      });
    }
  }

  // Audio lookahead: pre-buffer upcoming audio elements
  private static readonly AUDIO_LOOKAHEAD_TIME = 1.0; // seconds
  private preBufferedAudio = new WeakSet<HTMLAudioElement>();

  /**
   * Pre-buffer audio elements for clips about to become active.
   * Without this, audio starts cold at cut points causing a 100-500ms gap.
   * We seek the audio element to the correct inPoint and call load() to
   * ensure the browser has decoded audio data ready.
   */
  private preBufferUpcomingAudio(ctx: FrameContext): void {
    if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

    const lookaheadEnd = ctx.playheadPosition + AudioTrackSyncManager.AUDIO_LOOKAHEAD_TIME;

    for (const clip of ctx.clips) {
      // Only audio clips with audio elements
      if (!clip.source) continue;

      const clipStart = clip.startTime;

      // Is this clip about to become active? (starts within lookahead, not yet active)
      if (clipStart <= ctx.playheadPosition || clipStart > lookaheadEnd) continue;

      const stemSeparation = clip.audioState?.stemSeparation;
      const audibleStemLayers = getAudibleStemLayers(stemSeparation);
      const sourceLayerIsAudible = usesSourceAudioLayer(stemSeparation);
      const shouldUseStemBufferLookahead = Boolean(stemSeparation && audibleStemLayers.length > 0 && !sourceLayerIsAudible);
      if (shouldUseStemBufferLookahead) {
        for (const stem of audibleStemLayers) {
          if (stem.mediaFileId) void proxyFrameCache.getAudioBuffer(stem.mediaFileId);
        }
      }
      const stemElements = audibleStemLayers.length > 0 && !shouldUseStemBufferLookahead
        ? this.getStemAudioElements(clip)
        : null;
      const sourceAudioElement = usesSourceAudioLayer(stemSeparation)
        ? this.getAudioProxyElementForClip(clip) ?? clip.source.audioElement
        : null;
      const sourceAudioElements = sourceAudioElement ? [sourceAudioElement] : [];
      const stemAudioElements = stemElements
        ? audibleStemLayers
            .map(stem => stemElements.get(stem.id)?.element)
            .filter((element): element is HTMLAudioElement => Boolean(element))
        : [];
      const audioElements = [...sourceAudioElements, ...stemAudioElements];
      if (audioElements.length === 0) continue;

      for (const audio of audioElements) {
        // Skip if already pre-buffered
        if (this.preBufferedAudio.has(audio)) continue;

        // Skip if no source loaded
        if (!audio.src && audio.readyState === 0) continue;

        // Pre-seek to inPoint so audio data is buffered and ready
        const targetTime = clip.inPoint;
        if (Math.abs(audio.currentTime - targetTime) > 0.1) {
          audio.currentTime = targetTime;
        }

        this.preBufferedAudio.add(audio);
      }
    }
  }

  /**
   * Mute all audio during non-standard playback (reverse or fast-forward)
   * Audio can't play backwards and fast-forward audio sounds bad
   */
  private muteAllAudio(ctx: FrameContext): void {
    // Clear master audio since we're not using audio sync
    clearMasterAudio();
    this.clearAudioHandoffState();

    // Pause all audio elements
    for (const clip of ctx.clips) {
      if (clip.source?.audioElement && !clip.source.audioElement.paused) {
        clip.source.audioElement.pause();
      }
      if (clip.source?.videoElement && !clip.source.videoElement.muted) {
        clip.source.videoElement.muted = true;
      }
      if (clip.mixdownAudio && !clip.mixdownAudio.paused) {
        clip.mixdownAudio.pause();
      }
    }
    for (const set of this.stemAudioElements.values()) {
      for (const entry of set.entries.values()) {
        pauseAudioElement(entry.element);
      }
    }
    for (const audioProxy of this.activeAudioTrackProxies.values()) {
      if (!audioProxy.paused) {
        audioProxy.pause();
      }
      audioRoutingManager.removeRoute(audioProxy);
    }
    for (const audioProxy of this.activeAudioProxies.values()) {
      if (!audioProxy.paused) {
        audioProxy.pause();
      }
      audioRoutingManager.removeRoute(audioProxy);
    }
    this.stopAllStemBufferMixers();
  }

  private getLinkedAudioClipAtPlayhead(ctx: FrameContext, clip: TimelineClip): TimelineClip | undefined {
    if (!clip.linkedClipId) return undefined;

    const linkedClip = ctx.clipsAtTime.find(c => c.id === clip.linkedClipId);
    return linkedClip?.source?.type === 'audio' ? linkedClip : undefined;
  }

  private getLinkedVideoClipAtPlayhead(ctx: FrameContext, clip: TimelineClip): TimelineClip | undefined {
    if (!clip.linkedClipId) return undefined;

    const linkedClip = ctx.clipsAtTime.find(c => c.id === clip.linkedClipId);
    return linkedClip?.source?.videoElement && !linkedClip.isComposition ? linkedClip : undefined;
  }

  private getAudioProxyElementForClip(clip: TimelineClip): HTMLAudioElement | null {
    const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    if (!mediaFileId) return null;

    return this.getAudioProxyInstanceForClip(mediaFileId, clip.id, this.activeAudioTrackProxies);
  }

  private getVideoAudioProxyElementForClip(mediaFileId: string, clipId: string): HTMLAudioElement | null {
    return this.getAudioProxyInstanceForClip(mediaFileId, clipId, this.activeAudioProxies);
  }

  private getAudioProxyInstanceForClip(
    mediaFileId: string,
    clipId: string,
    activeMap: Map<string, HTMLAudioElement>,
  ): HTMLAudioElement | null {
    if (!mediaFileId) return null;

    const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
    if (!hasUsableAudioProxy(mediaFile)) return null;

    const sharedProxy = proxyFrameCache.getCachedAudioProxy(mediaFileId);
    if (sharedProxy) {
      const src = sharedProxy.currentSrc || sharedProxy.src;
      if (!src) return null;

      const existing = activeMap.get(clipId);
      if (existing && (existing.currentSrc || existing.src) === src) {
        return existing;
      }

      pauseAudioElement(existing);
      if (existing) {
        audioRoutingManager.removeRoute(existing);
      }
      const proxyInstance = createAudioProxyInstance(sharedProxy);
      if (!proxyInstance) return null;
      activeMap.set(clipId, proxyInstance);
      return proxyInstance;
    }

    void proxyFrameCache.preloadAudioProxy(mediaFileId);
    void proxyFrameCache.getAudioBuffer(mediaFileId);
    return null;
  }

  private shouldSuppressLinkedAudioClipScrub(ctx: FrameContext, clip: TimelineClip): boolean {
    if (!ctx.isDraggingPlayhead || !clip.linkedClipId) {
      return false;
    }

    const linkedVideoClip = this.getLinkedVideoClipAtPlayhead(ctx, clip);
    if (!linkedVideoClip) {
      return false;
    }

    const mediaFile = getMediaFileForClip(ctx, linkedVideoClip);
    const mediaFileId = mediaFile?.id || linkedVideoClip.mediaFileId || linkedVideoClip.id;
    return proxyFrameCache.hasAudioBuffer(mediaFileId);
  }

  private syncStemBufferMixer(options: StemBufferMixerSyncOptions): number {
    const {
      clip,
      stemSeparation,
      audibleStemLayers,
      shouldUseSourceAudio,
      sourceGain,
      routeSettings,
      timeInfo,
      effectiveVolume,
      trackMuted,
      meterTrackId,
      canBeMaster,
    } = options;

    if (
      audibleStemLayers.length === 0 ||
      !canUseStemBufferMixer(routeSettings, timeInfo.absSpeed) ||
      timeInfo.speed <= 0
    ) {
      this.stopStemBufferMixer(clip.id);
      return 0;
    }

    const sourceMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
    const audibleStemIds = new Set(audibleStemLayers.map(stem => stem.id));
    const desiredLayers: StemBufferMixerLayer[] = [];
    const sourceIsAudible = shouldUseSourceAudio && !trackMuted;
    if (sourceMediaFileId && sourceIsAudible) {
      desiredLayers.push({
        id: STEM_SOURCE_LAYER_ID,
        mediaFileId: sourceMediaFileId,
        gain: effectiveVolume * sourceGain,
        required: true,
      });
    }
    for (const stem of stemSeparation.stems) {
      if (!stem.mediaFileId) continue;
      const stemIsAudible = audibleStemIds.has(stem.id) && !trackMuted;
      if (!stemIsAudible) continue;
      desiredLayers.push({
        id: stem.id,
        mediaFileId: stem.mediaFileId,
        gain: effectiveVolume * dbToLinearGain(stem.gainDb),
        required: true,
      });
    }

    if (
      desiredLayers.length === 0 ||
      (desiredLayers.length === 1 && desiredLayers[0]?.id === STEM_SOURCE_LAYER_ID)
    ) {
      this.stopStemBufferMixer(clip.id);
      return 0;
    }

    const buffers = new Map<string, AudioBuffer>();
    const layers: StemBufferMixerLayer[] = [];
    let missingRequiredLayer = false;
    const current = this.stemBufferMixers.get(clip.id);
    for (const layer of desiredLayers) {
      const buffer = this.getCachedStemBuffer(layer.mediaFileId);
      if (!buffer) {
        void proxyFrameCache.getAudioBuffer(layer.mediaFileId);
        if (layer.required) {
          missingRequiredLayer = true;
        }
        continue;
      }
      if (current && !layer.required && !current.gains.has(layer.id)) {
        continue;
      }
      buffers.set(layer.id, buffer);
      layers.push(layer);
    }

    if (
      missingRequiredLayer ||
      layers.length === 0 ||
      (layers.length === 1 && layers[0]?.id === STEM_SOURCE_LAYER_ID)
    ) {
      this.stopStemBufferMixer(clip.id);
      return 0;
    }

    const key = JSON.stringify({
      clipId: clip.id,
      activeSetId: stemSeparation.activeSetId,
      layers: layers.map(layer => [layer.id, layer.mediaFileId]),
    });
    const context = this.getStemBufferMixerContext();
    if (context.state === 'suspended') {
      void context.resume();
    }

    let restartDriftSeconds: number | null = null;
    if (current?.key === key && current.context === context) {
      const expectedClipTime = current.getSourceTime() ?? timeInfo.clipTime;
      restartDriftSeconds = expectedClipTime - timeInfo.clipTime;
      if (Math.abs(restartDriftSeconds) <= STEM_MIXER_RESTART_DRIFT_SECONDS) {
        this.updateStemBufferMixerGains(current, layers, routeSettings.master.volume);
        if (canBeMaster) {
          this.setStemBufferMixerMasterClock(current, clip, timeInfo);
        }
        this.publishStemBufferMixerMeter(current);
        return current.sourceCount;
      }
    }

    this.stopStemBufferMixer(clip.id);
    const startAt = context.currentTime + STEM_MIXER_START_DELAY_SECONDS;
    const startOffset = Math.max(0, timeInfo.clipTime + STEM_MIXER_START_DELAY_SECONDS);
    const masterGain = context.createGain();
    const analyser = context.createAnalyser();
    const stereoSplitter = context.createChannelSplitter(2);
    const leftAnalyser = context.createAnalyser();
    const rightAnalyser = context.createAnalyser();
    analyser.fftSize = 1024;
    leftAnalyser.fftSize = analyser.fftSize;
    rightAnalyser.fftSize = analyser.fftSize;
    masterGain.gain.value = Math.max(0, Math.min(4, routeSettings.master.volume));
    masterGain.connect(analyser);
    masterGain.connect(stereoSplitter);
    stereoSplitter.connect(leftAnalyser, 0);
    stereoSplitter.connect(rightAnalyser, 1);
    analyser.connect(context.destination);

    const gains = new Map<string, GainNode>();
    const sources: AudioBufferSourceNode[] = [];
    const getSourceTime = () => {
      if (context.state === 'closed') return null;
      const sourceTime = startOffset + (context.currentTime - startAt);
      return Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : null;
    };
    for (const layer of layers) {
      const buffer = buffers.get(layer.id);
      if (!buffer) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(4, layer.gain));
      source.buffer = buffer;
      source.playbackRate.value = 1;
      source.connect(gain);
      gain.connect(masterGain);
      source.start(startAt, Math.min(startOffset, Math.max(0, buffer.duration - 0.02)));
      gains.set(layer.id, gain);
      sources.push(source);
    }

    if (sources.length === 0) {
      masterGain.disconnect();
      return 0;
    }

    this.stemBufferMixers.set(clip.id, {
      key,
      clipId: clip.id,
      context,
      masterGain,
      analyser,
      stereoSplitter,
      leftAnalyser,
      rightAnalyser,
      meterSamples: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
      leftMeterSamples: new Float32Array(leftAnalyser.fftSize) as Float32Array<ArrayBuffer>,
      rightMeterSamples: new Float32Array(rightAnalyser.fftSize) as Float32Array<ArrayBuffer>,
      meterTrackId,
      getSourceTime,
      sources,
      gains,
      startedAtContextTime: startAt,
      startedClipTime: startOffset,
      sourceCount: sources.length,
      lastGainSignature: '',
      lastMeterPublishAt: 0,
    });
    const session = this.stemBufferMixers.get(clip.id)!;
    this.updateStemBufferMixerGains(session, layers, routeSettings.master.volume);
    if (canBeMaster) {
      this.setStemBufferMixerMasterClock(session, clip, timeInfo);
    }
    vfPipelineMonitor.record('audio_stem_mixer', {
      action: current ? 'restart' : 'start',
      clipId: clip.id,
      sources: sources.length,
      driftMs: restartDriftSeconds === null ? 0 : Math.round(restartDriftSeconds * 1000),
    });
    this.publishStemBufferMixerMeter(session, true);

    return sources.length;
  }

  private getCachedStemBuffer(mediaFileId: string): AudioBuffer | null {
    const cache = proxyFrameCache as unknown as { audioBufferCache?: Map<string, AudioBuffer> };
    return cache.audioBufferCache?.get(mediaFileId) ?? null;
  }

  private setStemBufferMixerMasterClock(
    session: StemBufferMixerSession,
    clip: TimelineClip,
    timeInfo: ClipTimeInfo,
  ): void {
    setMasterAudioClock(
      session.getSourceTime,
      clip.startTime,
      clip.inPoint,
      timeInfo.absSpeed,
    );
  }

  private getStemBufferMixerContext(): AudioContext {
    if (!this.stemBufferMixerContext || this.stemBufferMixerContext.state === 'closed') {
      this.stemBufferMixerContext = new AudioContext();
    }
    return this.stemBufferMixerContext;
  }

  private updateStemBufferMixerGains(
    session: StemBufferMixerSession,
    layers: StemBufferMixerLayer[],
    masterVolume: number,
  ): void {
    const gainSignature = JSON.stringify({
      masterVolume: Math.round(masterVolume * 1000) / 1000,
      layers: layers.map(layer => [layer.id, Math.round(layer.gain * 1000) / 1000]),
    });
    if (session.lastGainSignature === gainSignature) {
      return;
    }
    session.lastGainSignature = gainSignature;

    const now = session.context.currentTime;
    session.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(4, masterVolume)), now, 0.01);
    const targetGains = new Map(layers.map(layer => [layer.id, Math.max(0, Math.min(4, layer.gain))]));
    for (const [layerId, gain] of session.gains) {
      gain.gain.setTargetAtTime(targetGains.get(layerId) ?? 0, now, 0.01);
    }
  }

  private publishStemBufferMixerMeter(session: StemBufferMixerSession, force = false): void {
    const now = performance.now();
    if (!force && now - session.lastMeterPublishAt < STEM_MIXER_METER_INTERVAL_MS) {
      return;
    }
    session.lastMeterPublishAt = now;
    session.analyser.getFloatTimeDomainData(session.meterSamples);
    session.leftAnalyser.getFloatTimeDomainData(session.leftMeterSamples);
    session.rightAnalyser.getFloatTimeDomainData(session.rightMeterSamples);
    const snapshot = calculateAudioMeterSnapshot(
      session.meterSamples,
      now,
      undefined,
      {
        left: session.leftMeterSamples,
        right: session.rightMeterSamples,
      },
    );
    useTimelineStore.getState().updateRuntimeAudioMeter(session.meterTrackId, snapshot);
  }

  private pauseStemAudioElements(clipId: string): void {
    const set = this.stemAudioElements.get(clipId);
    if (!set) return;
    for (const entry of set.entries.values()) {
      pauseAudioElement(entry.element);
      if (entry.element) {
        audioRoutingManager.removeRoute(entry.element);
      }
    }
  }

  private stopStemBufferMixer(clipId: string): void {
    const session = this.stemBufferMixers.get(clipId);
    if (!session) return;
    if (playheadState.masterAudioClock === session.getSourceTime) {
      clearMasterAudio();
    }
    for (const source of session.sources) {
      try {
        source.stop();
      } catch {
        // Source nodes may already have ended.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
    for (const gain of session.gains.values()) {
      try {
        gain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
    try {
      session.masterGain.disconnect();
    } catch {
      // Ignore cleanup errors.
    }
    try {
      session.analyser.disconnect();
    } catch {
      // Ignore cleanup errors.
    }
    try {
      session.stereoSplitter.disconnect();
    } catch {
      // Ignore cleanup errors.
    }
    try {
      session.leftAnalyser.disconnect();
    } catch {
      // Ignore cleanup errors.
    }
    try {
      session.rightAnalyser.disconnect();
    } catch {
      // Ignore cleanup errors.
    }
    this.stemBufferMixers.delete(clipId);
    vfPipelineMonitor.record('audio_stem_mixer', {
      action: 'stop',
      clipId,
      sources: session.sourceCount,
    });
  }

  private stopAllStemBufferMixers(): void {
    for (const clipId of Array.from(this.stemBufferMixers.keys())) {
      this.stopStemBufferMixer(clipId);
    }
  }

  private getStemAudioElements(clip: TimelineClip): Map<string, StemAudioElementEntry> | null {
    const key = createStemLayerSetKey(clip);
    const stemSeparation = clip.audioState?.stemSeparation;
    if (!key || !stemSeparation) {
      this.disposeStemAudioSet(clip.id);
      return null;
    }

    const existing = this.stemAudioElements.get(clip.id);
    if (existing?.key === key) {
      return existing.entries;
    }

    this.disposeStemAudioSet(clip.id);
    const entries = new Map<string, StemAudioElementEntry>();
    for (const stem of stemSeparation.stems) {
      entries.set(stem.id, {
        key,
        element: null,
        loading: true,
      });
      void this.loadStemAudioElement(clip.id, key, stem);
    }

    this.stemAudioElements.set(clip.id, { key, entries });
    return entries;
  }

  private async loadStemAudioElement(
    clipId: string,
    key: string,
    stem: ClipAudioStemLayer,
  ): Promise<void> {
    try {
      const mediaFile = stem.mediaFileId
        ? useMediaStore.getState().files.find(file => file.id === stem.mediaFileId)
        : undefined;
      if (stem.mediaFileId && mediaFile && hasUsableAudioProxy(mediaFile)) {
        const element = await proxyFrameCache.getAudioProxy(stem.mediaFileId);
        const proxyInstance = element ? createAudioProxyInstance(element) : null;
        const current = this.stemAudioElements.get(clipId);
        if (!current || current.key !== key) return;

        if (proxyInstance) {
          this.disposeStemAudioElementEntry(current.entries.get(stem.id));
          current.entries.set(stem.id, {
            key,
            element: proxyInstance,
            loading: false,
          });
          return;
        }
      }

      if (mediaFile?.url) {
        const current = this.stemAudioElements.get(clipId);
        if (!current || current.key !== key) return;

        this.disposeStemAudioElementEntry(current.entries.get(stem.id));
        const element = createAudioElementFromUrl(mediaFile.url);
        current.entries.set(stem.id, {
          key,
          element,
          loading: false,
        });
        void element.load();
        return;
      }

      const resolver = new StemAudioSourceResolver({
        artifactStore: createCurrentAudioArtifactStore(),
      });
      const buffer = await resolver.resolveStemLayerBuffer(stem);
      if (!buffer) {
        const current = this.stemAudioElements.get(clipId);
        if (current?.key === key) {
          current.entries.set(stem.id, {
            key,
            element: null,
            loading: false,
            error: `Missing stem artifact: ${stem.label}`,
          });
        }
        return;
      }

      const { element, url } = createAudioElementFromBuffer(buffer);
      const current = this.stemAudioElements.get(clipId);
      if (!current || current.key !== key) {
        URL.revokeObjectURL(url);
        return;
      }

      this.disposeStemAudioElementEntry(current.entries.get(stem.id));
      current.entries.set(stem.id, {
        key,
        element,
        loading: false,
        url,
      });
      void element.load();
    } catch (error) {
      const current = this.stemAudioElements.get(clipId);
      if (current?.key === key) {
        current.entries.set(stem.id, {
          key,
          element: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      log.warn('Failed to prepare stem preview audio', { clipId, stemId: stem.id, error });
    }
  }

  private disposeStemAudioElementEntry(entry: StemAudioElementEntry | undefined): void {
    if (!entry) return;

    pauseAudioElement(entry.element);
    if (entry.element) {
      audioRoutingManager.removeRoute(entry.element);
    }
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }

  private disposeStemAudioSet(clipId: string): void {
    const set = this.stemAudioElements.get(clipId);
    this.stopStemBufferMixer(clipId);
    if (!set) return;

    for (const entry of set.entries.values()) {
      this.disposeStemAudioElementEntry(entry);
    }
    this.stemAudioElements.delete(clipId);
  }

  private publishSilentStemMeter(trackId: string, now: number): void {
    const silent = createSilentAudioMeterSnapshot(now);
    useTimelineStore.getState().updateRuntimeAudioMeter(trackId, silent, silent);
  }
}
