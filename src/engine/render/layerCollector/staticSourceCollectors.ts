import type { Layer, LayerRenderData } from '../../core/types';
import { getMotionRenderSize } from '../../motion/MotionTypes';
import type { LayerCollectorDeps } from '../LayerCollector';

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

function collectTextCanvasLayer(
  layer: Layer,
  canvas: HTMLCanvasElement,
  deps: LayerCollectorDeps
): LayerRenderData | null {
  const texture = deps.textureManager.createCanvasTexture(canvas);
  if (texture) {
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: deps.textureManager.getImageView(texture),
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
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
    source.type === 'gaussian-splat'
  ) {
    return collectZeroSizedPlaceholderLayer(layer);
  }

  if (source.type === 'text' || source.type === 'solid') {
    if (source.textCanvas) {
      return collectTextCanvasLayer(layer, source.textCanvas, deps);
    }
    return null;
  }

  if (source.type === 'motion') {
    const size = getMotionRenderSize(source.motion);
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: size.width,
      sourceHeight: size.height,
    };
  }

  return undefined;
}
