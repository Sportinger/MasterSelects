// LayerPlaybackManager - Manages background composition playback for Resolume-style multi-layer mode
// Each slot grid layer (A-D) can have an active composition; this service loads their media elements
// and provides layers for rendering. The primary (editor) composition is handled by the timeline store.

import type { TimelineClip, Layer, NestedCompositionData } from '../types';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import { flags } from '../engine/featureFlags';
import { Logger } from './logger';
import { renderHostPort } from './render/renderHostPort';
import { slotDeckManager } from './slotDeckManager';
import { vectorAnimationRuntimeManager } from './vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../types/vectorAnimation';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
} from './timeline/runtimeResourceReporting';
import type { TimelineImageHydrationHandle } from './timeline/imageRuntimeHydrator';
import { createLayerTimelineClip } from './layerPlayback/clipHydration';
import {
  loadAudioForLayerClip,
  loadImageForLayerClip,
  loadVectorAnimationForLayerClip,
  loadVideoForLayerClip,
  type LayerClipMediaHost,
} from './layerPlayback/clipMediaLoaders';
import { buildBackgroundInnerLayers } from './layerPlayback/innerLayerBuilder';
import type { LayerCompState, LayerPlaybackInfo, PlaybackWindow } from './layerPlayback/layerPlaybackState';
import {
  getAnchoredLayerTime,
  resolveInitialLayerTime,
  resolveLayerPlaybackDecision,
  resolvePlaybackWindow,
} from './layerPlayback/playbackTiming';
import { syncAudioClipToPlayback, syncVideoClipToPlayback } from './layerPlayback/mediaSync';
import { createActiveLayerState } from './layerPlayback/stateFactory';

const log = Logger.create('LayerPlayback');

class LayerPlaybackManager {
  private pendingImageHydrations = new Map<string, TimelineImageHydrationHandle>();
  private pendingVideoDisposers = new Map<string, () => void>();

  private getRuntimeOwnerId(layerIndex: number, clipId: string): string {
    return `background:${layerIndex}:${clipId}`;
  }

  private cleanupVideoElement(video: HTMLVideoElement): void {
    video.pause();
    renderHostPort.cleanupVideo(video);
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

  // Host surface for clipMediaLoaders: pending-handle maps and cleanup stay owned here.
  private readonly mediaLoaderHost: LayerClipMediaHost = {
    pendingVideoDisposers: this.pendingVideoDisposers,
    pendingImageHydrations: this.pendingImageHydrations,
    getRuntimeOwnerId: (layerIndex, clipId) => this.getRuntimeOwnerId(layerIndex, clipId),
    isClipActive: (layerIndex, clip) =>
      this.layerStates.get(layerIndex)?.clips.includes(clip) === true,
    cleanupVideoElement: (video) => this.cleanupVideoElement(video),
    disposePendingVideo: (ownerId) => this.disposePendingVideo(ownerId),
    reportClipResources: (layerIndex, clip) => this.reportClipResources(layerIndex, clip),
  };

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
        this.layerStates.set(layerIndex, createActiveLayerState({
          compositionId,
          composition: preparedDeck.composition,
          clips: preparedDeck.clips,
          tracks: preparedDeck.tracks,
          duration: preparedDeck.duration,
          initialTime,
          nowMs: performance.now(),
          resourceOwnership: 'slot-deck',
          slotIndex: options.slotIndex,
        }));
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
      this.layerStates.set(layerIndex, createActiveLayerState({
        compositionId,
        composition: comp,
        clips: [],
        tracks: timelineData?.tracks || [],
        duration: comp.duration,
        initialTime,
        nowMs: performance.now(),
        resourceOwnership: 'layer',
        slotIndex: null,
      }));
      return;
    }

    // Hydrate serialized clips into live TimelineClips with media elements
    const hydratedClips: TimelineClip[] = [];

    for (const serializedClip of timelineData.clips) {
      const mediaFile = files.find(f => f.id === serializedClip.mediaFileId);
      const clip = createLayerTimelineClip(serializedClip, mediaFile);

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
        loadVideoForLayerClip(this.mediaLoaderHost, clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'audio' && fileUrl) {
        clip.isLoading = true;
        loadAudioForLayerClip(this.mediaLoaderHost, clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'image' && fileUrl) {
        clip.isLoading = true;
        loadImageForLayerClip(this.mediaLoaderHost, clip, layerIndex, fileUrl);
      } else if (isVectorAnimationSourceType(sourceType) && mediaFile?.file) {
        clip.isLoading = true;
        clip.source = {
          type: sourceType,
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        loadVectorAnimationForLayerClip(this.mediaLoaderHost, clip, layerIndex, mediaFile.file, sourceType);
      } else {
        clip.isLoading = false;
      }

      hydratedClips.push(clip);
    }

    const initialTime = this.getInitialLayerTime(compositionId, comp.duration, initialElapsed);
    this.layerStates.set(layerIndex, createActiveLayerState({
      compositionId,
      composition: comp,
      clips: hydratedClips,
      tracks: timelineData.tracks,
      duration: comp.duration,
      initialTime,
      nowMs: performance.now(),
      resourceOwnership: 'layer',
      slotIndex: null,
    }));

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
    const innerLayers = buildBackgroundInnerLayers(
      state,
      layerTime,
      (clipId, clipLocalTime) =>
        useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clipId, clipLocalTime)
    );
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

  private getPlaybackWindow(state: LayerCompState): PlaybackWindow {
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[state.compositionId];
    return resolvePlaybackWindow(state.duration, configured);
  }

  private getInitialLayerTime(compositionId: string, duration: number, initialElapsed?: number): number {
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[compositionId];
    return resolveInitialLayerTime(duration, configured, initialElapsed);
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
    const playbackWindow = this.getPlaybackWindow(state);
    const rawTime = getAnchoredLayerTime(state, performance.now());
    const decision = resolveLayerPlaybackDecision(state, playbackWindow, rawTime);

    if (decision.endAction === 'hold') {
      state.anchorTime = decision.nextAnchorTime ?? playbackWindow.trimOut;
      state.anchorStartedAt = performance.now();
      state.playbackState = decision.nextPlaybackState ?? 'paused';
    } else if (decision.endAction === 'clear') {
      state.anchorTime = decision.nextAnchorTime ?? playbackWindow.trimIn;
      state.anchorStartedAt = performance.now();
      state.playbackState = decision.nextPlaybackState ?? 'stopped';
      this.requestClearLayer(layerIndex, state);
    }

    return {
      compositionId: decision.compositionId,
      currentTime: decision.currentTime,
      trimIn: decision.trimIn,
      trimOut: decision.trimOut,
      endBehavior: decision.endBehavior,
      playbackState: decision.playbackState,
      shouldRender: decision.shouldRender,
    };
  }

  private pauseMediaElements(state: LayerCompState): void {
    for (const clip of state.clips) {
      clip.source?.videoElement?.pause();
      clip.source?.audioElement?.pause();
    }
  }

  /**
   * Sync video elements for all background layers (each uses its own independent time)
   */
  syncVideoElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);

      for (const clip of state.clips) {
        syncVideoClipToPlayback(clip, playback);
      }
    }
  }

  /**
   * Sync audio elements for all background layers (each uses its own independent time)
   */
  syncAudioElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);

      for (const clip of state.clips) {
        syncAudioClipToPlayback(clip, playback);
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
