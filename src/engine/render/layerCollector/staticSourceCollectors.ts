import type { Layer, LayerRenderData } from '../../core/types';
import { getMotionReplicatorSourceGeometry } from '../../motion/MotionTypes';
import type { LayerCollectorDeps } from '../LayerCollector';
import type { TextureManager } from '../../texture/TextureManager';

function collectImageElementLayer(
  layer: Layer,
  img: HTMLImageElement,
  deps: LayerCollectorDeps
): LayerRenderData | null {
  let texture = deps.textureManager.getCachedImageTexture(img);
  if (!texture) {
    texture = deps.textureManager.createImageTexture(img) ?? undefined;
  }
  if (texture) {
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      isDynamic: layer.source?.proxyFrameIndex !== undefined,
      textureView: deps.textureManager.getImageView(texture),
      sourceWidth: img.naturalWidth,
      sourceHeight: img.naturalHeight,
      displayedMediaTime: layer.source?.mediaTime,
      targetMediaTime: layer.source?.targetMediaTime ?? layer.source?.mediaTime,
      previewPath: layer.source?.previewPath,
    };
  }
  return null;
}

export function collectCanvasElementLayer(
  layer: Layer,
  canvas: HTMLCanvasElement,
  textureManager: TextureManager,
): LayerRenderData | null {
  const texture = textureManager.createCanvasTexture(canvas);
  if (texture) {
    return {
      layer,
      isVideo: false,
      isDynamic: Boolean(canvas.dataset.masterselectsDynamic),
      externalTexture: null,
      textureView: textureManager.getImageView(texture),
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
      displayedMediaTime: layer.source?.videoElement?.currentTime ?? layer.source?.mediaTime,
      targetMediaTime: layer.source?.videoElement?.currentTime ?? layer.source?.targetMediaTime,
      previewPath: layer.source?.isLiveInput ? 'live-canvas' : layer.source?.previewPath,
    };
  }
  return null;
}

function collectZeroSizedPlaceholderLayer(layer: Layer): LayerRenderData {
  return {
    layer,
    isVideo: false,
    externalTexture: null,
    textureView: null,
    sourceWidth: 0,
    sourceHeight: 0,
  };
}

export function collectStaticLayerData(
  layer: Layer,
  deps: LayerCollectorDeps
): LayerRenderData | null | undefined {
  const source = layer.source;
  if (!source) {
    return null;
  }

  if (source.canvasElement) {
    return collectCanvasElementLayer(layer, source.canvasElement, deps.textureManager);
  }

  if (source.type === 'image') {
    if (source.imageElement) {
      return collectImageElementLayer(layer, source.imageElement, deps);
    }
    if (source.nestedComposition) {
      const nestedComp = source.nestedComposition;
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: nestedComp.width,
        sourceHeight: nestedComp.height,
      };
    }
    return null;
  }

  if (
    source.type === 'model' ||
    source.type === 'light' ||
    source.type === 'gaussian-avatar' ||
    source.type === 'gaussian-splat' ||
    source.type === 'flock'
  ) {
    return collectZeroSizedPlaceholderLayer(layer);
  }

  if (source.type === 'text' || source.type === 'solid') {
    if (source.textCanvas) {
      return collectCanvasElementLayer(layer, source.textCanvas, deps.textureManager);
    }
    return null;
  }

  if (source.type === 'motion') {
    const geometry = getMotionReplicatorSourceGeometry(source.motion);
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: geometry.sourceBounds.maxX - geometry.sourceBounds.minX,
      sourceHeight: geometry.sourceBounds.maxY - geometry.sourceBounds.minY,
    };
  }

  if (source.type === 'motion-adjustment') {
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: source.intrinsicWidth ?? 0,
      sourceHeight: source.intrinsicHeight ?? 0,
    };
  }

  return undefined;
}
