import {
  createMaskTextureRasterKey,
  generateMaskTexture,
} from '../../../utils/maskRenderer';
import type { LayerRenderData } from '../../core/types';
import type { MaskTextureManager } from '../../texture/MaskTextureManager';
import type { Compositor } from '../Compositor';
import type { EffectRenderClockContext } from '../../../effects/_shared/byteTexture';

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
  referenceWidth: number;
  referenceHeight: number;
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
  effectRenderClock?: EffectRenderClockContext;
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
    if (maskTextureManager.hasMaskTexture(maskClipId)) {
      maskTextureManager.removeMaskTexture(maskClipId);
    }
    return;
  }

  maskTextureManager.markFrameScopedMaskTexture(maskClipId);

  const version = createMaskTextureRasterKey(masks, width, height);
  if (maskTextureManager.hasMaskTextureVersion(maskClipId, version)) {
    return;
  }
  maskTextureManager.setMaskTextureVersion(maskClipId, version);

  const imageData = maskTextureManager.getOrCreateMaskRaster(
    version,
    () => generateMaskTexture(masks, width, height),
  );
  if (imageData) {
    maskTextureManager.updateMaskTexture(maskClipId, imageData);
  } else {
    maskTextureManager.removeMaskTexture(maskClipId);
  }
}

export function compositeNestedLayers(params: CompositeNestedLayersParams): GPUTexture {
  const {
    layerData,
    device,
    width,
    height,
    referenceWidth,
    referenceHeight,
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
    effectRenderClock,
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
    referenceWidth,
    referenceHeight,
    skipEffects,
    effectTempTexture: effectTexturePair.pingTexture,
    effectTempView,
    effectTempTexture2: effectTexturePair.pongTexture,
    effectTempView2,
    motionTime,
    particleQuality,
    resourceNamespace,
    effectRenderClock,
  });

  return result.finalView === nestedPingView
    ? texturePair.pingTexture
    : texturePair.pongTexture;
}
