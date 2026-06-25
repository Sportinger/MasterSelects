import type { BlendMode, Layer, TimelineClip } from '../../types';
import { getLazyImageElementForClip } from '../timeline/lazyImageElements';
import { textRenderer } from '../textRenderer';
import { getClipTimeInfo } from './FrameContext';
import { withLayerBuilderMaskProperties } from './layerBuilderLayerPostProcessing';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';
import type { LayerBuilderProxyFrameSelection } from './layerBuilderProxyFrames';

type LayerSourceMetadata = {
  mediaFileId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};

type BuildLayer2dParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  opacityOverride?: number;
};

type BuildLayer2dSourceParams = BuildLayer2dParams & {
  localTime: number;
  source: NonNullable<Layer['source']>;
};

function buildLayer2dSource(params: BuildLayer2dSourceParams): Layer {
  const transform = params.transformCache.getTransform(
    `${params.ctx.activeCompId}_${params.layerIndex}`,
    params.ctx.getInterpolatedTransform(params.clip.id, params.localTime),
  );
  const effects = params.ctx.getInterpolatedEffects(params.clip.id, params.localTime);
  const colorCorrection = params.ctx.getInterpolatedColorCorrection(params.clip.id, params.localTime);
  const finalOpacity = params.opacityOverride !== undefined
    ? transform.opacity * params.opacityOverride
    : transform.opacity;

  return withLayerBuilderMaskProperties({
    id: `${params.ctx.activeCompId}_layer_${params.layerIndex}`,
    name: params.clip.name,
    sourceClipId: params.clip.id,
    visible: true,
    opacity: finalOpacity,
    blendMode: transform.blendMode as BlendMode,
    source: params.source,
    effects,
    colorCorrection,
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
  }, params.clip, params.localTime);
}

export function getLayerBuilderRenderableImageElement(
  clip: TimelineClip,
  ctx: FrameContext,
): HTMLImageElement | null {
  return clip.source?.imageElement ?? getLazyImageElementForClip(ctx, clip);
}

export function buildLayerBuilderImageLayer(
  params: BuildLayer2dParams & { imageElement: HTMLImageElement },
): Layer {
  const timeInfo = getClipTimeInfo(params.ctx, params.clip);
  return buildLayer2dSource({
    ...params,
    localTime: timeInfo.clipLocalTime,
    source: { type: 'image', imageElement: params.imageElement },
  });
}

export function buildLayerBuilderProxyImageLayer(
  params: BuildLayer2dParams & {
    image: HTMLImageElement;
    localTime: number;
    sourceMetadata: LayerSourceMetadata;
    timing: LayerBuilderProxyFrameSelection;
  },
): Layer {
  return buildLayer2dSource({
    ...params,
    source: {
      type: 'image',
      imageElement: params.image,
      ...params.sourceMetadata,
      mediaTime: params.timing.displayedMediaTime,
      targetMediaTime: params.timing.targetMediaTime,
      previewPath: params.timing.previewPath,
      proxyFrameIndex: params.timing.proxyFrameIndex,
    },
  });
}

export function buildLayerBuilderTextLayer(
  params: BuildLayer2dParams & { sourceTextCanvas?: HTMLCanvasElement },
): Layer {
  const timeInfo = getClipTimeInfo(params.ctx, params.clip);
  let textCanvas = params.sourceTextCanvas ?? params.clip.source!.textCanvas;
  const interpolatedTextBounds = params.clip.textProperties
    ? params.ctx.getInterpolatedTextBounds(params.clip.id, timeInfo.clipLocalTime)
    : undefined;
  if (params.clip.textProperties && interpolatedTextBounds && textCanvas) {
    const hasBoundsKeyframes =
      params.ctx.hasKeyframes(params.clip.id, 'textBounds.path') ||
      params.ctx.hasKeyframes(params.clip.id, 'textBounds.position.x') ||
      params.ctx.hasKeyframes(params.clip.id, 'textBounds.position.y');
    if (hasBoundsKeyframes) {
      const runtimeCanvas = textRenderer.createCanvas(textCanvas.width, textCanvas.height);
      textRenderer.render({
        ...params.clip.textProperties,
        boxEnabled: true,
        textBounds: interpolatedTextBounds,
      }, runtimeCanvas);
      textCanvas = runtimeCanvas;
    }
  }

  return buildLayer2dSource({
    ...params,
    localTime: timeInfo.clipLocalTime,
    source: { type: 'text', textCanvas },
  });
}

export function buildNestedImageSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  imageElement: HTMLImageElement,
): Layer {
  return {
    ...baseLayer,
    source: { type: 'image', imageElement },
  };
}

export function buildNestedTextSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  textCanvas: HTMLCanvasElement,
): Layer {
  return {
    ...baseLayer,
    source: { type: 'text', textCanvas },
  };
}

export function buildNestedProxyImageSourceLayer(
  baseLayer: Omit<Layer, 'source'>,
  proxyFrame: LayerBuilderProxyFrameSelection,
  mediaFileId: string,
): Layer {
  return {
    ...baseLayer,
    source: {
      type: 'image',
      imageElement: proxyFrame.image,
      mediaFileId,
      intrinsicWidth: proxyFrame.image.naturalWidth || proxyFrame.image.width,
      intrinsicHeight: proxyFrame.image.naturalHeight || proxyFrame.image.height,
      mediaTime: proxyFrame.displayedMediaTime,
      targetMediaTime: proxyFrame.targetMediaTime,
      previewPath: proxyFrame.previewPath,
      proxyFrameIndex: proxyFrame.proxyFrameIndex,
    },
  };
}
