import type { BlendMode } from '../../types/blendMode';
import type { Layer } from '../../types/layers';
import type { WorkerGpuVideoFramePresentLayer } from './workerGpuVideoFrameLayerPresenter';

type WorkerGpuVideoFrameSource = WorkerGpuVideoFramePresentLayer['frame'];

function positiveInteger(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 0;
}

export function isWorkerGpuImageBitmapFrame(
  frame: WorkerGpuVideoFrameSource,
): frame is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap;
}

export function getWorkerGpuVideoFrameDimensions(
  frame: WorkerGpuVideoFrameSource,
): { width: number; height: number } | null {
  const image = frame as Partial<ImageBitmap & VideoFrame>;
  const width = positiveInteger(image.displayWidth)
    || positiveInteger(image.codedWidth)
    || positiveInteger(image.width);
  const height = positiveInteger(image.displayHeight)
    || positiveInteger(image.codedHeight)
    || positiveInteger(image.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

function fallbackRenderLayer(layer: WorkerGpuVideoFramePresentLayer): Layer {
  return {
    id: `worker-gpu:${layer.timestampSeconds ?? 'frame'}`,
    name: 'Worker GPU Video',
    visible: true,
    opacity: layer.opacity,
    blendMode: layer.blendMode as BlendMode,
    source: {
      type: 'video',
      mediaTime: layer.timestampSeconds ?? 0,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

export function buildWorkerGpuRenderLayer(
  layer: WorkerGpuVideoFramePresentLayer,
): Layer {
  const renderLayer = layer.renderLayer;
  if (!renderLayer) return fallbackRenderLayer(layer);
  const mediaTime = layer.mediaTime ?? layer.timestampSeconds ?? 0;
  return {
    id: renderLayer.id,
    name: renderLayer.name,
    sourceClipId: renderLayer.sourceClipId,
    visible: renderLayer.visible,
    opacity: renderLayer.opacity,
    blendMode: renderLayer.blendMode,
    source: {
      type: 'video',
      mediaTime,
      videoRotation: renderLayer.videoRotation,
    },
    effects: renderLayer.effects.map((effect) => ({
      ...effect,
      params: { ...effect.params },
    })),
    colorCorrection: renderLayer.colorCorrection,
    position: { ...renderLayer.position },
    scale: { ...renderLayer.scale },
    rotation: typeof renderLayer.rotation === 'number'
      ? renderLayer.rotation
      : { ...renderLayer.rotation },
    maskFeather: renderLayer.maskFeather,
    maskFeatherQuality: renderLayer.maskFeatherQuality,
    maskInvert: renderLayer.maskInvert,
    maskClipId: renderLayer.maskClipId,
    sourceRect: renderLayer.sourceRect ? { ...renderLayer.sourceRect } : undefined,
    transitionRender: renderLayer.transitionRender
      ? { ...renderLayer.transitionRender }
      : undefined,
  };
}

export function hasCompositorRenderLayer(
  layers: readonly WorkerGpuVideoFramePresentLayer[],
): boolean {
  return layers.some((layer) => !!layer.renderLayer);
}
