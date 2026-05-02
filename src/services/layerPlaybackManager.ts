// LayerPlaybackManager - Manages background composition playback for Resolume-style multi-layer mode
// Each slot grid layer (A-D) can have an active composition; this service loads their media elements
// and provides layers for rendering. The primary (editor) composition is handled by the timeline store.

import type { TimelineClip, TimelineTrack, Layer, NestedCompositionData, BlendMode } from '../types';
import { engine } from '../engine/WebGPUEngine';
import type { Composition, SlotClipEndBehavior } from '../stores/mediaStore/types';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { DEFAULT_TRANSFORM } from '../stores/timeline/constants';
import { bindSourceRuntimeForOwner } from './mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import {
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from './mediaRuntime/runtimePlayback';
import { flags } from '../engine/featureFlags';
import { Logger } from './logger';
import { slotDeckManager } from './slotDeckManager';
import { lottieRuntimeManager } from './vectorAnimation/LottieRuntimeManager';
import { getEffectiveScale } from '../utils/transformScale';

const log = Logger.create('LayerPlayback');

interface LayerCompState {
  compositionId: string;
  composition: Composition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration: number;
  // Anchor-based transport for slot playback.
  anchorTime: number;
  anchorStartedAt: number;
  playbackState: 'playing' | 'paused' | 'stopped';
  clearRequested: boolean;
  resourceOwnership: 'layer' | 'slot-deck';
  slotIndex: number | null;
}

interface LayerPlaybackInfo {
  compositionId: string;
  currentTime: number;
  trimIn: number;
  trimOut: number;
  endBehavior: SlotClipEndBehavior;
  playbackState: LayerCompState['playbackState'];
  shouldRender: boolean;
}

class LayerPlaybackManager {
  private getRuntimeOwnerId(layerIndex: number, clipId: string): string {
    return `background:${layerIndex}:${clipId}`;
  }

  // Layer index (0=A, 1=B, 2=C, 3=D) → loaded composition state
  private layerStates = new Map<number, LayerCompState>();

  /**
   * Activate a composition on a layer — loads its timelineData and creates media elements
   */
  activateLayer(
    layerIndex: number,
    compositionId: string,
    initialElapsed?: number,
    options?: { slotIndex?: number | null }
  ): void {
    // Deactivate current layer first
    this.deactivateLayer(layerIndex);

    const preparedDeck =
      flags.useWarmSlotDecks && options?.slotIndex !== undefined && options.slotIndex !== null
        ? slotDeckManager.getPreparedDeck(options.slotIndex, compositionId)
        : null;

    if (preparedDeck && options?.slotIndex !== undefined && options.slotIndex !== null) {
      const adopted = slotDeckManager.adoptDeckToLayer(options.slotIndex, layerIndex, initialElapsed);
      if (adopted) {
        const initialTime = this.getInitialLayerTime(compositionId, preparedDeck.duration, initialElapsed);
        this.layerStates.set(layerIndex, {
          compositionId,
          composition: preparedDeck.composition,
          clips: preparedDeck.clips,
          tracks: preparedDeck.tracks,
          duration: preparedDeck.duration,
          anchorTime: initialTime,
          anchorStartedAt: performance.now(),
          playbackState: 'playing',
          clearRequested: false,
          resourceOwnership: 'slot-deck',
          slotIndex: options.slotIndex,
        });
        log.info(`Adopted warm slot deck ${options.slotIndex} onto layer ${layerIndex}`);
        return;
      }
    }

    const { compositions, files } = useMediaStore.getState();
    const comp = compositions.find(c => c.id === compositionId);
    if (!comp) {
      log.warn(`Composition ${compositionId} not found`);
      return;
    }

    const timelineData = comp.timelineData;
    if (!timelineData || !timelineData.clips || timelineData.clips.length === 0) {
      log.info(`Composition ${comp.name} has no timeline data, activating with empty state`);
      const initialTime = this.getInitialLayerTime(compositionId, comp.duration, initialElapsed);
      this.layerStates.set(layerIndex, {
        compositionId,
        composition: comp,
        clips: [],
        tracks: timelineData?.tracks || [],
        duration: comp.duration,
        anchorTime: initialTime,
        anchorStartedAt: performance.now(),
        playbackState: 'playing',
        clearRequested: false,
        resourceOwnership: 'layer',
        slotIndex: null,
      });
      return;
    }

    // Hydrate serialized clips into live TimelineClips with media elements
    const hydratedClips: TimelineClip[] = [];

    for (const serializedClip of timelineData.clips) {
      const mediaFile = files.find(f => f.id === serializedClip.mediaFileId);
      const clip: TimelineClip = {
        id: serializedClip.id,
        trackId: serializedClip.trackId,
        name: serializedClip.name,
        file: mediaFile?.file ?? new File([], serializedClip.name),
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: null,
        transform: serializedClip.transform || { ...DEFAULT_TRANSFORM },
        effects: serializedClip.effects || [],
        mediaFileId: serializedClip.mediaFileId,
        reversed: serializedClip.reversed,
        isComposition: serializedClip.isComposition,
        compositionId: serializedClip.compositionId,
        masks: serializedClip.masks,
      };

      if (!mediaFile && !serializedClip.isComposition) {
        // Can't load without media file (unless it's a nested comp)
        clip.isLoading = false;
        hydratedClips.push(clip);
        continue;
      }

      const sourceType = serializedClip.sourceType;
      const fileUrl = mediaFile?.url;

      if (sourceType === 'video' && fileUrl) {
        clip.isLoading = true;
        this.loadVideoForClip(clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'audio' && fileUrl) {
        clip.isLoading = true;
        this.loadAudioForClip(clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'image' && fileUrl) {
        clip.isLoading = true;
        this.loadImageForClip(clip, layerIndex, fileUrl);
      } else if (sourceType === 'lottie' && mediaFile?.file) {
        clip.isLoading = true;
        clip.source = {
          type: 'lottie',
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        this.loadLottieForClip(clip, mediaFile.file);
      } else {
        clip.isLoading = false;
      }

      hydratedClips.push(clip);
    }

    const initialTime = this.getInitialLayerTime(compositionId, comp.duration, initialElapsed);
    this.layerStates.set(layerIndex, {
      compositionId,
      composition: comp,
      clips: hydratedClips,
      tracks: timelineData.tracks,
      duration: comp.duration,
      anchorTime: initialTime,
      anchorStartedAt: performance.now(),
      playbackState: 'playing',
      clearRequested: false,
      resourceOwnership: 'layer',
      slotIndex: null,
    });

    log.info(`Activated layer ${layerIndex} with composition "${comp.name}" (${hydratedClips.length} clips, initialElapsed=${initialElapsed ?? 0}s)`);
  }

  /**
   * Deactivate a layer — pause and clean up media elements
   */
  deactivateLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) return;

    if (state.resourceOwnership === 'slot-deck' && state.slotIndex !== null) {
      for (const clip of state.clips) {
        clip.source?.videoElement?.pause();
        clip.source?.audioElement?.pause();
      }
      slotDeckManager.releaseLayerPin(state.slotIndex, layerIndex);
      this.layerStates.delete(layerIndex);
      log.info(`Deactivated slot-deck-backed layer ${layerIndex}`);
      return;
    }

    for (const clip of state.clips) {
      if (clip.source?.videoElement) {
        clip.source.videoElement.pause();
        clip.source.videoElement.src = '';
        clip.source.videoElement.load();
      }
      if (clip.source?.audioElement) {
        clip.source.audioElement.pause();
        clip.source.audioElement.src = '';
        clip.source.audioElement.load();
      }
      if (clip.source?.type === 'lottie') {
        lottieRuntimeManager.destroyClipRuntime(clip.id);
      }
      if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
        mediaRuntimeRegistry.releaseSession(
          clip.source.runtimeSourceId,
          clip.source.runtimeSessionKey
        );
        mediaRuntimeRegistry.releaseRuntime(
          clip.source.runtimeSourceId,
          this.getRuntimeOwnerId(layerIndex, clip.id)
        );
      }
    }

    this.layerStates.delete(layerIndex);
    log.info(`Deactivated layer ${layerIndex}`);
  }

  /**
   * Deactivate all layers
   */
  deactivateAll(): void {
    for (const layerIndex of Array.from(this.layerStates.keys())) {
      this.deactivateLayer(layerIndex);
    }
  }

  /**
   * Get the state for a layer (or undefined if not active)
   */
  getLayerState(layerIndex: number): LayerCompState | undefined {
    return this.layerStates.get(layerIndex);
  }

  /**
   * Check if a layer has an active composition
   */
  isLayerActive(layerIndex: number): boolean {
    return this.layerStates.has(layerIndex);
  }

  getLayerPlaybackInfo(layerIndex: number): LayerPlaybackInfo | null {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return null;
    }

    return this.resolveLayerPlayback(state, layerIndex);
  }

  playLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const { trimIn, trimOut, endBehavior } = this.getPlaybackWindow(state);
    const resolved = this.resolveLayerPlayback(state, layerIndex);
    const restartAtTrimIn =
      endBehavior !== 'loop' &&
      resolved.currentTime >= trimOut - 0.0001;

    state.anchorTime = restartAtTrimIn ? trimIn : Math.max(trimIn, Math.min(resolved.currentTime, trimOut));
    state.anchorStartedAt = performance.now();
    state.playbackState = 'playing';
    state.clearRequested = false;
  }

  pauseLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const resolved = this.resolveLayerPlayback(state, layerIndex);
    state.anchorTime = resolved.currentTime;
    state.anchorStartedAt = performance.now();
    state.playbackState = 'paused';
    state.clearRequested = false;
    this.pauseMediaElements(state);
  }

  stopLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const { trimIn } = this.getPlaybackWindow(state);
    state.anchorTime = trimIn;
    state.anchorStartedAt = performance.now();
    state.playbackState = 'stopped';
    state.clearRequested = false;
    this.pauseMediaElements(state);
  }

  /**
   * Build render layers for a background composition.
   * Uses independent wall-clock time per layer, NOT the global playhead.
   */
  buildLayersForLayer(layerIndex: number, _playheadPosition: number): Layer | null {
    const state = this.layerStates.get(layerIndex);
    if (!state) return null;

    const playback = this.resolveLayerPlayback(state, layerIndex);
    if (!playback.shouldRender) {
      return null;
    }

    const layerTime = playback.currentTime;
    const innerLayers = this.buildInnerLayers(state, layerTime);
    if (innerLayers.length === 0) return null;

    const nestedCompData: NestedCompositionData = {
      compositionId: state.compositionId,
      layers: innerLayers,
      width: state.composition.width,
      height: state.composition.height,
      currentTime: layerTime,
    };

    // Read per-layer opacity from store
    const layerOpacity = useMediaStore.getState().layerOpacities[layerIndex] ?? 1;

    // Wrap as a single full-screen layer
    const layer: Layer = {
      id: `bg-layer-${layerIndex}-${state.compositionId}`,
      name: `Layer ${String.fromCharCode(65 + layerIndex)}: ${state.composition.name}`,
      visible: true,
      opacity: layerOpacity,
      blendMode: 'normal',
      source: { type: 'image', nestedComposition: nestedCompData },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    return layer;
  }

  private getPlaybackWindow(state: LayerCompState): {
    trimIn: number;
    trimOut: number;
    endBehavior: SlotClipEndBehavior;
  } {
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[state.compositionId];
    const safeDuration = Math.max(state.duration, 0.05);

    if (!configured) {
      return {
        trimIn: 0,
        trimOut: safeDuration,
        endBehavior: 'loop',
      };
    }

    if (safeDuration <= 0.05) {
      return {
        trimIn: 0,
        trimOut: safeDuration,
        endBehavior: configured.endBehavior,
      };
    }

    const trimIn = Math.max(0, Math.min(configured.trimIn, safeDuration - 0.05));
    const trimOut = Math.max(trimIn + 0.05, Math.min(configured.trimOut, safeDuration));

    return {
      trimIn,
      trimOut,
      endBehavior: configured.endBehavior,
    };
  }

  private getInitialLayerTime(compositionId: string, duration: number, initialElapsed?: number): number {
    const safeDuration = Math.max(duration, 0.05);
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[compositionId];
    if (!configured) {
      return Math.max(0, Math.min(initialElapsed ?? 0, safeDuration));
    }

    const trimIn = Math.max(0, Math.min(configured.trimIn, safeDuration));
    const trimOut = Math.max(trimIn, Math.min(configured.trimOut, safeDuration));
    const candidate = initialElapsed ?? trimIn;

    if (candidate < trimIn || candidate > trimOut) {
      return trimIn;
    }

    return candidate;
  }

  private getAnchoredTime(state: LayerCompState): number {
    if (state.playbackState === 'playing') {
      const elapsed = (performance.now() - state.anchorStartedAt) / 1000;
      return state.anchorTime + elapsed;
    }

    return state.anchorTime;
  }

  private requestClearLayer(layerIndex: number, state: LayerCompState): void {
    if (state.clearRequested) {
      return;
    }

    state.clearRequested = true;
    this.pauseMediaElements(state);
    useMediaStore.getState().deactivateLayer(layerIndex);
  }

  private resolveLayerPlayback(state: LayerCompState, layerIndex: number): LayerPlaybackInfo {
    const { trimIn, trimOut, endBehavior } = this.getPlaybackWindow(state);
    const rawTime = this.getAnchoredTime(state);

    if (state.playbackState !== 'playing') {
      return {
        compositionId: state.compositionId,
        currentTime: Math.max(trimIn, Math.min(rawTime, trimOut)),
        trimIn,
        trimOut,
        endBehavior,
        playbackState: state.playbackState,
        shouldRender: !state.clearRequested,
      };
    }

    if (endBehavior === 'loop') {
      const span = Math.max(trimOut - trimIn, 0.05);
      const wrappedTime = trimIn + ((((rawTime - trimIn) % span) + span) % span);
      return {
        compositionId: state.compositionId,
        currentTime: Math.max(trimIn, Math.min(wrappedTime, trimOut)),
        trimIn,
        trimOut,
        endBehavior,
        playbackState: state.playbackState,
        shouldRender: true,
      };
    }

    if (rawTime <= trimOut) {
      return {
        compositionId: state.compositionId,
        currentTime: Math.max(trimIn, rawTime),
        trimIn,
        trimOut,
        endBehavior,
        playbackState: state.playbackState,
        shouldRender: true,
      };
    }

    if (endBehavior === 'hold') {
      state.anchorTime = trimOut;
      state.anchorStartedAt = performance.now();
      state.playbackState = 'paused';
      return {
        compositionId: state.compositionId,
        currentTime: trimOut,
        trimIn,
        trimOut,
        endBehavior,
        playbackState: state.playbackState,
        shouldRender: true,
      };
    }

    state.anchorTime = trimIn;
    state.anchorStartedAt = performance.now();
    state.playbackState = 'stopped';
    this.requestClearLayer(layerIndex, state);
    return {
      compositionId: state.compositionId,
      currentTime: trimOut,
      trimIn,
      trimOut,
      endBehavior,
      playbackState: state.playbackState,
      shouldRender: false,
    };
  }

  private pauseMediaElements(state: LayerCompState): void {
    for (const clip of state.clips) {
      clip.source?.videoElement?.pause();
      clip.source?.audioElement?.pause();
    }
  }

  /**
   * Build inner layers for a background composition (same logic as buildNestedLayers)
   */
  private buildInnerLayers(state: LayerCompState, playheadPosition: number): Layer[] {
    const layers: Layer[] = [];
    const videoTracks = state.tracks.filter(t => t.type === 'video' && t.visible !== false);

    // Clamp playhead to composition duration
    const time = Math.max(0, Math.min(playheadPosition, state.duration));

    for (const track of videoTracks) {
      // Find clip on this track at current time
      const clip = state.clips.find(
        c => c.trackId === track.id && time >= c.startTime && time < c.startTime + c.duration
      );
      if (!clip || clip.isLoading) continue;

      const clipLocalTime = time - clip.startTime;

      // Build transform
      const transform = clip.transform || DEFAULT_TRANSFORM;
      if (clip.source?.type === 'lottie') {
        lottieRuntimeManager.renderClipAtTime(
          clip,
          time,
          useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clip.id, clipLocalTime),
        );
      }
      const clipTime = clip.reversed
        ? clip.outPoint - clipLocalTime
        : clipLocalTime + clip.inPoint;
      const layer = this.buildClipLayer(clip, clipTime, transform);
      if (layer) {
        layers.push(layer);
      }
    }

    return layers;
  }

  /**
   * Build a single layer from a clip
   */
  private buildClipLayer(
    clip: TimelineClip,
    clipTime: number,
    transform: typeof DEFAULT_TRANSFORM
  ): Layer | null {
    const baseLayer = {
      id: `bg-clip-${clip.id}`,
      name: clip.name,
      visible: true,
      opacity: transform.opacity ?? 1,
      blendMode: (transform.blendMode || 'normal') as BlendMode,
      effects: clip.effects || [],
      position: {
        x: transform.position?.x || 0,
        y: transform.position?.y || 0,
        z: transform.position?.z || 0,
      },
      scale: getEffectiveScale(transform.scale),
      rotation: {
        x: ((transform.rotation?.x || 0) * Math.PI) / 180,
        y: ((transform.rotation?.y || 0) * Math.PI) / 180,
        z: ((transform.rotation?.z || 0) * Math.PI) / 180,
      },
    };

    if (clip.source?.videoElement) {
      updateRuntimePlaybackTime(clip.source, clipTime, 'background');
      const runtimeProvider =
        getRuntimeFrameProvider(clip.source, 'background') ??
        clip.source.webCodecsPlayer;
      return {
        ...baseLayer,
        source: {
          type: 'video',
          videoElement: clip.source.videoElement,
          webCodecsPlayer: runtimeProvider ?? undefined,
          runtimeSourceId: clip.source.runtimeSourceId,
          runtimeSessionKey: clip.source.runtimeSessionKey,
        },
      } as Layer;
    }

    if (clip.source?.imageElement) {
      return {
        ...baseLayer,
        source: { type: 'image', imageElement: clip.source.imageElement },
      } as Layer;
    }

    if (clip.source?.textCanvas) {
      return {
        ...baseLayer,
        source: { type: 'text', textCanvas: clip.source.textCanvas },
      } as Layer;
    }

    return null;
  }

  /**
   * Sync video elements for all background layers (each uses its own independent time)
   */
  syncVideoElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);
      const time = playback.currentTime;

      for (const clip of state.clips) {
        if (!clip.source?.videoElement) continue;

        const video = clip.source.videoElement;
        const isActive = time >= clip.startTime && time < clip.startTime + clip.duration;

        if (!playback.shouldRender || !isActive) {
          if (!video.paused) video.pause();
          continue;
        }

        const clipLocalTime = time - clip.startTime;
        const clipTime = clip.reversed
          ? clip.outPoint - clipLocalTime
          : clipLocalTime + clip.inPoint;

        const timeDiff = Math.abs(video.currentTime - clipTime);

        if (timeDiff > 0.5) {
          video.currentTime = clipTime;
        }

        if (playback.playbackState === 'playing') {
          if (video.paused) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }

        if (playback.playbackState !== 'playing' && timeDiff > 0.05) {
          video.currentTime = clipTime;
        }
      }
    }
  }

  /**
   * Sync audio elements for all background layers (each uses its own independent time)
   */
  syncAudioElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);
      const time = playback.currentTime;

      for (const clip of state.clips) {
        if (!clip.source?.audioElement) continue;

        const audio = clip.source.audioElement;
        const isActive = time >= clip.startTime && time < clip.startTime + clip.duration;

        if (!playback.shouldRender || !isActive) {
          if (!audio.paused) audio.pause();
          continue;
        }

        const clipLocalTime = time - clip.startTime;
        const clipTime = clip.reversed
          ? clip.outPoint - clipLocalTime
          : clipLocalTime + clip.inPoint;

        const timeDiff = Math.abs(audio.currentTime - clipTime);

        if (timeDiff > 0.3) {
          audio.currentTime = clipTime;
        }

        if (playback.playbackState === 'playing') {
          if (audio.paused) audio.play().catch(() => {});
        } else if (!audio.paused) {
          audio.pause();
        }

        if (playback.playbackState !== 'playing' && timeDiff > 0.05) {
          audio.currentTime = clipTime;
        }
      }
    }
  }

  /**
   * Check if any background layers are active
   */
  hasActiveLayers(): boolean {
    return this.layerStates.size > 0;
  }

  /**
   * Get all active layer indices
   */
  getActiveLayerIndices(): number[] {
    return Array.from(this.layerStates.keys());
  }

  // === Private media loading methods ===

  private loadVideoForClip(clip: TimelineClip, layerIndex: number, url: string, mediaFileId: string): void {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true; // Background layers muted by default
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    video.addEventListener('canplaythrough', () => {
      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getRuntimeOwnerId(layerIndex, clip.id),
        source: {
          type: 'video',
          videoElement: video,
          naturalDuration: video.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getRuntimeOwnerId(layerIndex, clip.id),
      });
      clip.isLoading = false;
      log.debug(`Video loaded for background clip ${clip.name} on layer ${layerIndex}`);
      // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
      engine.preCacheVideoFrame(video);
    }, { once: true });

    video.addEventListener('error', () => {
      clip.isLoading = false;
      log.warn(`Failed to load video for background clip ${clip.name}`);
    }, { once: true });
  }

  private loadAudioForClip(clip: TimelineClip, layerIndex: number, url: string, mediaFileId: string): void {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    audio.addEventListener('canplaythrough', () => {
      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getRuntimeOwnerId(layerIndex, clip.id),
        source: {
          type: 'audio',
          audioElement: audio,
          naturalDuration: audio.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getRuntimeOwnerId(layerIndex, clip.id),
      });
      clip.isLoading = false;
      log.debug(`Audio loaded for background clip ${clip.name} on layer ${layerIndex}`);
    }, { once: true });

    audio.addEventListener('error', () => {
      clip.isLoading = false;
      log.warn(`Failed to load audio for background clip ${clip.name}`);
    }, { once: true });
  }

  private loadImageForClip(clip: TimelineClip, layerIndex: number, url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;

    img.addEventListener('load', () => {
      clip.source = bindSourceRuntimeForOwner({
        ownerId: this.getRuntimeOwnerId(layerIndex, clip.id),
        source: {
          type: 'image',
          imageElement: img,
        },
        mediaFileId: clip.mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: this.getRuntimeOwnerId(layerIndex, clip.id),
      });
      clip.isLoading = false;
      log.debug(`Image loaded for background clip ${clip.name} on layer ${layerIndex}`);
    }, { once: true });

    img.addEventListener('error', () => {
      clip.isLoading = false;
      log.warn(`Failed to load image for background clip ${clip.name}`);
    }, { once: true });
  }

  private loadLottieForClip(clip: TimelineClip, file: File): void {
    void (async () => {
      try {
        if (clip.source?.type !== 'lottie') {
          clip.source = {
            type: 'lottie',
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          };
        }
        const runtime = await lottieRuntimeManager.prepareClipSource(clip, file);
        const naturalDuration =
          runtime.metadata.duration ??
          clip.source?.naturalDuration ??
          clip.duration;
        clip.file = file;
        clip.source = {
          type: 'lottie',
          textCanvas: runtime.canvas,
          mediaFileId: clip.mediaFileId,
          naturalDuration,
          vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        };
        clip.isLoading = false;
        lottieRuntimeManager.renderClipAtTime(clip, clip.startTime);
      } catch (error) {
        clip.isLoading = false;
        log.warn(`Failed to load lottie for background clip ${clip.name}`, error);
      }
    })();
  }
}

// Singleton
export const layerPlaybackManager = new LayerPlaybackManager();
