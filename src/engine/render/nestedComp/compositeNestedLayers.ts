import type { ClipMask, MaskVertex } from '../../../types';
import { generateMaskTexture } from '../../../utils/maskRenderer';
import type { LayerRenderData } from '../../core/types';
import type { MaskTextureManager } from '../../texture/MaskTextureManager';
import type { Compositor } from '../Compositor';
const nestedMaskVersions = new Map<string, string>();

interface TexturePairTextures {
  pingTexture: GPUTexture;
  pongTexture: GPUTexture;
}

interface CompositeNestedLayersParams {
  layerData: LayerRenderData[];
  device: GPUDevice;
  compositionId: string;
  width: number;
  height: number;
  commandEncoder: GPUCommandEncoder;
  sampler: GPUSampler;
  compositor: Compositor;
  maskTextureManager: MaskTextureManager;
  skipEffects: boolean;
  texturePair: TexturePairTextures;
  effectTexturePair: TexturePairTextures;
  nestedPingView: GPUTextureView;
  nestedPongView: GPUTextureView;
  effectTempView: GPUTextureView;
  effectTempView2: GPUTextureView;
  motionTime?: number;
  particleQuality?: 'preview' | 'export';
  resourceNamespace?: string;
}

function getMaskShapeHash(masks: readonly ClipMask[]): string {
  return masks.map(mask =>
    `${mask.enabled !== false}|${mask.inverted}|${mask.closed}|${mask.mode}|` +
    `${mask.vertices.map((vertex: MaskVertex) => [
      vertex.x.toFixed(4),
      vertex.y.toFixed(4),
      vertex.handleIn.x.toFixed(4),
      vertex.handleIn.y.toFixed(4),
      vertex.handleOut.x.toFixed(4),
      vertex.handleOut.y.toFixed(4),
    ].join(',')).join(';')}|` +
    `${mask.position.x.toFixed(4)},${mask.position.y.toFixed(4)}|` +
    `${(mask.feather || 0).toFixed(2)}|${mask.featherQuality ?? 50}|` +
    `${Object.entries(mask.edgeFeathers ?? {})
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([edgeId, feather]) => `${edgeId}:${feather.toFixed(2)}`)
      .join(';')}`
  ).join('||');
}

function syncNestedLayerMaskTexture(
  layerData: LayerRenderData,
  width: number,
  height: number,
  maskTextureManager: MaskTextureManager,
): void {
  const { layer } = layerData;
  const maskClipId = layer.maskClipId;
  if (!maskClipId) return;

  const masks = layer.masks?.filter(mask => mask.enabled !== false);
  if (!masks?.length) {
    if (nestedMaskVersions.has(maskClipId)) {
      nestedMaskVersions.delete(maskClipId);
      maskTextureManager.removeMaskTexture(maskClipId);
    }
    return;
  }

  const version = `${width}x${height}|${getMaskShapeHash(masks)}`;
  if (nestedMaskVersions.get(maskClipId) === version && maskTextureManager.hasMaskTexture(maskClipId)) {
    return;
  }
  nestedMaskVersions.set(maskClipId, version);

  const imageData = generateMaskTexture(masks, width, height);
  if (imageData) {
    maskTextureManager.updateMaskTexture(maskClipId, imageData);
  } else {
    nestedMaskVersions.delete(maskClipId);
    maskTextureManager.removeMaskTexture(maskClipId);
  }
}

export function compositeNestedLayers(params: CompositeNestedLayersParams): GPUTexture {
  const {
    layerData,
    device,
    width,
    height,
    commandEncoder,
    sampler,
    compositor,
    maskTextureManager,
    skipEffects,
    texturePair,
    effectTexturePair,
    nestedPingView,
    nestedPongView,
    effectTempView,
    effectTempView2,
    motionTime,
    particleQuality = 'preview',
    resourceNamespace,
  } = params;

  const compositorLayerData = resourceNamespace && layerData.some((data) => data.layer.maskClipId)
    ? layerData.map((data) => (
        data.layer.maskClipId
          ? {
              ...data,
              layer: {
                ...data.layer,
                maskClipId: JSON.stringify([resourceNamespace, data.layer.maskClipId]),
              },
            }
          : data
      ))
    : layerData;

  for (const data of compositorLayerData) {
    syncNestedLayerMaskTexture(data, width, height, maskTextureManager);
  }

  const result = compositor.composite(compositorLayerData, commandEncoder, {
    device,
    sampler,
    pingView: nestedPingView,
    pongView: nestedPongView,
    outputWidth: width,
    outputHeight: height,
    skipEffects,
    effectTempTexture: effectTexturePair.pingTexture,
    effectTempView,
    effectTempTexture2: effectTexturePair.pongTexture,
    effectTempView2,
    motionTime,
    particleQuality,
    resourceNamespace,
  });

  return result.finalView === nestedPingView
    ? texturePair.pingTexture
    : texturePair.pongTexture;
}
