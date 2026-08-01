// Layer building for export rendering

import { Logger } from '../../services/logger';
import type { Layer, NestedCompositionData } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import { useMediaStore } from '../../stores/mediaStore';
import type { ExportClipState, FrameContext } from './types';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import {
  buildGaussianSplatSource,
  buildLightSource,
  buildModelSource,
  buildMotionSource,
  getCompositionSize,
  getExportImageElement,
} from './layerBuilder/sourceLookup';
import { getClipSourceWindowTime, getMappedClipSourceTime } from './layerBuilder/timing';
import { buildBaseLayerProps } from './layerBuilder/baseLayers';
import {
  buildNestedLayersForExport,
  buildTransitionCompositionLayerForExport,
} from './layerBuilder/nestedLayers';
import { buildTextLikeLayer, isTextLikeClipSource } from './layerBuilder/textLayers';
import { buildVideoLayer } from './layerBuilder/videoLayers';
import { buildMotionAdjustmentLayerFromBase } from '../../services/layerBuilder/layerBuilderMotionAdjustment';

const log = Logger.create('ExportLayerBuilder');
const IDENTITY_EPSILON = 0.000001;

type FrameContextWithMedia = FrameContext & {
  mediaFiles: NonNullable<FrameContext['mediaFiles']>;
  mediaCompositions: NonNullable<FrameContext['mediaCompositions']>;
};

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

function isIdentityNumber(value: number | undefined, identity: number): boolean {
  return Math.abs((value ?? identity) - identity) <= IDENTITY_EPSILON;
}

function isIdentityLayerRotation(rotation: Layer['rotation']): boolean {
  return typeof rotation === 'number'
    ? isIdentityNumber(rotation, 0)
    : isIdentityNumber(rotation.x, 0) &&
        isIdentityNumber(rotation.y, 0) &&
        isIdentityNumber(rotation.z, 0);
}

function tryBuildExportNestedCompositionPassthrough(input: {
  clip: TimelineClip;
  nestedLayers: Layer[];
  baseLayer: Omit<Layer, 'source'>;
  compositionWidth: number;
  compositionHeight: number;
  outputWidth?: number;
  outputHeight?: number;
  opacityOverride?: number;
}): Layer | null {
  const {
    clip,
    nestedLayers,
    baseLayer,
    compositionWidth,
    compositionHeight,
    outputWidth,
    outputHeight,
    opacityOverride,
  } = input;
  const nestedLayer = nestedLayers.length === 1 ? nestedLayers[0] : undefined;

  if (
    !nestedLayer?.source ||
    nestedLayer.source.type !== 'video' ||
    nestedLayer.source.nestedComposition ||
    nestedLayer.is3D ||
    outputWidth === undefined ||
    outputHeight === undefined ||
    compositionWidth !== outputWidth ||
    compositionHeight !== outputHeight ||
    opacityOverride !== undefined ||
    baseLayer.effects.length > 0 ||
    baseLayer.colorCorrection !== undefined ||
    clip.is3D ||
    clip.nodeGraph !== undefined ||
    baseLayer.sourceRect !== undefined ||
    baseLayer.transitionRender !== undefined ||
    baseLayer.maskClipId !== undefined ||
    !isIdentityNumber(baseLayer.opacity, 1) ||
    baseLayer.blendMode !== 'normal' ||
    !isIdentityNumber(baseLayer.position.x, 0) ||
    !isIdentityNumber(baseLayer.position.y, 0) ||
    !isIdentityNumber(baseLayer.position.z, 0) ||
    !isIdentityNumber(baseLayer.scale.x, 1) ||
    !isIdentityNumber(baseLayer.scale.y, 1) ||
    !isIdentityNumber(baseLayer.scale.z, 1) ||
    !isIdentityLayerRotation(baseLayer.rotation)
  ) {
    return null;
  }

  return {
    ...nestedLayer,
    id: baseLayer.id,
    name: baseLayer.name,
  };
}

function buildExportLayerForClip(
  clip: TimelineClip,
  trackIndex: number,
  ctx: FrameContextWithMedia,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  opacityOverride?: number,
): Layer | null {
  const { time } = ctx;
  const clipLocalTime = time - clip.startTime;
  const baseLayer = buildBaseLayerProps(
    clip,
    clipLocalTime,
    trackIndex,
    ctx,
  );
  if (!baseLayer) return null;
  const baseLayerProps = withOpacityOverride(baseLayer, opacityOverride);

  // Handle nested compositions
  if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
    const nestedTime = getMappedClipSourceTime(clip, clipLocalTime)
      ?? clipLocalTime + (clip.inPoint || 0);
    const nestedLayers = buildNestedLayersForExport(
      clip,
      nestedTime,
      time,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      ctx.mediaFiles,
      ctx.mediaCompositions
    );

    if (nestedLayers.length > 0) {
      const { width: compWidth, height: compHeight } = getCompositionSize(clip.compositionId);
      const passthroughLayer = tryBuildExportNestedCompositionPassthrough({
        clip,
        nestedLayers,
        baseLayer: baseLayerProps,
        compositionWidth: compWidth,
        compositionHeight: compHeight,
        outputWidth: ctx.outputWidth,
        outputHeight: ctx.outputHeight,
        opacityOverride,
      });
      if (passthroughLayer) {
        return passthroughLayer;
      }

      const nestedCompData: NestedCompositionData = {
        compositionId: clip.compositionId || clip.id,
        layers: nestedLayers,
        width: compWidth,
        height: compHeight,
        currentTime: nestedTime,
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
  if (clip.source?.type === 'video') {
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
  // Handle Motion Adjustment clips as ordered compositor operations.
  if (clip.source?.type === 'motion-adjustment') {
    return buildMotionAdjustmentLayerFromBase({
      clip,
      baseLayer: baseLayerProps,
      compositionSize: {
        width: ctx.outputWidth ?? 1920,
        height: ctx.outputHeight ?? 1080,
      },
      surface: 'export',
    });
  }
  // Motion Nulls stay non-rendering transform controllers.
  if (clip.source?.type === 'motion-null') {
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
  // Handle scene light clips
  if (clip.source?.type === 'light') {
    return {
      ...baseLayerProps,
      source: buildLightSource(clip, clipLocalTime, ctx),
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
  const mediaState = ctx.mediaFiles && ctx.mediaCompositions ? null : useMediaStore.getState();
  const mediaFiles = ctx.mediaFiles ?? mediaState?.files ?? [];
  const mediaCompositions = ctx.mediaCompositions ?? mediaState?.compositions ?? [];
  const layerContext: FrameContextWithMedia = { ...ctx, mediaFiles, mediaCompositions };
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
        mediaFiles,
        mediaCompositions,
        outputWidth: ctx.outputWidth,
        outputHeight: ctx.outputHeight,
        frameRate: ctx.fps,
        parentTransformClips: ctx.compositionClips ?? ctx.renderClipsAtTime ?? ctx.clipsAtTime,
        parentTransformTimelineTime: ctx.time,
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
      layerContext,
      clipStates,
      parallelDecoder,
      useParallelDecode,
    );
    if (layer) layers.push(layer);
  }

  return layers;
}
