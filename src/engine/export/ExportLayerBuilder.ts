// Layer building for export rendering

import { Logger } from '../../services/logger';
import type { Layer, NestedCompositionData } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import type { ExportClipState, FrameContext } from './types';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import {
  buildGaussianSplatSource,
  buildModelSource,
  buildMotionSource,
  getCompositionSize,
  getExportImageElement,
  getExportVideoElement,
} from './layerBuilder/sourceLookup';
import { getClipSourceWindowTime } from './layerBuilder/timing';
import { buildBaseLayerProps } from './layerBuilder/baseLayers';
import {
  buildNestedLayersForExport,
  buildTransitionCompositionLayerForExport,
} from './layerBuilder/nestedLayers';
import { buildTextLikeLayer, isTextLikeClipSource } from './layerBuilder/textLayers';
import { buildVideoLayer } from './layerBuilder/videoLayers';

const log = Logger.create('ExportLayerBuilder');

// Cache video tracks and solo state at export start (don't change during export)
let cachedVideoTracks: TimelineTrack[] | null = null;
let cachedAnyVideoSolo = false;

export function initializeLayerBuilder(tracks: TimelineTrack[]): void {
  cachedVideoTracks = tracks.filter(t => t.type === 'video');
  cachedAnyVideoSolo = cachedVideoTracks.some(t => t.solo);
}

export function cleanupLayerBuilder(): void {
  cachedVideoTracks = null;
  cachedAnyVideoSolo = false;
}

function withOpacityOverride<T extends { opacity: number }>(baseLayerProps: T, opacityOverride?: number): T {
  if (opacityOverride === undefined) return baseLayerProps;
  return {
    ...baseLayerProps,
    opacity: baseLayerProps.opacity * opacityOverride,
  };
}

function buildExportLayerForClip(
  clip: TimelineClip,
  trackIndex: number,
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  opacityOverride?: number,
): Layer | null {
  const { time } = ctx;
  const clipLocalTime = time - clip.startTime;
  const baseLayerProps = withOpacityOverride(
    buildBaseLayerProps(
      clip,
      clipLocalTime,
      trackIndex,
      ctx,
    ),
    opacityOverride,
  );

  // Handle nested compositions
  if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
    const nestedLayers = buildNestedLayersForExport(
      clip,
      clipLocalTime + (clip.inPoint || 0),
      time,
      clipStates,
      parallelDecoder,
      useParallelDecode
    );

    if (nestedLayers.length > 0) {
      const { width: compWidth, height: compHeight } = getCompositionSize(clip.compositionId);

      const nestedCompData: NestedCompositionData = {
        compositionId: clip.compositionId || clip.id,
        layers: nestedLayers,
        width: compWidth,
        height: compHeight,
        currentTime: clipLocalTime + (clip.inPoint || 0),
        sceneClips: clip.nestedClips,
        sceneTracks: clip.nestedTracks,
      };

      return {
        ...baseLayerProps,
        source: {
          type: 'image',
          nestedComposition: nestedCompData,
        },
      };
    }
    return null;
  }

  // Handle video clips
  if (clip.source?.type === 'video' && getExportVideoElement(clip, clipStates)) {
    const sourceMediaTime = getClipSourceWindowTime(clip, clipLocalTime, ctx);
    return buildVideoLayer(
      clip,
      baseLayerProps,
      time,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      sourceMediaTime,
    );
  }
  // Handle image clips
  if (clip.source?.type === 'image') {
    const imageElement = getExportImageElement(clip, clipStates);
    if (imageElement) {
      return {
        ...baseLayerProps,
        source: { type: 'image', imageElement },
      };
    }
    return null;
  }
  // Handle motion shape clips
  if (clip.source?.type === 'motion-shape') {
    const source = buildMotionSource(clip, clipLocalTime);
    if (source) {
      return {
        ...baseLayerProps,
        source,
      };
    }
    return null;
  }
  // Handle 3D model clips
  if (clip.source?.type === 'model') {
    const modelSourceTime = getClipSourceWindowTime(clip, clipLocalTime, ctx);
    return {
      ...baseLayerProps,
      source: buildModelSource(clip, modelSourceTime),
      is3D: true,
    };
  }
  // Handle Gaussian Splat clips (native WebGPU)
  if (clip.source?.type === 'gaussian-splat') {
    return {
      ...baseLayerProps,
      source: buildGaussianSplatSource(clip, clipLocalTime),
      is3D: true,
    };
  }
  // Handle text, solid, vector animation, and Math Scene clips
  if (isTextLikeClipSource(clip)) {
    return buildTextLikeLayer(
      clip,
      clipLocalTime,
      time,
      baseLayerProps,
      { ctx, interpolateTextBounds: true },
    );
  }

  return null;
}

/**
 * Build layers for rendering at a specific time.
 * Uses FrameContext for O(1) lookups - no getState() calls per frame.
 */
export function buildLayersAtTime(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean
): Layer[] {
  const { clipsByTrack, transitionParticipantsByTrack } = ctx;
  const layers: Layer[] = [];

  if (!cachedVideoTracks) {
    log.error('Not initialized - call initializeLayerBuilder first');
    return [];
  }

  const isTrackVisible = (track: TimelineTrack) => {
    if (!track.visible) return false;
    if (cachedAnyVideoSolo) return track.solo;
    return true;
  };

  // Build layers in track order (bottom to top)
  for (let trackIndex = 0; trackIndex < cachedVideoTracks.length; trackIndex++) {
    const track = cachedVideoTracks[trackIndex];
    if (!isTrackVisible(track)) continue;

    const activeTransition = transitionParticipantsByTrack?.get(track.id);
    if (activeTransition) {
      const transitionCompLayer = buildTransitionCompositionLayerForExport({
        activeTransition,
        layerIndex: trackIndex,
        parentCompositionId: 'export',
        parentTime: ctx.time,
        layerIdPrefix: 'export',
        clipStates,
        parallelDecoder,
        useParallelDecode,
      });
      if (transitionCompLayer) {
        layers.push(transitionCompLayer);
      }
      continue;
    }

    // O(1) lookup instead of O(n) find
    const clip = clipsByTrack.get(track.id);
    if (!clip) continue;

    const layer = buildExportLayerForClip(
      clip,
      trackIndex,
      ctx,
      clipStates,
      parallelDecoder,
      useParallelDecode,
    );
    if (layer) layers.push(layer);
  }

  return layers;
}
