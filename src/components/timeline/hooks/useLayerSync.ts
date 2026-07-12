// useLayerSync - Syncs timeline clips to mixer layers for rendering
import { useEffect, useRef, useCallback } from 'react';
import type { TimelineClip, TimelineTrack, Layer, Effect, NestedCompositionData, Keyframe, ClipTransform } from '../../../types';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import type { ClipDragState } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { ensureMidiPlaybackScheduler } from '../../../services/audio/midiPlaybackScheduler';
import { getEffectiveScale } from '../../../utils/transformScale';
import { vectorAnimationRuntimeManager } from '../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import {
  getLazyImageElementForClip,
  type LazyImageLookupContext,
} from '../../../services/timeline/lazyImageElements';
import { getNativeDecoderForTimelineClip } from '../../../services/timeline/nativeDecoderRuntimeRegistry';
import { syncLayerAudioPlayback } from '../utils/layerSyncAudioPlayback';
import { buildLayerSyncNestedLayers } from '../utils/layerSyncNestedLayers';
import {
  syncLayerProxyFrame,
  type LayerSyncProxyFrameCacheEntry,
} from '../utils/layerSyncProxyFrames';

function isLayerScaleChanged(layerScale: Layer['scale'] | undefined, transformScale: ClipTransform['scale']): boolean {
  const renderScale = getEffectiveScale(transformScale);
  return (
    !layerScale ||
    layerScale.x !== renderScale.x ||
    layerScale.y !== renderScale.y ||
    layerScale.z !== renderScale.z
  );
}

function createLayerSyncImageLookupContext(
  onImageStatusChange: (clipId: string) => void
): LazyImageLookupContext {
  const mediaFiles = useMediaStore.getState().files;
  const mediaFileById = new Map(mediaFiles.map((file) => [file.id, file]));
  const mediaFileByName = new Map(
    mediaFiles
      .filter((file) => file.name)
      .map((file) => [file.name, file])
  );

  return {
    now: performance.now(),
    mediaFileById,
    mediaFileByName,
    onImageStatusChange,
  };
}

interface UseLayerSyncProps {
  // Refs
  // State
  playheadPosition: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  isPlaying: boolean;
  isDraggingPlayhead: boolean;
  ramPreviewRange: { start: number; end: number } | null;
  isRamPreviewing: boolean;
  clipKeyframes: Map<string, Keyframe[]>;
  clipDrag: ClipDragState | null;

  // Derived state
  clipMap: Map<string, TimelineClip>;
  videoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];

  // Helper functions
  getClipsAtTime: (time: number) => TimelineClip[];
  getInterpolatedTransform: (clipId: string, localTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, localTime: number) => Effect[];
  getInterpolatedVectorAnimationSettings: (clipId: string, localTime: number) => VectorAnimationClipSettings;
  getInterpolatedSpeed: (clipId: string, localTime: number) => number;
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  isVideoTrackVisible: (track: TimelineTrack) => boolean;
  isAudioTrackMuted: (track: TimelineTrack) => boolean;
}

export function useLayerSync({
  playheadPosition,
  clips,
  tracks,
  isPlaying,
  isDraggingPlayhead,
  ramPreviewRange,
  isRamPreviewing,
  clipKeyframes,
  clipDrag,
  clipMap,
  videoTracks,
  audioTracks,
  getClipsAtTime,
  getInterpolatedTransform,
  getInterpolatedEffects,
  getInterpolatedVectorAnimationSettings,
  getInterpolatedSpeed,
  getSourceTimeForClip,
  isVideoTrackVisible,
  isAudioTrackMuted,
}: UseLayerSyncProps): void {
  // Native decoder throttling (unused - sync handled by LayerBuilderService)
  // Kept for potential future use

  // Track current proxy frames for each clip (for smooth proxy playback)
  const proxyFramesRef = useRef<
    Map<string, LayerSyncProxyFrameCacheEntry>
  >(new Map());
  const proxyLoadingRef = useRef<Set<string>>(new Set());

  // RAF debounce: batch rapid scrubbing into one sync per animation frame
  const pendingRafRef = useRef<number | null>(null);

  // NOTE: Video element sync (play/pause/currentTime) has been removed from useLayerSync.
  // All video sync is now handled exclusively by LayerBuilderService via the render loop
  // to avoid dual-sync race conditions that caused frame flickering.

  // Helper: Check if effects have changed
  const effectsChanged = useCallback(
    (layerEffects: Effect[] | undefined, clipEffects: Effect[] | undefined): boolean => {
      const le = layerEffects || [];
      const ce = clipEffects || [];
      if (le.length !== ce.length) return true;
      for (let i = 0; i < le.length; i++) {
        if (le[i].id !== ce[i].id || le[i].enabled !== ce[i].enabled) return true;
        const lp = le[i].params;
        const cp = ce[i].params;
        const lKeys = Object.keys(lp);
        const cKeys = Object.keys(cp);
        if (lKeys.length !== cKeys.length) return true;
        for (const key of lKeys) {
          if (lp[key] !== cp[key]) return true;
        }
      }
      return false;
    },
    []
  );

  // Cleanup pending RAF on unmount
  useEffect(() => {
    return () => {
      if (pendingRafRef.current !== null) {
        cancelAnimationFrame(pendingRafRef.current);
        pendingRafRef.current = null;
      }
    };
  }, []);

  // Ensure the internal MIDI synth scheduler is running (issue #182, Phase 4).
  // It subscribes to transport state globally; this just guarantees one-time init.
  useEffect(() => {
    ensureMidiPlaybackScheduler();
  }, []);

  // Main layer sync effect
  // PERFORMANCE: During playback, layerBuilder handles all sync in the RAF loop
  // This effect only runs when paused (for scrubbing, editing, etc.)
  // RAF-debounced: rapid scrubbing batches into max 1 sync per animation frame
  useEffect(() => {
    // Cancel any pending RAF sync from previous render
    if (pendingRafRef.current !== null) {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = null;
    }

    // Skip all work during playback - layerBuilder handles video/audio sync in RAF
    if (isPlaying) {
      return;
    }

    if (isRamPreviewing) {
      return;
    }

    // Clip dragging already publishes a lightweight preview for the direct
    // engine render path. Running the legacy layer/audio sync on every mouse
    // move adds allocations and store churn without changing layers.
    if (clipDrag) {
      return;
    }

    // Try to use RAM Preview cache for instant scrubbing
    // This provides instant access to pre-rendered frames
    if (ramPreviewRange) {
      const inRange = playheadPosition >= ramPreviewRange.start && playheadPosition <= ramPreviewRange.end;
      if (inRange) {
        const hit = renderHostPort.renderCachedFrame(playheadPosition);
        if (hit) {
          return; // Cache hit - instant render, no video seek needed
        }
        // Cache miss within range - will fall through to regular render
      }
    } else {
      // No RAM preview range, but still try the cache in case frames were cached during playback
      const hit = renderHostPort.renderCachedFrame(playheadPosition);
      if (hit) {
        return;
      }
    }

    // Debounce heavy layer sync via requestAnimationFrame.
    // During rapid scrubbing, multiple playheadPosition changes within a single frame
    // are batched — only the last scheduled sync actually executes.
    let runLayerSync: FrameRequestCallback = () => undefined;
    const scheduleLayerSync = () => {
      if (pendingRafRef.current !== null) {
        return;
      }

      pendingRafRef.current = requestAnimationFrame(runLayerSync);
    };

    runLayerSync = () => {
    pendingRafRef.current = null;
    const imageLookupContext = createLayerSyncImageLookupContext(scheduleLayerSync);

    const clipsAtTime = getClipsAtTime(playheadPosition);

    const currentLayers = useTimelineStore.getState().layers;
    const newLayers = [...currentLayers];
    let layersChanged = false;

    videoTracks.forEach((track, layerIndex) => {
      const clip = clipsAtTime.find((c) => c.trackId === track.id);
      const layer = currentLayers[layerIndex];

      if (clip?.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
        const clipLocalTime = playheadPosition - clip.startTime;
        const clipTime = clipLocalTime + clip.inPoint;

        // Build all nested layers for pre-rendering
        const nestedLayers = buildLayerSyncNestedLayers({
          clip,
          clipKeyframes,
          clipTime,
          getInterpolatedVectorAnimationSettings,
          imageLookupContext,
        });

        // Get parent clip transform
        const interpolatedTransform = getInterpolatedTransform(clip.id, clipTime);
        const interpolatedEffects = getInterpolatedEffects(clip.id, clipLocalTime);

        // Get composition dimensions from mediaStore
        const mediaStore = useMediaStore.getState();
        const composition = mediaStore.compositions.find(c => c.id === clip.compositionId);
        const compWidth = composition?.width || 1920;
        const compHeight = composition?.height || 1080;

        if (nestedLayers.length > 0) {
          const trackVisible = isVideoTrackVisible(track);

          // Build nestedComposition data for pre-rendering
          const nestedCompData: NestedCompositionData = {
            compositionId: clip.compositionId || clip.id,
            layers: nestedLayers,
            width: compWidth,
            height: compHeight,
          };

          // Always update nested composition layers (they change with time)
          newLayers[layerIndex] = {
            id: `timeline_layer_${layerIndex}`,
            name: clip.name,
            sourceClipId: clip.id,
            visible: trackVisible,
            opacity: interpolatedTransform.opacity,
            blendMode: interpolatedTransform.blendMode,
            source: {
              type: 'image', // Nested comps are pre-rendered to texture
              nestedComposition: nestedCompData,
            },
            effects: interpolatedEffects,
            position: { x: interpolatedTransform.position.x, y: interpolatedTransform.position.y, z: interpolatedTransform.position.z },
            scale: getEffectiveScale(interpolatedTransform.scale),
            rotation: {
              x: (interpolatedTransform.rotation.x * Math.PI) / 180,
              y: (interpolatedTransform.rotation.y * Math.PI) / 180,
              z: (interpolatedTransform.rotation.z * Math.PI) / 180,
            },
          };
          layersChanged = true;
        } else {
          if (layer?.source) {
            newLayers[layerIndex] = undefined as unknown as (typeof newLayers)[0];
            layersChanged = true;
          }
        }
      } else if (clip && getNativeDecoderForTimelineClip(clip)) {
        // Native Helper decoder for ProRes/DNxHD (turbo mode)
        const nativeDecoder = getNativeDecoderForTimelineClip(clip)!;
        const clipLocalTime = playheadPosition - clip.startTime;
        const keyframeLocalTime = clipLocalTime;

        // Native decoder seeking handled by LayerBuilderService

        const transform = getInterpolatedTransform(clip.id, keyframeLocalTime);
        const nativeInterpolatedEffects = getInterpolatedEffects(clip.id, keyframeLocalTime);
        const trackVisible = isVideoTrackVisible(track);

        const needsUpdate =
          !layer ||
          layer.visible !== trackVisible ||
          layer.source?.nativeDecoder !== nativeDecoder ||
          layer.opacity !== transform.opacity ||
          layer.blendMode !== transform.blendMode ||
          layer.position.x !== transform.position.x ||
          layer.position.y !== transform.position.y ||
          layer.position.z !== transform.position.z ||
          isLayerScaleChanged(layer.scale, transform.scale) ||
          (layer.rotation as { z?: number })?.z !== (transform.rotation.z * Math.PI) / 180 ||
          (layer.rotation as { x?: number })?.x !== (transform.rotation.x * Math.PI) / 180 ||
          (layer.rotation as { y?: number })?.y !== (transform.rotation.y * Math.PI) / 180 ||
          effectsChanged(layer.effects, nativeInterpolatedEffects);

        if (needsUpdate) {
          newLayers[layerIndex] = {
            id: `timeline_layer_${layerIndex}`,
            name: clip.name,
            sourceClipId: clip.id,
            visible: trackVisible,
            opacity: transform.opacity,
            blendMode: transform.blendMode,
            source: {
              type: 'video',
              nativeDecoder: nativeDecoder,
            },
            effects: nativeInterpolatedEffects,
            position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            scale: getEffectiveScale(transform.scale),
            rotation: {
              x: (transform.rotation.x * Math.PI) / 180,
              y: (transform.rotation.y * Math.PI) / 180,
              z: (transform.rotation.z * Math.PI) / 180,
            },
          };
          layersChanged = true;
        }
      } else if (clip?.source?.videoElement) {
        const clipLocalTime = playheadPosition - clip.startTime;
        // Keyframe interpolation uses timeline-local time
        const keyframeLocalTime = clipLocalTime;
        const video = clip.source.videoElement;
        const webCodecsPlayer = clip.source.webCodecsPlayer;
        const proxyFrameResult = syncLayerProxyFrame({
          clip,
          effectsChanged,
          getInterpolatedEffects,
          getInterpolatedSpeed,
          getInterpolatedTransform,
          getSourceTimeForClip,
          isDraggingPlayhead,
          isVideoTrackVisible,
          layer,
          layerIndex,
          newLayers,
          playheadPosition,
          proxyFrames: proxyFramesRef.current,
          proxyLoading: proxyLoadingRef.current,
          track,
        });

        if (proxyFrameResult.handled) {
          layersChanged = layersChanged || proxyFrameResult.layersChanged;
        } else {
          // Video element sync (play/pause/seek/WebCodecs) handled by LayerBuilderService

          const transform = getInterpolatedTransform(clip.id, keyframeLocalTime);
          const videoInterpolatedEffects = getInterpolatedEffects(
            clip.id,
            keyframeLocalTime
          );
          const trackVisible = isVideoTrackVisible(track);
          const needsUpdate =
            !layer ||
            layer.visible !== trackVisible ||
            layer.source?.videoElement !== video ||
            layer.source?.webCodecsPlayer !== webCodecsPlayer ||
            layer.opacity !== transform.opacity ||
            layer.blendMode !== transform.blendMode ||
            layer.position.x !== transform.position.x ||
            layer.position.y !== transform.position.y ||
            layer.position.z !== transform.position.z ||
            isLayerScaleChanged(layer.scale, transform.scale) ||
            (layer.rotation as { z?: number })?.z !==
              (transform.rotation.z * Math.PI) / 180 ||
            (layer.rotation as { x?: number })?.x !==
              (transform.rotation.x * Math.PI) / 180 ||
            (layer.rotation as { y?: number })?.y !==
              (transform.rotation.y * Math.PI) / 180 ||
            effectsChanged(layer.effects, videoInterpolatedEffects);

          if (needsUpdate) {
            newLayers[layerIndex] = {
              id: `timeline_layer_${layerIndex}`,
              name: clip.name,
              sourceClipId: clip.id,
              visible: trackVisible,
              opacity: transform.opacity,
              blendMode: transform.blendMode,
              source: {
                type: 'video',
                videoElement: video,
                webCodecsPlayer: webCodecsPlayer,
              },
              effects: videoInterpolatedEffects,
              position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
              scale: getEffectiveScale(transform.scale),
              rotation: {
                x: (transform.rotation.x * Math.PI) / 180,
                y: (transform.rotation.y * Math.PI) / 180,
                z: (transform.rotation.z * Math.PI) / 180,
              },
            };
            layersChanged = true;
          }
        }
      } else if (clip?.source?.type === 'image') {
        const img = getLazyImageElementForClip(imageLookupContext, clip);
        if (!img) {
          if (layer?.source && layer.sourceClipId !== clip.id) {
            newLayers[layerIndex] = undefined as unknown as (typeof newLayers)[0];
            layersChanged = true;
          }
          return;
        }

        const imageClipLocalTime = playheadPosition - clip.startTime;
        const transform = getInterpolatedTransform(clip.id, imageClipLocalTime);
        const imageInterpolatedEffects = getInterpolatedEffects(
          clip.id,
          imageClipLocalTime
        );
        const trackVisible = isVideoTrackVisible(track);
        const needsUpdate =
          !layer ||
          layer.visible !== trackVisible ||
          layer.source?.imageElement !== img ||
          layer.opacity !== transform.opacity ||
          layer.blendMode !== transform.blendMode ||
          layer.position.x !== transform.position.x ||
          layer.position.y !== transform.position.y ||
          layer.position.z !== transform.position.z ||
          isLayerScaleChanged(layer.scale, transform.scale) ||
          (layer.rotation as { z?: number })?.z !==
            (transform.rotation.z * Math.PI) / 180 ||
          (layer.rotation as { x?: number })?.x !==
            (transform.rotation.x * Math.PI) / 180 ||
          (layer.rotation as { y?: number })?.y !==
            (transform.rotation.y * Math.PI) / 180 ||
          effectsChanged(layer.effects, imageInterpolatedEffects);

        if (needsUpdate) {
          newLayers[layerIndex] = {
            id: `timeline_layer_${layerIndex}`,
            name: clip.name,
            sourceClipId: clip.id,
            visible: trackVisible,
            opacity: transform.opacity,
            blendMode: transform.blendMode,
            source: {
              type: 'image',
              imageElement: img,
            },
            effects: imageInterpolatedEffects,
            position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            scale: getEffectiveScale(transform.scale),
            rotation: {
              x: (transform.rotation.x * Math.PI) / 180,
              y: (transform.rotation.y * Math.PI) / 180,
              z: (transform.rotation.z * Math.PI) / 180,
            },
          };
          layersChanged = true;
        }
      } else if (clip?.source?.textCanvas) {
        const textClipLocalTime = playheadPosition - clip.startTime;
        if (isVectorAnimationSourceType(clip.source.type)) {
          vectorAnimationRuntimeManager.renderClipAtTime(
            clip,
            playheadPosition,
            getInterpolatedVectorAnimationSettings(clip.id, textClipLocalTime),
          );
        }

        // Text/Solid/Lottie clip handling (all use canvas)
        const textCanvas = clip.source.textCanvas;
        const transform = getInterpolatedTransform(clip.id, textClipLocalTime);
        const textInterpolatedEffects = getInterpolatedEffects(
          clip.id,
          textClipLocalTime
        );
        const trackVisible = isVideoTrackVisible(track);
        const needsUpdate =
          !layer ||
          layer.visible !== trackVisible ||
          layer.source?.textCanvas !== textCanvas ||
          layer.opacity !== transform.opacity ||
          layer.blendMode !== transform.blendMode ||
          layer.position.x !== transform.position.x ||
          layer.position.y !== transform.position.y ||
          layer.position.z !== transform.position.z ||
          isLayerScaleChanged(layer.scale, transform.scale) ||
          (layer.rotation as { z?: number })?.z !==
            (transform.rotation.z * Math.PI) / 180 ||
          (layer.rotation as { x?: number })?.x !==
            (transform.rotation.x * Math.PI) / 180 ||
          (layer.rotation as { y?: number })?.y !==
            (transform.rotation.y * Math.PI) / 180 ||
          effectsChanged(layer.effects, textInterpolatedEffects);

        if (needsUpdate) {
          newLayers[layerIndex] = {
            id: `timeline_layer_${layerIndex}`,
            name: clip.name,
            sourceClipId: clip.id,
            visible: trackVisible,
            opacity: transform.opacity,
            blendMode: transform.blendMode,
            source: {
              type: clip.source!.type === 'solid' ? 'solid' : 'text',
              textCanvas: textCanvas,
            },
            effects: textInterpolatedEffects,
            position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            scale: getEffectiveScale(transform.scale),
            rotation: {
              x: (transform.rotation.x * Math.PI) / 180,
              y: (transform.rotation.y * Math.PI) / 180,
              z: (transform.rotation.z * Math.PI) / 180,
            },
          };
          layersChanged = true;
        }
      } else {
        if (layer?.source) {
          newLayers[layerIndex] = undefined as unknown as (typeof newLayers)[0];
          layersChanged = true;
        }
      }
    });

    if (layersChanged) {
      useTimelineStore.setState({ layers: newLayers });
      // Wake render loop to pick up the new layers
      // Don't render directly to avoid dual-render race conditions with the render loop
      renderHostPort.requestRender();
    }

    syncLayerAudioPlayback({
      audioTracks,
      clips,
      clipsAtTime,
      getInterpolatedSpeed,
      getSourceTimeForClip,
      isAudioTrackMuted,
      isDraggingPlayhead,
      isPlaying,
      isVideoTrackVisible,
      playheadPosition,
      videoTracks,
    });

    }; // end runLayerSync

    pendingRafRef.current = requestAnimationFrame(runLayerSync);
  }, [
    playheadPosition,
    clips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    ramPreviewRange,
    isRamPreviewing,
    clipKeyframes,
    clipDrag,
    getClipsAtTime,
    getInterpolatedTransform,
    getInterpolatedEffects,
    getInterpolatedVectorAnimationSettings,
    getInterpolatedSpeed,
    getSourceTimeForClip,
    videoTracks,
    audioTracks,
    isVideoTrackVisible,
    isAudioTrackMuted,
    effectsChanged,
    clipMap,
  ]);
}
