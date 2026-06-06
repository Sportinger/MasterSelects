// LayerPlaybackManager - Manages background composition playback for Resolume-style multi-layer mode
// Each slot grid layer (A-D) can have an active composition; this service loads their media elements
// and provides layers for rendering. The primary (editor) composition is handled by the timeline store.

import type { TimelineClip, TimelineTrack, Layer, NestedCompositionData, BlendMode } from '../types';
import { engine } from '../engine/WebGPUEngine';
import type { Composition, SlotClipEndBehavior } from '../stores/mediaStore/types';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { DEFAULT_TRANSFORM } from '../stores/timeline/constants';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
} from './mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import {
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from './mediaRuntime/runtimePlayback';
import { flags } from '../engine/featureFlags';
import { Logger } from './logger';
import { slotDeckManager } from './slotDeckManager';
import { vectorAnimationRuntimeManager } from './vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType, type VectorAnimationProvider } from '../types/vectorAnimation';
import { getEffectiveScale } from '../utils/transformScale';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
  reservePlannedClipRuntimeResources,
} from './timeline/runtimeResourceReporting';
import {
  startTimelineImageHydration,
  type TimelineImageHydrationHandle,
} from './timeline/imageRuntimeHydrator';

const log = Logger.create('LayerPlayback');

function getRuntimeSrcKind(url: string): 'blob-url' | 'remote-url' | 'media-source' | 'unknown' {
  if (!url) return 'unknown';
  if (url.startsWith('blob:')) return 'blob-url';
  if (url.startsWith('http')) return 'remote-url';
  if (url.startsWith('mediastream:')) return 'media-source';
  return 'unknown';
}

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
  private pendingImageHydrations = new Map<string, TimelineImageHydrationHandle>();
  private pendingVideoDisposers = new Map<string, () => void>();

  private getRuntimeOwnerId(layerIndex: number, clipId: string): string {
    return `background:${layerIndex}:${clipId}`;
  }

  private cleanupVideoElement(video: HTMLVideoElement): void {
    video.pause();
    engine.cleanupVideo(video);
    video.removeAttribute('src');
    video.src = '';
    try {
      video.load();
    } catch {
      // Browser teardown can race media loading; releasing GPU/cache state is the important part.
    }
  }

  private disposePendingVideo(ownerId: string): void {
    const dispose = this.pendingVideoDisposers.get(ownerId);
    if (!dispose) {
      return;
    }
    dispose();
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
      } else if (isVectorAnimationSourceType(sourceType) && mediaFile?.file) {
        clip.isLoading = true;
        clip.source = {
          type: sourceType,
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        this.loadVectorAnimationForClip(clip, layerIndex, mediaFile.file, sourceType);
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
      const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
      this.pendingImageHydrations.get(ownerId)?.cancel();
      this.pendingImageHydrations.delete(ownerId);
      this.disposePendingVideo(ownerId);
      releaseReportedClipRuntimeResources('background', ownerId);
      if (clip.source?.videoElement) {
        this.cleanupVideoElement(clip.source.videoElement);
      }
      if (clip.source?.audioElement) {
        clip.source.audioElement.pause();
        clip.source.audioElement.src = '';
        clip.source.audioElement.load();
      }
      if (clip.source?.imageElement) {
        clip.source.imageElement.removeAttribute('src');
        clip.source.imageElement.src = '';
      }
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
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
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.renderClipAtTime(
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
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'background',
      ownerId,
      ownerType: 'clip',
      clip,
      source: runtimePlan?.source ?? {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'video',
      srcKind: getRuntimeSrcKind(url),
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      log.debug('Background video load skipped by runtime admission', {
        clipId: clip.id,
        layerIndex,
        reason: admission.decision.reason,
        rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
      });
      return;
    }

    this.disposePendingVideo(ownerId);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true; // Background layers muted by default
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let disposed = false;
    const disposePending = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      video.removeEventListener('canplaythrough', onCanPlayThrough);
      video.removeEventListener('error', onError);
      admission.release();
      this.cleanupVideoElement(video);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
    };
    const onCanPlayThrough = () => {
      if (disposed) {
        return;
      }
      if (this.layerStates.get(layerIndex)?.clips.includes(clip) !== true) {
        disposePending();
        return;
      }
      disposed = true;
      video.removeEventListener('error', onError);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'video',
          videoElement: video,
          naturalDuration: video.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      log.debug(`Video loaded for background clip ${clip.name} on layer ${layerIndex}`);
      // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
      engine.preCacheVideoFrame(video);
    };

    const onError = () => {
      disposePending();
      clip.isLoading = false;
      log.warn(`Failed to load video for background clip ${clip.name}`);
    };

    this.pendingVideoDisposers.set(ownerId, disposePending);
    video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
    video.addEventListener('error', onError, { once: true });
  }

  private loadAudioForClip(clip: TimelineClip, layerIndex: number, url: string, mediaFileId: string): void {
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'background',
      ownerId,
      ownerType: 'clip',
      clip,
      source: runtimePlan?.source ?? {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'audio',
      srcKind: getRuntimeSrcKind(url),
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      log.debug('Background audio load skipped by runtime admission', {
        clipId: clip.id,
        layerIndex,
        reason: admission.decision.reason,
        rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
      });
      return;
    }

    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    audio.addEventListener('canplaythrough', () => {
      if (this.layerStates.get(layerIndex)?.clips.includes(clip) !== true) {
        admission.release();
        audio.pause();
        audio.src = '';
        audio.load();
        return;
      }
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'audio',
          audioElement: audio,
          naturalDuration: audio.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      log.debug(`Audio loaded for background clip ${clip.name} on layer ${layerIndex}`);
    }, { once: true });

    audio.addEventListener('error', () => {
      admission.release();
      clip.isLoading = false;
      log.warn(`Failed to load audio for background clip ${clip.name}`);
    }, { once: true });
  }

  private loadImageForClip(clip: TimelineClip, layerIndex: number, url: string): void {
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    this.pendingImageHydrations.get(ownerId)?.cancel();
    const handle = startTimelineImageHydration({
      url,
      resource: {
        id: `timeline-runtime:background:${ownerId}:image-canvas:image`,
        policyId: 'background',
        owner: {
          ownerId,
          ownerType: 'clip',
          clipId: clip.id,
          trackId: clip.trackId,
          mediaFileId: clip.mediaFileId,
        },
        source: {
          sourceId: clip.mediaFileId,
          mediaFileId: clip.mediaFileId,
          clipId: clip.id,
          trackId: clip.trackId,
          previewPath: url,
        },
        imageId: `${ownerId}:image`,
        label: 'Background image hydration',
        tags: ['background', 'image'],
      },
      isCurrent: () => this.layerStates.get(layerIndex)?.clips.includes(clip) === true,
      onReady: (img) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.source = bindSourceRuntimeForOwner({
          ownerId,
          source: {
            type: 'image',
            imageElement: img,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          },
          mediaFileId: clip.mediaFileId,
          sessionPolicy: 'background',
          sessionOwnerId: ownerId,
        });
        this.reportClipResources(layerIndex, clip);
        clip.isLoading = false;
        log.debug(`Image loaded for background clip ${clip.name} on layer ${layerIndex}`);
      },
      onError: () => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        log.warn(`Failed to load image for background clip ${clip.name}`);
      },
      onStale: () => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
      },
      onAdmissionDenied: (decision) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        log.debug('Background image hydration skipped by runtime admission', {
          clipId: clip.id,
          layerIndex,
          reason: decision.reason,
          rejectedUnits: decision.rejectedUnits.map((entry) => entry.unit),
        });
      },
    });
    if (!handle.admitted) {
      return;
    }
    this.pendingImageHydrations.set(ownerId, handle);
  }

  private loadVectorAnimationForClip(
    clip: TimelineClip,
    layerIndex: number,
    file: File,
    sourceType: VectorAnimationProvider
  ): void {
    void (async () => {
      try {
        if (clip.source?.type !== sourceType) {
          clip.source = {
            type: sourceType,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          };
        }
        const runtimeOwnerId = this.getRuntimeOwnerId(layerIndex, clip.id);
        const runtime = await vectorAnimationRuntimeManager.prepareClipSource(clip, file, {
          policyId: 'background',
          ownerId: runtimeOwnerId,
          ownerType: 'clip',
          label: `Background layer ${layerIndex} vector runtime canvas`,
          tags: ['background-layer', `layer-${layerIndex}`, 'vector-animation'],
        });
        const naturalDuration =
          runtime.metadata.duration ??
          clip.source?.naturalDuration ??
          clip.duration;
        clip.file = file;
        clip.source = {
          type: sourceType,
          textCanvas: runtime.canvas,
          mediaFileId: clip.mediaFileId,
          naturalDuration,
          vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        };
        this.reportClipResources(layerIndex, clip);
        clip.isLoading = false;
        vectorAnimationRuntimeManager.renderClipAtTime(clip, clip.startTime);
      } catch (error) {
        clip.isLoading = false;
        log.warn(`Failed to load vector animation for background clip ${clip.name}`, error);
      }
    })();
  }

  private reportClipResources(layerIndex: number, clip: TimelineClip): void {
    reportClipRuntimeResources({
      policyId: 'background',
      ownerId: this.getRuntimeOwnerId(layerIndex, clip.id),
      ownerType: 'clip',
      clip,
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
  }
}

// Singleton
export const layerPlaybackManager = new LayerPlaybackManager();
