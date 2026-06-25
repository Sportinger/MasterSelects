import type { Layer, LayerSource, NestedCompositionData } from '../../types/layers';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { isVectorAnimationSourceType, type VectorAnimationClipSettings } from '../../types/vectorAnimation';
import type { Composition } from '../../stores/mediaStore/types';
import { calculateSourceTime } from '../../utils/speedIntegration';
import { getEffectiveScale } from '../../utils/transformScale';
import { mathSceneRenderer } from '../mathScene/MathSceneRenderer';
import {
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import { proxyFrameCache } from '../proxyFrameCache';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import { getBackgroundSessionKey, getBaseLayerSource } from './sourceSetup';
import {
  evaluateCompositionClipMasks,
  evaluateCompositionClipTransform,
} from './keyframeEvaluation';
import type {
  CompositionClipSourceEntry,
  CompositionInfo,
  CompositionMediaFile,
  CompositionSources,
  EvaluatedLayer,
} from './sourceTypes';
import { buildCompositionTransitionLayersForTrack } from './transitionEvaluation';

type VectorSettingsReader = (clipId: string, localTime: number) => VectorAnimationClipSettings | undefined;
type ClipKeyframesReader = (clipId: string) => readonly Keyframe[] | undefined;

export interface BackgroundVideoPlaybackOptions {
  isPlaying?: boolean;
  playbackRate?: number;
  continuousPlayback?: boolean;
}

const PAUSED_BACKGROUND_VIDEO_SEEK_THRESHOLD = 0.05;
const PLAYING_BACKGROUND_VIDEO_START_DRIFT_THRESHOLD = 0.12;
const PLAYING_BACKGROUND_VIDEO_DRIFT_THRESHOLD = 0.35;

function getSafeVideoTime(video: HTMLVideoElement, time: number): number {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, time);
  return Math.max(0, Math.min(time, duration - 0.001));
}

function syncBackgroundVideoElement(
  video: HTMLVideoElement,
  clipTime: number,
  options: BackgroundVideoPlaybackOptions | undefined,
): void {
  const playbackRate = options?.playbackRate ?? 1;
  const canPlayContinuously =
    options?.isPlaying === true &&
    options.continuousPlayback !== false &&
    playbackRate > 0;
  const drift = Math.abs(video.currentTime - clipTime);

  if (!canPlayContinuously) {
    if (!video.paused) video.pause();
    if (!video.seeking && drift > PAUSED_BACKGROUND_VIDEO_SEEK_THRESHOLD) {
      video.currentTime = getSafeVideoTime(video, clipTime);
    }
    return;
  }

  const driftThreshold = video.paused
    ? PLAYING_BACKGROUND_VIDEO_START_DRIFT_THRESHOLD
    : PLAYING_BACKGROUND_VIDEO_DRIFT_THRESHOLD;
  if (!video.seeking && drift > driftThreshold) {
    video.currentTime = getSafeVideoTime(video, clipTime);
  }

  const safePlaybackRate = Math.min(16, Math.max(0.0625, playbackRate));
  if (Math.abs(video.playbackRate - safePlaybackRate) > 0.001) {
    video.playbackRate = safePlaybackRate;
  }
  if (!video.muted) video.muted = true;
  if (video.paused) {
    void video.play().catch(() => {});
  }
}

export function buildBackgroundVideoLayerSource(
  entry: CompositionClipSourceEntry,
  clipTime: number,
  options?: BackgroundVideoPlaybackOptions,
): LayerSource {
  const baseSource = getBaseLayerSource(entry);
  const binding = updateRuntimePlaybackTime(baseSource, clipTime, 'background');
  const runtimeProvider =
    binding?.frameProvider ?? getRuntimeFrameProvider(baseSource, 'background');
  const isRuntimeFullWebCodecs =
    !!baseSource.runtimeSourceId && !!runtimeProvider?.isFullMode();

  if (
    entry.videoElement &&
    !isRuntimeFullWebCodecs
  ) {
    syncBackgroundVideoElement(entry.videoElement, clipTime, options);
  }

  return {
    ...baseSource,
    mediaTime: clipTime,
    targetMediaTime: clipTime,
    webCodecsPlayer: runtimeProvider ?? baseSource.webCodecsPlayer,
  };
}

export function buildEvaluatedClipLayer(params: {
  compositionId: string;
  time: number;
  clipAtTime: SerializableClip | TimelineClip;
  source: CompositionClipSourceEntry;
  isActiveComposition: boolean;
  getVectorAnimationSettings: VectorSettingsReader;
  getClipKeyframes?: ClipKeyframesReader;
  opacityOverride?: number;
  playbackOptions?: BackgroundVideoPlaybackOptions;
}): EvaluatedLayer {
  const {
    compositionId,
    time,
    clipAtTime,
    source,
    isActiveComposition,
    getVectorAnimationSettings,
    getClipKeyframes,
    opacityOverride,
    playbackOptions,
  } = params;
  const timelineClip = clipAtTime as TimelineClip;
  const timelineLocalTime = time - clipAtTime.startTime;
  const sourceOverride = timelineClip.transitionSourceTimeOverride;
  const defaultSpeed = timelineClip.transitionSourceHold
    ? 0
    : clipAtTime.speed ?? (clipAtTime.reversed ? -1 : 1);
  const sourceTime = Number.isFinite(sourceOverride)
    ? sourceOverride! - (defaultSpeed >= 0 ? (clipAtTime.inPoint || 0) : (clipAtTime.outPoint || source.naturalDuration))
    : calculateSourceTime([], timelineLocalTime, defaultSpeed);
  const startPoint = defaultSpeed >= 0
    ? (clipAtTime.inPoint || 0)
    : (clipAtTime.outPoint || source.naturalDuration);
  const clipTime = Number.isFinite(sourceOverride)
    ? Math.max(0, Math.min(source.naturalDuration, sourceOverride!))
    : Math.max(0, Math.min(source.naturalDuration, startPoint + sourceTime));

  const baseTransform = clipAtTime.transform || {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  };
  const keyframes = isActiveComposition
    ? getClipKeyframes?.(clipAtTime.id)
    : (clipAtTime as SerializableClip).keyframes;
  const transform = evaluateCompositionClipTransform(baseTransform, keyframes, timelineLocalTime);
  const masks = evaluateCompositionClipMasks(clipAtTime.masks, keyframes, timelineLocalTime);

  let layerSource: EvaluatedLayer['source'] = null;
  if (source.videoElement) {
    layerSource = buildBackgroundVideoLayerSource(source, clipTime, {
      ...playbackOptions,
      playbackRate: Math.abs(defaultSpeed),
      continuousPlayback: !timelineClip.transitionSourceHold && defaultSpeed > 0,
    });
  } else if (source.imageElement) {
    layerSource = getBaseLayerSource(source);
  } else if (isVectorAnimationSourceType(source.type)) {
    const runtimeClip =
      isActiveComposition && isVectorAnimationSourceType(timelineClip.source?.type)
        ? timelineClip
        : source.lottieClip;
    if (runtimeClip) {
      const runtimeClipLocalTime = Math.max(0, time - runtimeClip.startTime);
      vectorAnimationRuntimeManager.renderClipAtTime(
        runtimeClip,
        time,
        getVectorAnimationSettings(runtimeClip.id, runtimeClipLocalTime),
      );
      layerSource = {
        type: 'text',
        textCanvas: runtimeClip.source?.textCanvas ?? source.textCanvas,
      };
    }
  } else if (source.type === 'math-scene') {
    if (source.mathSceneClip) {
      mathSceneRenderer.renderClip(source.mathSceneClip, clipTime);
    }
    layerSource = {
      type: 'text',
      textCanvas: source.mathSceneClip?.source?.textCanvas ?? source.textCanvas,
    };
  } else if (source.textCanvas) {
    layerSource = getBaseLayerSource(source);
  }

  return {
    id: `${compositionId}-${clipAtTime.id}`,
    clipId: clipAtTime.id,
    name: clipAtTime.name,
    visible: true,
    opacity: (transform.opacity ?? 1) * (opacityOverride ?? 1),
    blendMode: transform.blendMode || 'normal',
    source: layerSource,
    effects: clipAtTime.effects || [],
    position: transform.position || { x: 0, y: 0, z: 0 },
    scale: getEffectiveScale(transform.scale),
    rotation: typeof transform.rotation === 'number'
      ? transform.rotation
      : transform.rotation?.z || 0,
    sourceRect: clipAtTime.sourceRect ? { ...clipAtTime.sourceRect } : undefined,
    ...(masks?.some((mask) => mask.enabled !== false) ? { maskClipId: clipAtTime.id, maskInvert: false, masks } : {}),
  };
}

export function evaluateNestedComposition(params: {
  clip: TimelineClip;
  parentTime: number;
  parentCompId: string;
  sources: CompositionSources;
  compositions: CompositionInfo[];
  mediaFiles: CompositionMediaFile[];
  proxyEnabled: boolean;
  getVectorAnimationSettings: VectorSettingsReader;
  playbackOptions?: BackgroundVideoPlaybackOptions;
  getComposition: (compositionId: string) => Composition | null | undefined;
  isCompositionReady: (compositionId: string) => boolean;
  prepareComposition: (compositionId: string) => void;
  evaluateCompositionAtTime: (
    compositionId: string,
    time: number,
    options?: { playbackOptions?: BackgroundVideoPlaybackOptions },
  ) => Layer[];
}): EvaluatedLayer | null {
  const {
    clip,
    parentTime,
    parentCompId,
    sources,
    compositions,
    mediaFiles,
    proxyEnabled,
    getVectorAnimationSettings,
    playbackOptions,
    getComposition,
    isCompositionReady,
    prepareComposition,
    evaluateCompositionAtTime,
  } = params;

  if (!clip.nestedClips || !clip.nestedTracks) {
    return null;
  }

  const clipLocalTime = parentTime - clip.startTime;
  const nestedTime = clipLocalTime + (clip.inPoint || 0);
  const nestedComp = compositions.find(c => c.id === clip.compositionId);
  const compWidth = nestedComp?.width || 1920;
  const compHeight = nestedComp?.height || 1080;
  const nestedVideoTracks = clip.nestedTracks.filter((t: TimelineTrack) => t.type === 'video' && t.visible);
  const nestedLayers: Layer[] = [];

  for (let i = nestedVideoTracks.length - 1; i >= 0; i--) {
    const nestedTrack = nestedVideoTracks[i];
    const transitionLayers = buildCompositionTransitionLayersForTrack({
      compositionId: clip.compositionId || clip.id,
      time: nestedTime,
      track: nestedTrack,
      trackIndex: i,
      clips: clip.nestedClips,
      sources,
      mediaFiles,
      width: compWidth,
      height: compHeight,
      isActiveComposition: false,
      getVectorAnimationSettings,
      playbackOptions,
      getComposition,
      isCompositionReady,
      prepareComposition,
      evaluateCompositionAtTime,
    });
    if (transitionLayers) {
      nestedLayers.push(...transitionLayers);
      continue;
    }

    const nestedClip = clip.nestedClips.find(
      nc =>
        nc.trackId === nestedTrack.id &&
        nestedTime >= nc.startTime &&
        nestedTime < nc.startTime + nc.duration
    );

    if (!nestedClip) continue;

    const nestedLocalTime = nestedTime - nestedClip.startTime;
    const nestedClipTime = nestedClip.reversed
      ? nestedClip.outPoint - nestedLocalTime
      : nestedLocalTime + nestedClip.inPoint;

    const transform = nestedClip.transform || {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      blendMode: 'normal' as const,
    };

    const baseLayer = {
      id: `${parentCompId}-nested-${nestedClip.id}`,
      name: nestedClip.name,
      visible: true,
      opacity: transform.opacity ?? 1,
      blendMode: transform.blendMode || 'normal',
      effects: nestedClip.effects || [],
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

    if (nestedClip.source?.videoElement) {
      const nestedMediaFile = mediaFiles.find(f =>
        f.id === nestedClip.source?.mediaFileId ||
        f.name === nestedClip.file?.name ||
        f.name === nestedClip.name
      );

      const shouldUseProxy = proxyEnabled &&
        nestedMediaFile?.proxyFps &&
        nestedMediaFile.proxyFormat !== 'mp4-all-intra' &&
        (nestedMediaFile.proxyStatus === 'ready' || nestedMediaFile.proxyStatus === 'generating');

      if (shouldUseProxy && nestedMediaFile) {
        const proxyFps = nestedMediaFile.proxyFps || 30;
        const frameIndex = Math.floor(nestedClipTime * proxyFps);
        const cachedFrame = proxyFrameCache.getCachedFrame(nestedMediaFile.id, frameIndex, proxyFps);

        if (cachedFrame) {
          nestedLayers.push({
            ...baseLayer,
            source: {
              type: 'image',
              imageElement: cachedFrame,
              mediaTime: frameIndex / proxyFps,
              targetMediaTime: nestedClipTime,
              previewPath: 'nested-proxy-image-frame',
              proxyFrameIndex: frameIndex,
            },
          } as Layer);
          continue;
        }
        void proxyFrameCache.getFrame(nestedMediaFile.id, nestedClipTime, proxyFps);
      }

      nestedLayers.push({
        ...baseLayer,
        source: buildBackgroundVideoLayerSource(
          {
            clipId: nestedClip.id,
            type: 'video',
            videoElement: nestedClip.source.videoElement,
            webCodecsPlayer: nestedClip.source.webCodecsPlayer,
            file: nestedClip.file,
            naturalDuration: nestedClip.source.naturalDuration || nestedClip.source.videoElement.duration || 0,
            runtimeSourceId: nestedClip.source.runtimeSourceId,
            runtimeSessionKey: getBackgroundSessionKey(
              parentCompId,
              nestedClip.id,
              nestedClip.source
            ),
          },
          nestedClipTime,
          {
            ...playbackOptions,
            playbackRate: Math.abs(nestedClip.speed ?? (nestedClip.reversed ? -1 : 1)),
            continuousPlayback:
              playbackOptions?.continuousPlayback === true &&
              !nestedClip.reversed &&
              (nestedClip.speed ?? 1) > 0,
          }
        ),
      } as Layer);
    } else if (nestedClip.source?.type === 'image') {
      const imageElement =
        nestedClip.source.imageElement ??
        sources.clipSources.get(nestedClip.id)?.imageElement;
      if (!imageElement) {
        continue;
      }

      nestedLayers.push({
        ...baseLayer,
        source: {
          type: 'image',
          imageElement,
        },
      } as Layer);
    } else if (nestedClip.source?.textCanvas) {
      if (isVectorAnimationSourceType(nestedClip.source.type)) {
        vectorAnimationRuntimeManager.renderClipAtTime(
          nestedClip,
          nestedTime,
          getVectorAnimationSettings(nestedClip.id, nestedLocalTime),
        );
      } else if (nestedClip.source.type === 'math-scene') {
        mathSceneRenderer.renderClip(nestedClip, nestedClipTime);
      }
      nestedLayers.push({
        ...baseLayer,
        source: {
          type: 'text',
          textCanvas: nestedClip.source.textCanvas,
        },
      } as Layer);
    }
  }

  if (nestedLayers.length === 0) {
    return null;
  }

  const nestedCompData: NestedCompositionData = {
    compositionId: clip.compositionId || clip.id,
    layers: nestedLayers,
    width: compWidth,
    height: compHeight,
  };

  const clipTransform = clip.transform || {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };

  return {
    id: `${parentCompId}-${clip.id}`,
    clipId: clip.id,
    name: clip.name,
    visible: true,
    opacity: clipTransform.opacity ?? 1,
    blendMode: clipTransform.blendMode || 'normal',
    source: {
      type: 'video',
      nestedComposition: nestedCompData,
    },
    effects: clip.effects || [],
    position: clipTransform.position || { x: 0, y: 0, z: 0 },
    scale: getEffectiveScale(clipTransform.scale),
    rotation: typeof clipTransform.rotation === 'number'
      ? clipTransform.rotation
      : (clipTransform.rotation?.z || 0) * Math.PI / 180,
  };
}
