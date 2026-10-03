import { createStoreSpeedSource, resolveClipSourceTime, videoFrameSourceTime } from '../../../services/timeline/retime/clipRetime';
import type {
  ClipTransform,
  Effect,
  Layer,
  TimelineClip,
  TimelineTrack,
} from '../../../types';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { proxyFrameCache } from '../../../services/proxyFrameCache';
import { getEffectiveScale } from '../../../utils/transformScale';

export interface LayerSyncProxyFrameCacheEntry {
  frameIndex: number;
  image: HTMLImageElement;
}

interface SyncLayerProxyFrameParams {
  clip: TimelineClip;
  effectsChanged: (
    layerEffects: Effect[] | undefined,
    clipEffects: Effect[] | undefined,
  ) => boolean;
  getInterpolatedEffects: (clipId: string, localTime: number) => Effect[];
  getInterpolatedSpeed: (clipId: string, localTime: number) => number;
  getInterpolatedTransform: (clipId: string, localTime: number) => ClipTransform;
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  isDraggingPlayhead: boolean;
  isVideoTrackVisible: (track: TimelineTrack) => boolean;
  layer: Layer | undefined;
  layerIndex: number;
  newLayers: Layer[];
  playheadPosition: number;
  proxyFrames: Map<string, LayerSyncProxyFrameCacheEntry>;
  proxyLoading: Set<string>;
  track: TimelineTrack;
}

interface SyncLayerProxyFrameResult {
  handled: boolean;
  layersChanged: boolean;
}

function buildProxyImageLayer(params: {
  clip: TimelineClip;
  effects: Effect[];
  frameIndex: number;
  image: HTMLImageElement;
  layerIndex: number;
  mediaTime: number;
  previewPath: string;
  targetMediaTime: number;
  trackVisible: boolean;
  transform: ClipTransform;
}): Layer {
  const {
    clip,
    effects,
    frameIndex,
    image,
    layerIndex,
    mediaTime,
    previewPath,
    targetMediaTime,
    trackVisible,
    transform,
  } = params;

  return {
    id: `timeline_layer_${layerIndex}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: trackVisible,
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    source: {
      type: 'image',
      imageElement: image,
      mediaTime,
      targetMediaTime,
      previewPath,
      proxyFrameIndex: frameIndex,
    },
    effects,
    position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: (transform.rotation.x * Math.PI) / 180,
      y: (transform.rotation.y * Math.PI) / 180,
      z: (transform.rotation.z * Math.PI) / 180,
    },
  };
}

export function syncLayerProxyFrame({
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
  proxyFrames,
  proxyLoading,
  track,
}: SyncLayerProxyFrameParams): SyncLayerProxyFrameResult {
  const clipLocalTime = playheadPosition - clip.startTime;
  const keyframeLocalTime = clipLocalTime;
  const clipTime = videoFrameSourceTime(resolveClipSourceTime(clip, clipLocalTime, createStoreSpeedSource(clip.id, {
    getSourceTimeForClip, getInterpolatedSpeed,
  })));
  const mediaStore = useMediaStore.getState();
  const mediaFile = mediaStore.files.find(
    (file) => file.name === clip.name || clip.mediaFileId === file.id,
  );
  const proxyFps = mediaFile?.proxyFps || 30;
  const frameIndex = Math.floor(clipTime * proxyFps);

  let useProxy = false;
  if (
    mediaStore.proxyEnabled &&
    mediaFile?.proxyFps &&
    mediaFile.proxyFormat !== 'mp4-all-intra'
  ) {
    if (mediaFile.proxyStatus === 'ready') {
      useProxy = true;
    } else if (
      mediaFile.proxyStatus === 'generating' &&
      (mediaFile.proxyProgress || 0) > 0
    ) {
      const totalFrames = Math.ceil((mediaFile.duration || 10) * proxyFps);
      const maxGeneratedFrame = Math.floor(totalFrames * ((mediaFile.proxyProgress || 0) / 100));
      useProxy = frameIndex < maxGeneratedFrame;
    }
  }

  if (!useProxy || !mediaFile) {
    return { handled: false, layersChanged: false };
  }

  const cacheKey = `${mediaFile.id}_${clip.id}`;
  const cached = proxyFrames.get(cacheKey);
  const loadKey = `${mediaFile.id}_${frameIndex}`;
  const cachedInService = proxyFrameCache.getCachedFrame(mediaFile.id, frameIndex, proxyFps);
  const interpolatedEffectsForProxy = getInterpolatedEffects(clip.id, keyframeLocalTime);

  if (cachedInService) {
    proxyFrames.set(cacheKey, {
      frameIndex,
      image: cachedInService,
    });

    const transform = getInterpolatedTransform(clip.id, keyframeLocalTime);
    newLayers[layerIndex] = buildProxyImageLayer({
      clip,
      effects: interpolatedEffectsForProxy,
      frameIndex,
      image: cachedInService,
      layerIndex,
      mediaTime: frameIndex / proxyFps,
      previewPath: 'proxy-image-frame',
      targetMediaTime: clipTime,
      trackVisible: isVideoTrackVisible(track),
      transform,
    });
    return { handled: true, layersChanged: true };
  }

  if (!cached || cached.frameIndex !== frameIndex) {
    if (!proxyLoading.has(loadKey)) {
      proxyLoading.add(loadKey);

      const capturedLayerIndex = layerIndex;
      const capturedTransform = getInterpolatedTransform(clip.id, keyframeLocalTime);
      const capturedTrackVisible = isVideoTrackVisible(track);
      const capturedClip = clip;
      const capturedEffects = interpolatedEffectsForProxy;

      void proxyFrameCache
        .getFrame(mediaFile.id, clipTime, proxyFps)
        .then((image) => {
          proxyLoading.delete(loadKey);
          if (!image) return;

          proxyFrames.set(cacheKey, { frameIndex, image });

          const currentLayers = useTimelineStore.getState().layers;
          const updatedLayers = [...currentLayers];
          updatedLayers[capturedLayerIndex] = buildProxyImageLayer({
            clip: capturedClip,
            effects: capturedEffects,
            frameIndex,
            image,
            layerIndex: capturedLayerIndex,
            mediaTime: frameIndex / proxyFps,
            previewPath: 'proxy-image-frame',
            targetMediaTime: clipTime,
            trackVisible: capturedTrackVisible,
            transform: capturedTransform,
          });
          useTimelineStore.setState({ layers: updatedLayers });
        });
    }

    const nearestSearchDistance = isDraggingPlayhead ? 90 : 30;
    const nearestFrame =
      proxyFrameCache.getNearestCachedFrameEntry(mediaFile.id, frameIndex, nearestSearchDistance)?.image ||
      cached?.image;
    if (nearestFrame) {
      const transform = getInterpolatedTransform(clip.id, keyframeLocalTime);
      newLayers[layerIndex] = buildProxyImageLayer({
        clip,
        effects: interpolatedEffectsForProxy,
        frameIndex,
        image: nearestFrame,
        layerIndex,
        mediaTime: frameIndex / proxyFps,
        previewPath: 'proxy-image-frame-nearest',
        targetMediaTime: clipTime,
        trackVisible: isVideoTrackVisible(track),
        transform,
      });
      return { handled: true, layersChanged: true };
    }

    return { handled: true, layersChanged: false };
  }

  if (cached?.image) {
    const transform = getInterpolatedTransform(clip.id, keyframeLocalTime);
    const trackVisible = isVideoTrackVisible(track);
    const needsUpdate =
      !layer ||
      layer.visible !== trackVisible ||
      layer.source?.imageElement !== cached.image ||
      layer.source?.type !== 'image' ||
      effectsChanged(layer.effects, interpolatedEffectsForProxy);

    if (needsUpdate) {
      newLayers[layerIndex] = buildProxyImageLayer({
        clip,
        effects: interpolatedEffectsForProxy,
        frameIndex: cached.frameIndex,
        image: cached.image,
        layerIndex,
        mediaTime: cached.frameIndex / proxyFps,
        previewPath: 'proxy-image-frame-hold',
        targetMediaTime: clipTime,
        trackVisible,
        transform,
      });
      return { handled: true, layersChanged: true };
    }
  }

  return { handled: true, layersChanged: false };
}
