// LayerBuilderService - Main orchestrator for layer building
// Delegates video sync to VideoSyncManager and audio sync to AudioTrackSyncManager

import type { TimelineClip, Layer, VideoBakeRegion } from '../../types';
import type { FrameContext } from './types';
import { createFrameContext, getMediaFileForClip, isVideoTrackVisible } from './FrameContext';
import { LayerCache } from './LayerCache';
import { TransformCache } from './TransformCache';
import { VideoSyncManager } from './VideoSyncManager';
import { AudioTrackSyncManager } from './AudioTrackSyncManager';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { renderHostPort } from '../render/renderHostPort';
import { Logger } from '../logger';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { videoBakeProxyCache } from '../videoBakeProxyCache';
import { hydrateTimelineMediaWindow } from '../timeline/lazyMediaElements';
import { getNativeDecoderForTimelineClip } from '../timeline/nativeDecoderRuntimeRegistry';
import {
  buildLayerBuilderImageLayer,
  getLayerBuilderRenderableImageElement,
} from './layerBuilder2dSources';
import {
  buildLayerBuilderCanvasBackedLayer,
  syncLayerBuilderCanvasRuntimeSources,
} from './layerBuilderCanvasSources';
import { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import {
  getLayerBuilderVideoSourceDebugInfo,
  hasLayerBuilderRenderableVideoSource,
  pauseLayerBuilderVideoSource,
  selectLayerBuilderPausedVisualProvider,
} from './layerBuilderVideoSources';
import { buildLayerBuilderNativeDecoderLayer, buildLayerBuilderVideoLayer } from './layerBuilderVideoLayers';
import { prewarmGaussianSplatClips } from './layerBuilder3dSources';
import {
  buildLayerBuilderGaussianSplatLayer,
  buildLayerBuilderModelLayer,
} from './layerBuilder3dLayers';
import {
  applyLayerBuilderAINodesToLayer,
  withLayerBuilderMaskProperties,
} from './layerBuilderLayerPostProcessing';
import { buildLayerBuilderMotionShapeLayer } from './layerBuilderMotionLayers';
import { buildLayerBuilderNestedCompLayer } from './layerBuilderNestedLayerBuilder';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
  type ActiveTransitionPlan,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { buildLayerBuilderTransitionCompositionLayer } from './layerBuilderTransitionComposition';

const log = Logger.create('LayerBuilder');

/**
 * LayerBuilderService - Builds render layers from timeline state
 * Optimized with caching, memoization, and object reuse
 */
export class LayerBuilderService {
  // Sub-modules
  private layerCache = new LayerCache();
  private transformCache = new TransformCache();
  private videoSyncManager = new VideoSyncManager();
  private audioTrackSyncManager = new AudioTrackSyncManager();
  private proxyFrames = new LayerBuilderProxyFrames();

  // Lookahead preloading
  private lastSplatLookaheadTime = 0;

  constructor() {
    void this.getPausedVisualProvider;
  }

  private hasRenderableVideoSource(
    source: TimelineClip['source'] | undefined,
    clip?: TimelineClip,
    ctx?: FrameContext,
  ): boolean {
    return hasLayerBuilderRenderableVideoSource(
      source,
      clip,
      clip && ctx ? getMediaFileForClip(ctx, clip) : undefined,
    );
  }

  private getPausedVisualProvider(
    source: TimelineClip['source'],
    runtimeProvider: RuntimeFrameProvider | null,
    targetTime: number,
    options?: { preferFreshRuntime?: boolean }
  ) {
    return selectLayerBuilderPausedVisualProvider(source, runtimeProvider, targetTime, options);
  }

  /**
   * Invalidate all caches (layer cache and transform cache)
   */
  invalidateCache(): void {
    this.layerCache.invalidate();
    this.transformCache.clear();
    this.proxyFrames.clear();
  }

  /**
   * Build layers for the current frame
   * Main entry point - called from render loop
   */
  buildLayersFromStore(): Layer[] {
    // Create frame context (single store read)
    const ctx = createFrameContext();
    hydrateTimelineMediaWindow(ctx);
    syncLayerBuilderCanvasRuntimeSources(ctx);
    const { activeLayerSlots = {}, activeCompositionId } = useMediaStore.getState();
    const slotGridActive = useTimelineStore.getState().slotGridProgress > 0.5;
    const hasActiveLayerSlots = Object.keys(activeLayerSlots).length > 0;
    const activeCompIsInProgram = activeCompositionId != null &&
      Object.values(activeLayerSlots).some((compositionId) => compositionId === activeCompositionId);
    const renderSlotProgramOnly =
      slotGridActive &&
      hasActiveLayerSlots &&
      !activeCompIsInProgram;

    // No active editor composition → no primary layers to build
    // (all active comps are background layers managed by layerPlaybackManager)
    const hasActiveComp = activeCompositionId != null;
    const hasStandaloneTimelineContent = ctx.clips.length > 0;
    if (renderSlotProgramOnly) {
      this.layerCache.invalidate();
      return this.mergeBackgroundLayers([], ctx.playheadPosition);
    }

    if (!hasActiveComp && !hasStandaloneTimelineContent) {
      this.layerCache.invalidate();
      return this.mergeBackgroundLayers([], ctx.playheadPosition);
    }

    this.lastSplatLookaheadTime = prewarmGaussianSplatClips(ctx, this.lastSplatLookaheadTime);

    const bakedLayer = this.buildActiveCompositionVideoBakeLayer(ctx);
    if (bakedLayer) {
      this.layerCache.invalidate();
      return this.mergeBackgroundLayers([bakedLayer], ctx.playheadPosition);
    }

    // Check cache (only for primary layers — background layers are cheap to rebuild)
    const cacheResult = this.layerCache.checkCache(ctx);
    let primaryLayers: Layer[];
    if (cacheResult.useCache) {
      primaryLayers = cacheResult.layers;
    } else {
      primaryLayers = this.buildLayers(ctx);
      if (primaryLayers.length === 0 && ctx.clipsAtTime.length > 0) {
        log.debug('No primary layers for active clips', {
          playhead: Math.round(ctx.playheadPosition * 1000) / 1000,
          activeCompId: ctx.activeCompId,
          clipCountAtTime: ctx.clipsAtTime.length,
          videoTrackCount: ctx.videoTracks.length,
          activeClips: ctx.clipsAtTime.map((clip) => ({
            id: clip.id,
            trackId: clip.trackId,
            sourceType: clip.source?.type,
            isLoading: clip.isLoading ?? false,
            ...getLayerBuilderVideoSourceDebugInfo(clip),
          })),
        });
      }
      // Preload upcoming nested comp frames during playback
      if (ctx.isPlaying) {
        this.proxyFrames.prewarmUpcomingNestedCompFrames(ctx);
      }
    }

    // Cache primary layers only — background layers are rebuilt fresh each frame
    // (caching merged layers would cause double-rendering of background layers on cache hit)
    this.layerCache.setCachedLayers(primaryLayers);

    // Merge background layers from active layer slots
    return this.mergeBackgroundLayers(primaryLayers, ctx.playheadPosition);
  }

  private getActiveCompositionVideoBakeRegion(ctx: FrameContext): VideoBakeRegion | undefined {
    if (renderHostPort.getIsExporting()) return undefined;

    return useTimelineStore.getState().videoBakeRegions.find(region =>
      region.scope === 'composition' &&
      region.status === 'baked' &&
      ctx.playheadPosition >= region.startTime &&
      ctx.playheadPosition < region.endTime &&
      videoBakeProxyCache.has(region.id)
    );
  }

  private buildActiveCompositionVideoBakeLayer(ctx: FrameContext): Layer | null {
    const bakedCompositionRegion = this.getActiveCompositionVideoBakeRegion(ctx);
    if (!bakedCompositionRegion) return null;

    return videoBakeProxyCache.buildCompositionLayer(
      bakedCompositionRegion,
      ctx.activeCompId,
      ctx.playheadPosition,
      ctx.isPlaying,
      ctx.playbackSpeed,
    );
  }

  private pausePrimaryCompositionVideoSources(ctx: FrameContext): void {
    const pauseClip = (clip: TimelineClip) => {
      pauseLayerBuilderVideoSource(clip, ctx);

      for (const nestedClip of clip.nestedClips ?? []) {
        pauseClip(nestedClip);
      }
    };

    for (const clip of ctx.clips) {
      pauseClip(clip);
    }
  }

  /**
   * Merge primary (editor) layers with background composition layers.
   * Render order: D (bottom) → C → B → A (top)
   * The primary composition's layers go at the position of its layer slot.
   */
  private mergeBackgroundLayers(primaryLayers: Layer[], playheadPosition: number): Layer[] {
    const {
      activeLayerSlots = {},
      activeCompositionId,
    } = useMediaStore.getState();
    const slotEntries = Object.entries(activeLayerSlots);

    // No active layer slots → return primary layers as-is (backwards compatible)
    if (slotEntries.length === 0) {
      return primaryLayers;
    }

    // Find which layer the primary (editor) composition is on
    let primaryLayerIndex = -1;
    if (primaryLayers.length > 0) {
      for (const [key, compId] of slotEntries) {
        if (compId === activeCompositionId) {
          primaryLayerIndex = Number(key);
          break;
        }
      }
    }

    // Collect all layer indices, sorted A=0 (top) → D=3 (bottom)
    // layers[0] is rendered last (on top) by the compositor's reverse iteration
    const layerIndices = slotEntries
      .map(([key]) => Number(key))
      .sort((a, b) => a - b); // Ascending: A=0 first (top) → D=3 last (bottom)

    const merged: Layer[] = [];

    const { layerOpacities = {} } = useMediaStore.getState();

    for (const layerIndex of layerIndices) {
      if (layerIndex === primaryLayerIndex) {
        // Insert primary layers at this position, applying layer opacity
        const layerOpacity = layerOpacities[layerIndex] ?? 1;
        // Filter out undefined entries from sparse arrays (buildLayers uses layers[trackIndex]=...)
        const actualPrimaryLayers = primaryLayers.filter((l): l is Layer => l != null);
        if (layerOpacity < 1 && actualPrimaryLayers.length > 0) {
          // Apply per-clip opacity multiplication — simpler and works with all decoder types
          // (nativeDecoder, WebCodecs, HTMLVideo, etc.) without needing NestedCompRenderer
          for (const layer of actualPrimaryLayers) {
            merged.push({ ...layer, opacity: layer.opacity * layerOpacity });
          }
        } else {
          merged.push(...actualPrimaryLayers);
        }
      } else {
        // Build background layer from LayerPlaybackManager
        const bgLayer = layerPlaybackManager.buildLayersForLayer(layerIndex, playheadPosition);
        if (bgLayer) {
          merged.push(bgLayer);
        }
      }
    }

    // If primary comp is not in any slot, add its layers on top
    if (primaryLayerIndex === -1 && primaryLayers.length > 0) {
      merged.push(...primaryLayers.filter((l): l is Layer => l != null));
    }

    return merged;
  }

  /**
   * Build layers from frame context.
   *
   * Layers are returned in top-to-bottom order; LayerCollector reverses this
   * array so lower visual layers are collected first.
   */
  private buildLayers(ctx: FrameContext): Layer[] {
    const layers: Layer[] = [];

    // Compute handoffs for seamless cut transitions (same-source sequential clips)
    this.videoSyncManager.computeHandoffs(ctx);

    ctx.videoTracks.forEach((track, layerIndex) => {
      if (!isVideoTrackVisible(ctx, track.id)) {
        return;
      }

      const activeTransition = this.getActiveTransitionForTrack(ctx, track.id);
      if (activeTransition) {
        const transitionCompLayer = buildLayerBuilderTransitionCompositionLayer(
          activeTransition,
          layerIndex,
          ctx,
          this.proxyFrames,
        );
        if (transitionCompLayer) {
          layers.push(transitionCompLayer);
        }
        return;
      }

      // Normal case: single clip or no transition
      const trackClips = ctx.clipsAtTime
        .filter(c => c.trackId === track.id)
        .toSorted((a, b) => a.startTime - b.startTime);
      if (trackClips.length === 0) return;
      const clip = trackClips.length > 1
        ? trackClips[trackClips.length - 1]
        : trackClips[0];
      const layer = this.buildLayerForClip(clip, layerIndex, ctx);
      if (layer) {
        layers.push(layer);
      }
    });

    return layers;
  }

  private getActiveTransitionForTrack(ctx: FrameContext, trackId: string): ActiveTransitionPlan | null {
    return findActiveTransitionPlanForTrack({
      clips: ctx.clips,
      trackId,
      time: ctx.playheadPosition,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      getMediaDuration: (mediaFileId) => ctx.mediaFileById.get(mediaFileId)?.duration,
    });
  }

  /**
   * Build a layer for a clip based on its type
   * @param opacityOverride - Optional opacity override for transitions (0-1)
   */
  private buildLayerForClip(clip: TimelineClip, layerIndex: number, ctx: FrameContext, opacityOverride?: number): Layer | null {
    let layer: Layer | null = null;

    // Nested composition
    if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
      layer = buildLayerBuilderNestedCompLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        proxyFrames: this.proxyFrames,
        opacityOverride,
      });
    }
    // Native decoder (ProRes/DNxHD turbo mode)
    else if (getNativeDecoderForTimelineClip(clip)) {
      layer = buildLayerBuilderNativeDecoderLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        opacityOverride,
        nativeDecoder: getNativeDecoderForTimelineClip(clip)!,
      });
    }
    // Video clip
    else if (this.hasRenderableVideoSource(clip.source, clip, ctx)) {
      layer = buildLayerBuilderVideoLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        opacityOverride,
        proxyFrames: this.proxyFrames,
        previewContinuationResolver: this.videoSyncManager,
      });
    }
    // Image clip
    else if (clip.source?.type === 'image') {
      const imageElement = getLayerBuilderRenderableImageElement(clip, ctx);
      if (imageElement) {
        layer = withLayerBuilderMaskProperties(buildLayerBuilderImageLayer({
          clip,
          layerIndex,
          ctx,
          transformCache: this.transformCache,
          imageElement,
          opacityOverride,
        }), clip);
      }
    }
    // Canvas-backed clip sources: vector animation, math scene, generated text.
    else if ((layer = buildLayerBuilderCanvasBackedLayer({
      clip,
      layerIndex,
      ctx,
      transformCache: this.transformCache,
      opacityOverride,
    }))) {
      layer = withLayerBuilderMaskProperties(layer, clip);
    }
    // Motion shape clip
    else if (clip.source?.type === 'motion-shape') {
      layer = buildLayerBuilderMotionShapeLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        opacityOverride,
      });
    }
    // Motion null and adjustment clips are timeline/controller data for now.
    else if (clip.source?.type === 'motion-null' || clip.source?.type === 'motion-adjustment') {
      layer = null;
    }
    // Camera clip (non-rendering scene controller)
    else if (clip.source?.type === 'camera') {
      layer = null;
    }
    // Splat effector clip (non-rendering scene controller for shared-scene splats)
    else if (clip.source?.type === 'splat-effector') {
      layer = null;
    }
    // 3D Model clip
    else if (clip.source?.type === 'model') {
      layer = buildLayerBuilderModelLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        opacityOverride,
      });
    }
    // Gaussian Splat clip (native WebGPU path)
    else if (clip.source?.type === 'gaussian-splat') {
      layer = buildLayerBuilderGaussianSplatLayer({
        clip,
        layerIndex,
        ctx,
        transformCache: this.transformCache,
        opacityOverride,
      });
    }

    if (layer?.source) {
      layer = applyLayerBuilderAINodesToLayer(clip, layer, ctx);
    }

    // Pass through 3D flag from clip to layer
    if (layer && clip.is3D) {
      layer.is3D = true;
    }

    return layer;
  }

  getVideoSyncManager(): VideoSyncManager {
    return this.videoSyncManager;
  }

  // ==================== VIDEO & AUDIO SYNC (delegated) ====================

  /**
   * Sync video elements to current playhead
   */
  syncVideoElements(): void {
    const ctx = createFrameContext();
    if (this.getActiveCompositionVideoBakeRegion(ctx)) {
      this.pausePrimaryCompositionVideoSources(ctx);
      layerPlaybackManager.syncVideoElements(ctx.playheadPosition, ctx.isPlaying);
      return;
    }

    this.videoSyncManager.syncVideoElements();
  }

  /**
   * Sync audio elements to current playhead
   */
  syncAudioElements(): void {
    this.audioTrackSyncManager.syncAudioElements();
  }
}
