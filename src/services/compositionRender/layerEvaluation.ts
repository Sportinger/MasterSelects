import type { Layer, LayerSource, NestedCompositionData } from '../../types/layers';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { isVectorAnimationSourceType, type VectorAnimationClipSettings } from '../../types/vectorAnimation';
import type { Composition } from '../../stores/mediaStore/types';
import { calculateSourceTime } from '../../utils/speedIntegration';
import { getEffectiveScale } from '../../utils/transformScale';
import { evaluateTransitionRenderState } from '../../utils/transitionRenderInterpolation';
import { mathSceneRenderer } from '../mathScene/MathSceneRenderer';
import { resolveTransitionRecipeBlendMode } from '../timeline/transitionRecipeBlendWindows';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import {
  getRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import { proxyFrameCache } from '../proxyFrameCache';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import { getBackgroundSessionKey, getBaseLayerSource } from './sourceSetup';
import {
  evaluateCompositionClipEffects,
  evaluateCompositionClipMasks,
  evaluateCompositionClipTransform,
} from './keyframeEvaluation';
import { evaluateTransitionMappedAnimation } from './transitionMappedAnimation';
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

function getCompositionClipKeyframes(
  clip: TimelineClip,
  getClipKeyframes?: ClipKeyframesReader,
): Keyframe[] {
  const keyframes = getClipKeyframes?.(clip.id);
  if (keyframes?.length) return [...keyframes];
  const embeddedKeyframes = (clip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes;
  return embeddedKeyframes ? [...embeddedKeyframes] : keyframes ? [...keyframes] : [];
}

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
}): EvaluatedLayer | null {
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
  const keyframes = isActiveComposition
    ? getClipKeyframes?.(clipAtTime.id)
    : (clipAtTime as SerializableClip).keyframes;
  const mappedAnimation = timelineClip.transitionSourceMap?.version === 2
    ? evaluateTransitionMappedAnimation(timelineClip, keyframes, timelineLocalTime)
    : undefined;
  if (mappedAnimation === null) return null;
  const mappedTime = resolveTransitionSourceMapTime(
    timelineClip.transitionSourceMap,
    timelineLocalTime,
  );
  const sourceOverride = timelineClip.transitionSourceTimeOverride;
  const isHold = mappedTime
    ? mappedTime.isHold || mappedTime.sourceRate === 0
    : timelineClip.transitionSourceHold === true;
  const defaultSpeed = mappedTime
    ? mappedTime.sourceRate
    : isHold
      ? 0
      : clipAtTime.speed ?? (clipAtTime.reversed ? -1 : 1);
  const sourceTime = Number.isFinite(sourceOverride)
    ? sourceOverride! - (defaultSpeed >= 0 ? (clipAtTime.inPoint || 0) : (clipAtTime.outPoint || source.naturalDuration))
    : calculateSourceTime([], timelineLocalTime, defaultSpeed);
  const startPoint = defaultSpeed >= 0
    ? (clipAtTime.inPoint || 0)
    : (clipAtTime.outPoint || source.naturalDuration);
  const clipTime = mappedTime
    ? mappedTime.sourceTime
    : Number.isFinite(sourceOverride)
      ? Math.max(0, Math.min(source.naturalDuration, sourceOverride!))
      : Math.max(0, Math.min(source.naturalDuration, startPoint + sourceTime));

  const baseTransform = clipAtTime.transform || {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  };
  const transform = mappedAnimation?.transform ?? evaluateCompositionClipTransform(baseTransform, keyframes, timelineLocalTime);
  const masks = mappedAnimation?.masks ?? evaluateCompositionClipMasks(clipAtTime.masks, keyframes, timelineLocalTime);
  const effects = mappedAnimation?.effects ?? evaluateCompositionClipEffects(clipAtTime.effects, keyframes, timelineLocalTime);
  const transitionRender = evaluateTransitionRenderState(
    timelineClip.transitionRender,
    keyframes,
    timelineLocalTime,
  );

  let layerSource: EvaluatedLayer['source'] = null;
  if (source.videoElement) {
    layerSource = buildBackgroundVideoLayerSource(source, clipTime, {
      ...playbackOptions,
      playbackRate: Math.abs(defaultSpeed),
      continuousPlayback: !isHold && defaultSpeed > 0,
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
    blendMode: resolveTransitionRecipeBlendMode(
      timelineClip.transitionRecipeBlendWindows,
      time,
      transform.blendMode || 'normal',
    ),
    source: layerSource,
    effects,
    position: transform.position || { x: 0, y: 0, z: 0 },
    scale: getEffectiveScale(transform.scale),
    rotation: typeof transform.rotation === 'number'
      ? transform.rotation
      : transform.rotation?.z || 0,
    sourceRect: clipAtTime.sourceRect ? { ...clipAtTime.sourceRect } : undefined,
    ...(masks?.some((mask) => mask.enabled !== false) ? { maskClipId: clipAtTime.id, maskInvert: false, masks } : {}),
    ...(transitionRender ? { transitionRender } : {}),
    ...(timelineClip.is3D ? { is3D: true } : {}),
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
  getClipKeyframes?: ClipKeyframesReader;
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
    getClipKeyframes,
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
  const keyframes = getCompositionClipKeyframes(clip, getClipKeyframes);
  const mappedAnimation = clip.transitionSourceMap?.version === 2
    ? evaluateTransitionMappedAnimation(clip, keyframes, clipLocalTime)
    : undefined;
  if (mappedAnimation === null) return null;
  const nestedTime = resolveTransitionSourceMapTime(
    clip.transitionSourceMap,
    clipLocalTime,
  )?.sourceTime ?? clipLocalTime + (clip.inPoint || 0);
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
      getClipKeyframes,
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
    const nestedKeyframes = getCompositionClipKeyframes(nestedClip, getClipKeyframes);
    const nestedAnimation = nestedClip.transitionSourceMap?.version === 2
      ? evaluateTransitionMappedAnimation(nestedClip, nestedKeyframes, nestedLocalTime)
      : undefined;
    if (nestedAnimation === null) continue;
    const nestedMappedTime = resolveTransitionSourceMapTime(
      nestedClip.transitionSourceMap,
      nestedLocalTime,
    );
    const nestedSpeed = nestedMappedTime?.sourceRate ??
      (nestedClip.speed ?? (nestedClip.reversed ? -1 : 1));
    const nestedClipTime = nestedMappedTime?.sourceTime ?? (nestedClip.reversed
      ? nestedClip.outPoint - nestedLocalTime
      : nestedLocalTime + nestedClip.inPoint);
    const nestedIsHold = nestedMappedTime
      ? nestedMappedTime.isHold || nestedMappedTime.sourceRate === 0
      : false;

    const transform = nestedAnimation?.transform ?? (nestedClip.transform || {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      blendMode: 'normal' as const,
    });
    const transitionRender = evaluateTransitionRenderState(
      nestedClip.transitionRender,
      nestedKeyframes,
      nestedLocalTime,
    );

    const baseLayer = {
      id: `${parentCompId}-nested-${nestedClip.id}`,
      name: nestedClip.name,
      visible: true,
      opacity: transform.opacity ?? 1,
      blendMode: resolveTransitionRecipeBlendMode(
        nestedClip.transitionRecipeBlendWindows,
        nestedTime,
        transform.blendMode || 'normal',
      ),
      effects: nestedAnimation?.effects ?? evaluateCompositionClipEffects(nestedClip.effects, nestedKeyframes, nestedLocalTime),
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
      ...(nestedAnimation?.masks?.some((mask) => mask.enabled !== false)
        ? { maskClipId: nestedClip.id, maskInvert: false, masks: nestedAnimation.masks }
        : {}),
      ...(transitionRender ? { transitionRender } : {}),
      ...(nestedClip.is3D ? { is3D: true } : {}),
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
            playbackRate: nestedIsHold ? 0 : Math.abs(nestedSpeed),
            continuousPlayback:
              playbackOptions?.continuousPlayback === true &&
              !nestedIsHold &&
              nestedSpeed > 0,
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
  const transform = mappedAnimation?.transform ?? clipTransform;
  const transitionRender = evaluateTransitionRenderState(
    clip.transitionRender,
    keyframes,
    clipLocalTime,
  );

  return {
    id: `${parentCompId}-${clip.id}`,
    clipId: clip.id,
    name: clip.name,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: resolveTransitionRecipeBlendMode(
      clip.transitionRecipeBlendWindows,
      parentTime,
      transform.blendMode || 'normal',
    ),
    source: {
      type: 'video',
      nestedComposition: nestedCompData,
    },
    effects: mappedAnimation?.effects ?? evaluateCompositionClipEffects(clip.effects, keyframes, clipLocalTime),
    position: transform.position || { x: 0, y: 0, z: 0 },
    scale: getEffectiveScale(transform.scale),
    rotation: typeof transform.rotation === 'number'
      ? transform.rotation
      : (transform.rotation?.z || 0) * Math.PI / 180,
    ...(mappedAnimation?.masks?.some((mask) => mask.enabled !== false)
      ? { maskClipId: clip.id, maskInvert: false, masks: mappedAnimation.masks }
      : {}),
    ...(transitionRender ? { transitionRender } : {}),
    ...(clip.is3D ? { is3D: true } : {}),
  };
}
