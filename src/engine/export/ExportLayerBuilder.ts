// Layer building for export rendering

import { Logger } from '../../services/logger';
import type { Layer, NestedCompositionData, BlendMode, ClipTransform, Effect, RuntimeColorGrade } from '../../types';
import { compileRuntimeColorGrade } from '../../types';

const log = Logger.create('ExportLayerBuilder');
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import type { ExportClipState, BaseLayerProps, FrameContext } from './types';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { getEffectiveScale } from '../../utils/transformScale';
import { DEFAULT_TEXT_3D_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS, type GaussianSplatSettings } from '../gaussian/types';
import { lottieRuntimeManager } from '../../services/vectorAnimation/LottieRuntimeManager';
import {
  getGaussianSplatSequenceFrame,
  getGaussianSplatSequenceFrameRuntimeKey,
  getGaussianSplatSequenceFrameUrl,
  resolveGaussianSplatSequenceData,
} from '../../utils/gaussianSplatSequence';
import { getModelSequenceFrameUrl, resolveModelSequenceData } from '../../utils/modelSequence';
import { mathSceneRenderer } from '../../services/mathScene/MathSceneRenderer';

// Cache video tracks and solo state at export start (don't change during export)
let cachedVideoTracks: TimelineTrack[] | null = null;
let cachedAnyVideoSolo = false;
const MAX_EXPORT_NESTING_DEPTH = 4;

export function initializeLayerBuilder(tracks: TimelineTrack[]): void {
  cachedVideoTracks = tracks.filter(t => t.type === 'video');
  cachedAnyVideoSolo = cachedVideoTracks.some(t => t.solo);
}

export function cleanupLayerBuilder(): void {
  cachedVideoTracks = null;
  cachedAnyVideoSolo = false;
}

function getClipMeshType(clip: TimelineClip) {
  return clip.meshType ?? clip.source?.meshType;
}

function getClipMediaFile(clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) {
    return null;
  }
  return useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null;
}

function getClipText3DProperties(clip: TimelineClip) {
  const meshType = getClipMeshType(clip);
  if (meshType === 'text3d') {
    return clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
  }
  return clip.text3DProperties ?? clip.source?.text3DProperties;
}

function getClipSourceWindowTime(clip: TimelineClip, clipLocalTime: number, ctx: FrameContext): number {
  const sourceTime = ctx.getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = ctx.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

function buildModelSource(clip: TimelineClip, sourceTime: number): Layer['source'] {
  const meshType = getClipMeshType(clip);
  const text3DProperties = getClipText3DProperties(clip);
  const modelSequence = resolveModelSequenceData(
    clip.source?.modelSequence,
    getClipMediaFile(clip)?.modelSequence,
  );

  return {
    type: 'model',
    modelUrl: getModelSequenceFrameUrl(modelSequence, sourceTime, clip.source?.modelUrl),
    ...(modelSequence ? { modelSequence } : {}),
    ...(meshType ? { meshType } : {}),
    ...(text3DProperties ? { text3DProperties } : {}),
  };
}

function buildGaussianSplatSource(clip: TimelineClip, clipLocalTime: number): Layer['source'] {
  const mediaFile = getClipMediaFile(clip);
  const gaussianSplatSequence = resolveGaussianSplatSequenceData(
    clip.source?.gaussianSplatSequence,
    mediaFile?.gaussianSplatSequence,
  );
  const sequenceFrame = getGaussianSplatSequenceFrame(gaussianSplatSequence, clipLocalTime);
  const fileName =
    sequenceFrame?.name ??
    clip.source?.gaussianSplatFileName ??
    mediaFile?.file?.name ??
    clip.file?.name ??
    mediaFile?.name ??
    clip.name;
  const fileHash = gaussianSplatSequence
    ? undefined
    : (clip.source?.gaussianSplatFileHash ?? mediaFile?.fileHash);
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

  return {
    type: 'gaussian-splat',
    file:
      sequenceFrame?.file ??
      mediaFile?.file ??
      clip.source?.file ??
      clip.file,
    gaussianSplatUrl: getGaussianSplatSequenceFrameUrl(gaussianSplatSequence, clipLocalTime, clip.source?.gaussianSplatUrl),
    gaussianSplatFileName: fileName,
    ...(fileHash ? { gaussianSplatFileHash: fileHash } : {}),
    gaussianSplatRuntimeKey: getGaussianSplatSequenceFrameRuntimeKey(
      gaussianSplatSequence,
      clipLocalTime,
      clip.source?.gaussianSplatRuntimeKey ??
        fileHash ??
        fileName ??
        clip.source?.gaussianSplatUrl ??
        clip.id,
    ),
    ...(gaussianSplatSequence ? { gaussianSplatSequence } : {}),
    ...(mediaFileId ? { mediaFileId } : {}),
    gaussianSplatSettings: buildExportGaussianSplatSettings(clip.source?.gaussianSplatSettings),
    mediaTime: clipLocalTime,
  };
}

function getExportVideoElement(
  clip: TimelineClip,
  clipStates: Map<string, ExportClipState>
): HTMLVideoElement | null {
  return clipStates.get(clip.id)?.preciseVideoElement ?? clip.source?.videoElement ?? null;
}

function getVectorAnimationSettingsForExport(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx?: FrameContext,
) {
  return ctx?.getInterpolatedVectorAnimationSettings?.(clip.id, clipLocalTime)
    ?? useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clip.id, clipLocalTime);
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
  const { time, clipsByTrack } = ctx;
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

    // O(1) lookup instead of O(n) find
    const clip = clipsByTrack.get(track.id);
    if (!clip) continue;

    const clipLocalTime = time - clip.startTime;
    const baseLayerProps = buildBaseLayerProps(
      clip,
      clipLocalTime,
      trackIndex,
      ctx,
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
        const composition = useMediaStore.getState().compositions.find(c => c.id === clip.compositionId);
        const compWidth = composition?.width || 1920;
        const compHeight = composition?.height || 1080;

        const nestedCompData: NestedCompositionData = {
          compositionId: clip.compositionId || clip.id,
          layers: nestedLayers,
          width: compWidth,
          height: compHeight,
          currentTime: clipLocalTime + (clip.inPoint || 0),
          sceneClips: clip.nestedClips,
          sceneTracks: clip.nestedTracks,
        };

        layers.push({
          ...baseLayerProps,
          source: {
            type: 'image', // Nested comps are pre-rendered to texture
            nestedComposition: nestedCompData,
          },
        });
      }
      continue;
    }

    // Handle video clips
    if (clip.source?.type === 'video' && getExportVideoElement(clip, clipStates)) {
      const layer = buildVideoLayer(clip, baseLayerProps, time, clipStates, parallelDecoder, useParallelDecode);
      if (layer) layers.push(layer);
    }
    // Handle image clips
    else if (clip.source?.type === 'image' && clip.source.imageElement) {
      layers.push({
        ...baseLayerProps,
        source: { type: 'image', imageElement: clip.source.imageElement },
      });
    }
    // Handle 3D model clips
    else if (clip.source?.type === 'model') {
      const modelSourceTime = getClipSourceWindowTime(clip, clipLocalTime, ctx);
      layers.push({
        ...baseLayerProps,
        source: buildModelSource(clip, modelSourceTime),
        is3D: true,
      });
    }
    // Handle Gaussian Splat clips (native WebGPU)
    else if (clip.source?.type === 'gaussian-splat') {
      layers.push({
        ...baseLayerProps,
        source: buildGaussianSplatSource(clip, clipLocalTime),
        is3D: true,
      });
    }
    // Handle text, solid, Lottie, and Math Scene clips
    else if ((clip.source?.type === 'text' || clip.source?.type === 'solid' || clip.source?.type === 'lottie' || clip.source?.type === 'math-scene') && clip.source.textCanvas) {
      if (clip.source.type === 'lottie') {
        lottieRuntimeManager.renderClipAtTime(
          clip,
          time,
          getVectorAnimationSettingsForExport(clip, clipLocalTime, ctx),
        );
      } else if (clip.source.type === 'math-scene') {
        mathSceneRenderer.renderClip(clip, clipLocalTime);
      }
      layers.push({
        ...baseLayerProps,
        source: { type: 'text', textCanvas: clip.source.textCanvas },
      });
    }
  }

  return layers;
}

function buildExportGaussianSplatSettings(
  settings: GaussianSplatSettings | undefined,
): GaussianSplatSettings {
  const baseSettings = settings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
  return {
    ...baseSettings,
    render: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render,
      ...baseSettings.render,
      useNativeRenderer: true,
      // Export should favor completeness and stable depth ordering over preview performance.
      maxSplats: 0,
      sortFrequency: 1,
    },
    temporal: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.temporal,
      ...baseSettings.temporal,
    },
    particle: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.particle,
      ...baseSettings.particle,
    },
  };
}

/**
 * Build base layer properties from clip transform.
 * Uses FrameContext methods for transform/effects interpolation.
 */
function buildBaseLayerProps(
  clip: TimelineClip,
  clipLocalTime: number,
  trackIndex: number,
  ctx: FrameContext,
): BaseLayerProps {
  const { getInterpolatedTransform, getInterpolatedEffects, getInterpolatedColorCorrection } = ctx;

  // Get transform safely with defaults
  let transform;
  try {
    transform = getInterpolatedTransform(clip.id, clipLocalTime);
  } catch (e) {
    log.warn(`Transform interpolation failed for clip ${clip.id}`, e);
    transform = {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal' as BlendMode,
    };
  }

  // Get effects safely
  let effects: Effect[] = [];
  try {
    effects = getInterpolatedEffects(clip.id, clipLocalTime);
  } catch (e) {
    log.warn(`Effects interpolation failed for clip ${clip.id}`, e);
  }

  let colorCorrection: RuntimeColorGrade | undefined;
  try {
    colorCorrection = typeof getInterpolatedColorCorrection === 'function'
      ? getInterpolatedColorCorrection(clip.id, clipLocalTime)
      : undefined;
  } catch (e) {
    log.warn(`Color interpolation failed for clip ${clip.id}`, e);
  }

  const renderScale = getEffectiveScale(transform.scale);

  return {
    id: `export_layer_${trackIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
    effects,
    colorCorrection,
    position: {
      x: transform.position?.x ?? 0,
      y: transform.position?.y ?? 0,
      z: transform.position?.z ?? 0,
    },
    scale: renderScale,
    rotation: {
      x: ((transform.rotation?.x ?? 0) * Math.PI) / 180,
      y: ((transform.rotation?.y ?? 0) * Math.PI) / 180,
      z: ((transform.rotation?.z ?? 0) * Math.PI) / 180,
    },
    ...(clip.masks?.some(mask => mask.enabled !== false) ? { maskClipId: clip.id, maskInvert: false } : {}),
    ...(clip.is3D ? { is3D: true } : {}),
  };
}

/**
 * Build video layer with appropriate source (parallel > webcodecs > HTMLVideoElement).
 * Falls back to HTMLVideoElement if other methods fail.
 */
function buildVideoLayer(
  clip: TimelineClip,
  baseLayerProps: BaseLayerProps,
  time: number,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean
): Layer | null {
  const clipState = clipStates.get(clip.id);
  const video = clipState?.preciseVideoElement ?? clip.source?.videoElement ?? null;
  if (!video) {
    return null;
  }

  // PARALLEL DECODE MODE - try parallel decode first
  if (useParallelDecode && parallelDecoder) {
    if (parallelDecoder.hasClip(clip.id)) {
      const videoFrame = parallelDecoder.getFrameForClip(clip.id, time);
      if (videoFrame) {
        return {
          ...baseLayerProps,
          source: {
            type: 'video',
            videoElement: video,
            videoFrame: videoFrame,
          },
        };
      }
      // Frame not available - log and fall through to HTMLVideoElement fallback
      log.warn(`Parallel decode frame not available for clip "${clip.name}" at ${time.toFixed(3)}s, using HTMLVideoElement fallback`);
    } else {
      log.warn(`Clip "${clip.name}" not in parallel decoder, using HTMLVideoElement fallback`);
    }
  }

  // SEQUENTIAL MODE (single clip) - use WebCodecs player
  if (clipState?.isSequential && clipState.webCodecsPlayer) {
    const videoFrame = clipState.webCodecsPlayer.getCurrentFrame();
    if (videoFrame) {
      return {
        ...baseLayerProps,
        source: {
          type: 'video',
          videoElement: video,
          videoFrame,
          webCodecsPlayer: clipState.webCodecsPlayer,
        },
      };
    }
    log.warn(`Sequential decode frame not available for clip "${clip.name}" at ${time.toFixed(3)}s, using HTMLVideoElement fallback`);
  }

  // FALLBACK: Use HTMLVideoElement directly (less accurate but doesn't fail)
  if (video.readyState >= 2) {
    log.debug(`Using HTMLVideoElement fallback for clip "${clip.name}" at ${time.toFixed(3)}s`);
    return {
      ...baseLayerProps,
      source: {
        type: 'video',
        videoElement: video,
      },
    };
  }

  // Video not ready at all - skip this frame
  log.warn(`Video not ready for clip "${clip.name}" at ${time.toFixed(3)}s (readyState: ${video.readyState}), skipping frame`);
  return null;
}

/**
 * Build layers for a nested composition at export time.
 */
function buildNestedLayersForExport(
  clip: TimelineClip,
  nestedTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  depth: number = 0,
): Layer[] {
  if (!clip.nestedClips || !clip.nestedTracks || depth >= MAX_EXPORT_NESTING_DEPTH) return [];

  // Filter for video tracks that are visible (default to visible if not explicitly set to false)
  const nestedVideoTracks = clip.nestedTracks.filter(t => t.type === 'video');
  const nestedAnyVideoSolo = nestedVideoTracks.some(t => t.solo);
  const layers: Layer[] = [];

  for (let i = 0; i < nestedVideoTracks.length; i++) {
    const nestedTrack = nestedVideoTracks[i];
    if (nestedTrack.visible === false) continue;
    if (nestedAnyVideoSolo && !nestedTrack.solo) continue;

    const nestedClip = clip.nestedClips.find(
      nc =>
        nc.trackId === nestedTrack.id &&
        nestedTime >= nc.startTime &&
        nestedTime < nc.startTime + nc.duration
    );

    if (!nestedClip) continue;

    // Calculate the clip-local time for keyframe interpolation
    const nestedClipLocalTime = nestedTime - nestedClip.startTime;
    const nestedLayer = buildNestedLayerForExport(
      nestedClip,
      nestedClipLocalTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      depth,
    );
    if (nestedLayer) {
      layers.push(nestedLayer);
    }
  }

  return layers;
}

function buildNestedLayerForExport(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  depth: number,
): Layer | null {
  const baseLayer = buildNestedBaseLayer(nestedClip, nestedClipLocalTime);

  if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedTracks) {
    const subCompTime = nestedClipLocalTime + (nestedClip.inPoint || 0);
    const subLayers = buildNestedLayersForExport(
      nestedClip,
      subCompTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      depth + 1,
    );

    if (subLayers.length === 0) {
      return null;
    }

    const composition = useMediaStore.getState().compositions.find(c => c.id === nestedClip.compositionId);
    const compWidth = composition?.width || 1920;
    const compHeight = composition?.height || 1080;

    return {
      ...baseLayer,
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: nestedClip.compositionId || nestedClip.id,
          layers: subLayers,
          width: compWidth,
          height: compHeight,
          currentTime: subCompTime,
          sceneClips: nestedClip.nestedClips,
          sceneTracks: nestedClip.nestedTracks,
        },
      },
    } as Layer;
  }

  const exportVideo = getExportVideoElement(nestedClip, clipStates);
  if (exportVideo) {
    const nestedClipState = clipStates.get(nestedClip.id);
    if (useParallelDecode && parallelDecoder) {
      if (parallelDecoder.hasClip(nestedClip.id)) {
        const videoFrame = parallelDecoder.getFrameForClip(nestedClip.id, mainTimelineTime);
        if (videoFrame) {
          return {
            ...baseLayer,
            source: {
              type: 'video',
              videoElement: exportVideo,
              videoFrame,
            },
          } as Layer;
        }
        log.warn(`Parallel decode frame not available for nested clip "${nestedClip.name}" at ${mainTimelineTime.toFixed(3)}s, using HTMLVideoElement fallback`);
      } else {
        log.warn(`Nested clip "${nestedClip.name}" not in parallel decoder, using HTMLVideoElement fallback`);
      }
    }

    if (nestedClipState?.isSequential && nestedClipState.webCodecsPlayer) {
      const videoFrame = nestedClipState.webCodecsPlayer.getCurrentFrame();
      if (videoFrame) {
        return {
          ...baseLayer,
          source: {
            type: 'video',
            videoElement: exportVideo,
            videoFrame,
            webCodecsPlayer: nestedClipState.webCodecsPlayer,
          },
        } as Layer;
      }
    }

    if (exportVideo.readyState >= 2) {
      return {
        ...baseLayer,
        source: {
          type: 'video',
          videoElement: exportVideo,
          webCodecsPlayer: nestedClipState?.webCodecsPlayer ?? undefined,
        },
      } as Layer;
    }

    log.warn(`Nested clip "${nestedClip.name}" video not ready (readyState=${exportVideo.readyState}), skipping frame`);
    return null;
  }

  if (nestedClip.source?.type === 'image' && nestedClip.source.imageElement) {
    return {
      ...baseLayer,
      source: { type: 'image', imageElement: nestedClip.source.imageElement },
    } as Layer;
  }

  if (nestedClip.source?.type === 'model') {
    const nestedSourceTime = nestedClip.reversed
      ? nestedClip.outPoint - nestedClipLocalTime
      : nestedClipLocalTime + nestedClip.inPoint;
    return {
      ...baseLayer,
      source: buildModelSource(nestedClip, nestedSourceTime),
      is3D: true,
    } as Layer;
  }

  if (nestedClip.source?.type === 'gaussian-splat') {
    return {
      ...baseLayer,
      source: buildGaussianSplatSource(nestedClip, nestedClipLocalTime),
      is3D: true,
    } as Layer;
  }

  if ((nestedClip.source?.type === 'text' || nestedClip.source?.type === 'solid' || nestedClip.source?.type === 'lottie' || nestedClip.source?.type === 'math-scene') && nestedClip.source.textCanvas) {
    if (nestedClip.source.type === 'lottie') {
      lottieRuntimeManager.renderClipAtTime(
        nestedClip,
        nestedClip.startTime + nestedClipLocalTime,
        getVectorAnimationSettingsForExport(nestedClip, nestedClipLocalTime),
      );
    } else if (nestedClip.source.type === 'math-scene') {
      mathSceneRenderer.renderClip(nestedClip, nestedClipLocalTime);
    }
    return {
      ...baseLayer,
      source: { type: 'text', textCanvas: nestedClip.source.textCanvas },
    } as Layer;
  }

  return null;
}

/**
 * Build base layer for nested clip with keyframe interpolation.
 */
function buildNestedBaseLayer(nestedClip: TimelineClip, nestedClipLocalTime: number): BaseLayerProps {
  // Get keyframes directly from the store (same approach as playback)
  const { clipKeyframes } = useTimelineStore.getState();
  const keyframes = clipKeyframes.get(nestedClip.id) || [];

  // Build base transform from the nested clip's static transform
  const baseTransform: ClipTransform = {
    opacity: nestedClip.transform?.opacity ?? DEFAULT_TRANSFORM.opacity,
    blendMode: nestedClip.transform?.blendMode ?? DEFAULT_TRANSFORM.blendMode,
    position: {
      x: nestedClip.transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
      y: nestedClip.transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
      z: nestedClip.transform?.position?.z ?? DEFAULT_TRANSFORM.position.z,
    },
    scale: {
      ...(nestedClip.transform?.scale?.all !== undefined ? { all: nestedClip.transform.scale.all } : {}),
      x: nestedClip.transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
      y: nestedClip.transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
      ...(nestedClip.transform?.scale?.z !== undefined ? { z: nestedClip.transform.scale.z } : {}),
    },
    rotation: {
      x: nestedClip.transform?.rotation?.x ?? DEFAULT_TRANSFORM.rotation.x,
      y: nestedClip.transform?.rotation?.y ?? DEFAULT_TRANSFORM.rotation.y,
      z: nestedClip.transform?.rotation?.z ?? DEFAULT_TRANSFORM.rotation.z,
    },
  };

  // Interpolate transform using keyframes (supports opacity fades, position animations, etc.)
  const transform = keyframes.length > 0
    ? getInterpolatedClipTransform(keyframes, nestedClipLocalTime, baseTransform, {
        rotationMode: nestedClip.source?.type === 'camera' ? 'shortest' : 'linear',
      })
    : baseTransform;

  // Interpolate effect parameters if there are effect keyframes
  const effectKeyframes = keyframes.filter(k => k.property.startsWith('effect.'));
  let effects = nestedClip.effects || [];
  if (effectKeyframes.length > 0 && effects.length > 0) {
    effects = effects.map(effect => {
      const newParams = { ...effect.params };
      Object.keys(effect.params).forEach(paramName => {
        if (typeof effect.params[paramName] !== 'number') return;
        const propertyKey = `effect.${effect.id}.${paramName}`;
        const paramKeyframes = effectKeyframes.filter(k => k.property === propertyKey);
        if (paramKeyframes.length > 0) {
          const sorted = [...paramKeyframes].sort((a, b) => a.time - b.time);
          if (nestedClipLocalTime <= sorted[0].time) {
            newParams[paramName] = sorted[0].value;
          } else if (nestedClipLocalTime >= sorted[sorted.length - 1].time) {
            newParams[paramName] = sorted[sorted.length - 1].value;
          } else {
            for (let i = 0; i < sorted.length - 1; i++) {
              if (nestedClipLocalTime >= sorted[i].time && nestedClipLocalTime <= sorted[i + 1].time) {
                const t = (nestedClipLocalTime - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
                newParams[paramName] = sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
                break;
              }
            }
          }
        }
      });
      return { ...effect, params: newParams };
    });
  }

  const renderScale = getEffectiveScale(transform.scale);

  return {
    id: `nested-export-${nestedClip.id}`,
    name: nestedClip.name,
    sourceClipId: nestedClip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
    effects,
    colorCorrection: compileRuntimeColorGrade(nestedClip.colorCorrection),
    position: {
      x: transform.position?.x || 0,
      y: transform.position?.y || 0,
      z: transform.position?.z || 0,
    },
    scale: renderScale,
    rotation: {
      x: ((transform.rotation?.x || 0) * Math.PI) / 180,
      y: ((transform.rotation?.y || 0) * Math.PI) / 180,
      z: ((transform.rotation?.z || 0) * Math.PI) / 180,
    },
    ...(nestedClip.masks?.some(mask => mask.enabled !== false) ? { maskClipId: nestedClip.id, maskInvert: false } : {}),
    ...(nestedClip.is3D ? { is3D: true } : {}),
  };
}
