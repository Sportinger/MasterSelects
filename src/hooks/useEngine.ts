// React hook for WebGPU engine integration - Optimized

import { useEffect, useRef, useCallback } from 'react';
import { useEngineStore } from '../stores/engineStore';
import { useTimelineStore } from '../stores/timeline';
import { applyClipDragPreview } from '../stores/timeline/clipDragPreview';
import { useMediaStore } from '../stores/mediaStore';
import { getPlayheadPosition, layerBuilder } from '../services/layerBuilder';
import { layerPlaybackManager } from '../services/layerPlaybackManager';
import { renderScheduler } from '../services/renderScheduler';
import { framePhaseMonitor } from '../services/framePhaseMonitor';
import { Logger } from '../services/logger';
import { hasActiveTimelineVisualClip } from '../services/timeline/timelineVisualDemand';
import { renderHostPort } from '../services/render/renderHostPort';
import {
  hasActiveContinuousRenderClip,
  hasContinuousRenderLayers,
} from './engine/engineTimelineDerivations';
import { useEngineMaskTextureSync } from './engine/useEngineMaskTextureSync';
import { useEngineRenderWakeSubscriptions } from './engine/useEngineRenderWakeSubscriptions';
import { useEngineResolutionSync } from './engine/useEngineResolutionSync';
import { useEngineTimelineStateSync } from './engine/useEngineTimelineStateSync';

const log = Logger.create('Engine');

function getVisualTargetFps(): number {
  const mediaState = useMediaStore.getState();
  const activeComposition = mediaState.activeCompositionId
    ? mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId)
    : null;
  const frameRate = activeComposition?.frameRate;
  return typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
    ? Math.max(1, Math.min(60, Math.round(frameRate)))
    : 60;
}

export function useEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isEngineReady = useEngineStore((state) => state.isEngineReady);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const initRef = useRef(false);

  // Initialize engine - only once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      await renderHostPort.initialize();
    }

    init();

    return () => {
      // Don't destroy on unmount - singleton should persist
    };
  }, []);

  // Set up canvas
  useEffect(() => {
    if (isEngineReady && canvasRef.current) {
      renderHostPort.setPreviewCanvas(canvasRef.current);
    }
  }, [isEngineReady]);

  useEngineResolutionSync(isEngineReady);

  const updateMaskTextures = useEngineMaskTextureSync(isEngineReady);

  useEngineTimelineStateSync(isEngineReady, isPlaying);

  // Render loop - optimized with direct layer building (bypasses React state)
  useEffect(() => {
    if (!isEngineReady) return;

    let lastPlayhead = -1;
    let lastNoDemandFrameWasCleared = false;

    const renderFrame = () => {
      const frameStart = performance.now();
      let buildMs = 0;
      let renderMs = 0;
      let syncVideoMs = 0;
      let syncAudioMs = 0;
      let cacheMs = 0;

      const recordFramePhases = (mode: 'live' | 'cached' | 'skipped') => {
        framePhaseMonitor.record({
          mode,
          statsMs: 0,
          buildMs,
          renderMs,
          syncVideoMs,
          syncAudioMs,
          cacheMs,
          totalMs: performance.now() - frameStart,
        });
      };

      try {

        const timelineState = useTimelineStore.getState();
        // Use the wall-clock interpolated playback position instead of the
        // last committed internal value, so preview rendering stays current
        // through occasional rAF/store update gaps.
        const currentPlayhead = getPlayheadPosition(timelineState.playheadPosition);
        const hasClipDragPreview = timelineState.clipDragPreview != null;
        const isInteractiveScrub = timelineState.isDraggingPlayhead || hasClipDragPreview;
        const hasPlaybackWarmup = timelineState.playbackWarmup !== null;
        const timelineClips = hasClipDragPreview
          ? applyClipDragPreview(timelineState.clips, timelineState.clipDragPreview)
          : timelineState.clips;
        const hasActiveTemporalClip = hasActiveContinuousRenderClip(
          timelineClips,
          timelineState.tracks,
          currentPlayhead
        );
        const hasActiveVisualClip = hasActiveTimelineVisualClip(
          timelineClips,
          timelineState.tracks,
          currentPlayhead
        );
        const hasActiveBackgroundLayer = layerPlaybackManager.hasActiveLayers();
        const hasVisualRenderDemand =
          hasActiveVisualClip ||
          hasActiveTemporalClip ||
          hasActiveBackgroundLayer;
        renderHostPort.setVisualTargetFps(getVisualTargetFps());
        renderHostPort.setTimelineVisualDemand(hasVisualRenderDemand);
        renderHostPort.setIsScrubbing(isInteractiveScrub);
        renderHostPort.setContinuousRender(hasActiveTemporalClip || hasPlaybackWarmup);

        // Track playhead changes for idle detection
        // During playback, playhead constantly changes -> keeps engine active
        // When stopped/scrubbing, only renders when playhead actually moves
        if (currentPlayhead !== lastPlayhead) {
          lastPlayhead = currentPlayhead;
          if (hasVisualRenderDemand && (!timelineState.isPlaying || isInteractiveScrub)) {
            renderHostPort.requestRender();
          }
        }

        const hasMaskKeyframes = Array.from(timelineState.clipKeyframes.values())
          .some(keyframes => keyframes.some(keyframe => keyframe.property.startsWith('mask.')));
        if (hasMaskKeyframes) {
          updateMaskTextures(false, currentPlayhead);
        }

        // Keep engine awake when background layers are playing (independent of global playhead)
        if (hasActiveBackgroundLayer) {
          renderHostPort.requestRender();
        }

        if (!hasVisualRenderDemand) {
          if (!lastNoDemandFrameWasCleared) {
            renderScheduler.setActiveCompLayers([]);
            const renderStart = performance.now();
            renderHostPort.render([]);
            renderMs += performance.now() - renderStart;
            lastNoDemandFrameWasCleared = true;
          }
          if (!timelineState.isPlaying) {
            const syncAudioStart = performance.now();
            layerBuilder.syncAudioElements();
            syncAudioMs += performance.now() - syncAudioStart;
          }
          recordFramePhases('skipped');
          return;
        }
        lastNoDemandFrameWasCleared = false;

        // Try cached RAM Preview frame first (instant scrubbing over pre-rendered frames).
        // Wall-clock driven effects must render live even when the playhead is parked.
        if (!hasClipDragPreview && !hasActiveTemporalClip && renderHostPort.renderCachedFrame(currentPlayhead)) {
          const syncAudioStart = performance.now();
          layerBuilder.syncAudioElements();
          syncAudioMs += performance.now() - syncAudioStart;
          recordFramePhases('cached');
          return;
        }

        // Skip live rendering during RAM Preview generation
        if (useTimelineStore.getState().isRamPreviewing) {
          recordFramePhases('skipped');
          return;
        }

        // Build layers directly from stores (single source of truth)
        const syncVideoStart = performance.now();
        layerBuilder.syncVideoElements();
        syncVideoMs += performance.now() - syncVideoStart;

        // Share pre-built layers with renderScheduler so multi-preview
        // can reuse them instead of re-evaluating and re-seeking videos
        const buildStart = performance.now();
        const layers = layerBuilder.buildLayersFromStore();
        buildMs += performance.now() - buildStart;
        const needsContinuousRender =
          hasPlaybackWarmup ||
          hasActiveTemporalClip ||
          hasContinuousRenderLayers(layers);
        renderHostPort.setContinuousRender(needsContinuousRender);

        // During playback: sync video elements FIRST so advanceToTime() prepares the
        // correct VideoFrame before rendering. This eliminates the systematic 1-frame lag
        // where we'd render before the frame was ready.
        // During scrubbing (not playing): render FIRST for page-reload robustness.
        // After a page reload the scrubbing cache is empty and the video is at its
        // previous position (not yet seeking), so importExternalTexture succeeds and
        // populates the cache. The 'seeked' event then triggers a re-render with the
        // correct frame.
        // Always sync video BEFORE render — ensures the current frame is
        // at the right position before we import textures and composite.
        // Previously, scrubbing rendered first (stale frame) then seeked after,
        // causing 1-frame-late display. The RVFC re-render handles page-reload
        // robustness (GPU surface cold → warmup play/pause → RVFC triggers render).
        renderScheduler.setActiveCompLayers(layers);

        const renderStart = performance.now();
        renderHostPort.render(layers);
        renderMs += performance.now() - renderStart;

        // Audio sync after render (video and audio now see same playhead)
        const syncAudioStart = performance.now();
        layerBuilder.syncAudioElements();
        syncAudioMs += performance.now() - syncAudioStart;

        // Cache rendered frame for instant scrubbing (like Premiere's playback caching)
        // Don't cache during active playback - GPU readback (mapAsync GPUMapMode.READ)
        // is a GPU→CPU sync point that stalls the main thread for 50-275ms on Windows
        // D3D12, causing severe frame drops. Only cache when NOT playing (e.g., manual
        // scrubbing or dedicated RAM preview generation pass via isRamPreviewing).
        const cacheStart = performance.now();
        const { ramPreviewEnabled, addCachedFrame } = useTimelineStore.getState();
        if (ramPreviewEnabled && !timelineState.isPlaying && !isInteractiveScrub && !needsContinuousRender) {
          renderHostPort.cacheCompositeFrame(currentPlayhead).then(() => {
            addCachedFrame(currentPlayhead);
          });
        }

        // Cache active comp output for parent preview texture sharing
        // This allows parent compositions to show the active comp without video conflicts
        const activeCompId = useMediaStore.getState().activeCompositionId;
        if (activeCompId && !timelineState.isPlaying && !isInteractiveScrub && !needsContinuousRender) {
          renderHostPort.cacheActiveCompOutput(activeCompId);
        }
        cacheMs += performance.now() - cacheStart;
        recordFramePhases('live');
      } catch (e) {
        recordFramePhases('skipped');
        log.error('Render error', e);
      }
    };

    // The WebGPU engine is a singleton. Preview panels mount/unmount during dock
    // layout changes, so stopping the render loop from this hook can black out a
    // newly mounted preview while playback keeps running.
    const stopStatsAndWatchdog = renderHostPort.startStatsAndWatchdog(renderFrame);
    renderHostPort.startRenderLoop(renderFrame);

    return () => {
      stopStatsAndWatchdog();
    };
  }, [isEngineReady, updateMaskTextures]);

  useEngineRenderWakeSubscriptions(isEngineReady);

  const createOutputWindow = useCallback((name: string) => {
    const id = `output_${Date.now()}`;
    return renderHostPort.createOutputWindow(id, name);
  }, []);

  const closeOutputWindow = useCallback((id: string) => {
    renderHostPort.closeOutputWindow(id);
  }, []);

  const restoreOutputWindow = useCallback((id: string) => {
    return renderHostPort.restoreOutputWindow(id);
  }, []);

  const removeOutputTarget = useCallback((id: string) => {
    renderHostPort.removeOutputTarget(id);
  }, []);

  return {
    canvasRef,
    isEngineReady,
    isPlaying,
    createOutputWindow,
    closeOutputWindow,
    restoreOutputWindow,
    removeOutputTarget,
  };
}
