import type { EffectsPipeline } from '../../../effects/EffectsPipeline';
import type { ColorPipeline } from '../../color/ColorPipeline';
import type { LayerRenderData } from '../../core/types';
import type { CompositorPipeline } from '../../pipeline/CompositorPipeline';
import type { MaskTextureManager } from '../../texture/MaskTextureManager';
import { getPixelParticleDisintegrateRenderer } from '../../particles/PixelParticleDisintegrateRenderer';
import { splitLayerEffects } from '../layerEffectStack';
import { Logger } from '../../../services/logger';

const log = Logger.create('NestedCompositor');

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
  compositorPipeline: CompositorPipeline;
  effectsPipeline: EffectsPipeline;
  colorPipeline: ColorPipeline | null;
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
}

export function compositeNestedLayers(params: CompositeNestedLayersParams): GPUTexture {
  const {
    layerData,
    device,
    compositionId,
    width,
    height,
    commandEncoder,
    sampler,
    compositorPipeline,
    effectsPipeline,
    colorPipeline,
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
  } = params;

  let readView = nestedPingView;
  let writeView = nestedPongView;

  const clearPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: readView,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  clearPass.end();

  const outputAspect = width / height;
  for (const data of layerData) {
    const layer = data.layer;
    const uniformBuffer = compositorPipeline.getOrCreateUniformBuffer(`nested-${compositionId}-${layer.id}`);
    const sourceAspect = data.sourceWidth / data.sourceHeight;
    const maskLookupId = layer.maskClipId || layer.id;
    const maskInfo = maskTextureManager.getMaskInfo(maskLookupId);
    const hasMask = maskInfo.hasMask;
    const maskTextureView = maskInfo.view;
    const {
      inlineEffects,
      complexEffects,
      renderEffects,
      unsupportedAfterRenderEffect,
    } = splitLayerEffects(layer.effects, skipEffects);
    if (unsupportedAfterRenderEffect?.length) {
      log.warn('Ignoring effects after terminal render effect', {
        layerId: layer.id,
        effects: unsupportedAfterRenderEffect.map((effect) => effect.type),
      });
    }

    compositorPipeline.updateLayerUniforms(
      layer,
      sourceAspect,
      outputAspect,
      hasMask,
      uniformBuffer,
      inlineEffects
    );

    let sourceTextureView = data.textureView;
    let sourceExternalTexture = data.externalTexture;
    let useExternalTexture = data.isVideo && !!data.externalTexture;

    const hasColorCorrection = !!colorPipeline && !skipEffects && !!layer.colorCorrection?.enabled;
    const needsSourcePreprocess =
      hasColorCorrection ||
      !!(complexEffects && complexEffects.length > 0) ||
      !!(renderEffects && renderEffects.length > 0);

    if (needsSourcePreprocess) {
      let copied = false;
      let copiedToTempView = false;
      if (useExternalTexture && sourceExternalTexture) {
        const copyPipeline = compositorPipeline.getExternalCopyPipeline?.();
        const copyBindGroup = copyPipeline
          ? compositorPipeline.createExternalCopyBindGroup?.(
            sampler,
            sourceExternalTexture,
            layer.id
          )
          : null;

        if (copyPipeline && copyBindGroup) {
          const copyPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: effectTempView,
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          copyPass.setPipeline(copyPipeline);
          copyPass.setBindGroup(0, copyBindGroup);
          copyPass.draw(6);
          copyPass.end();
          copied = true;
          copiedToTempView = true;
        }
      } else if (sourceTextureView) {
        copied = true;
      }

      if (copied) {
        if (copiedToTempView) {
          sourceTextureView = effectTempView;
        }
        if (sourceTextureView) {
          sourceExternalTexture = null;
          useExternalTexture = false;

          if (hasColorCorrection) {
            const colorResult = colorPipeline!.applyGrade(
              commandEncoder,
              layer.colorCorrection,
              sampler,
              sourceTextureView,
              effectTempView2,
              `nested-${compositionId}-${layer.id}`
            );
            sourceTextureView = colorResult.finalView;
          }

          if (complexEffects && complexEffects.length > 0) {
            const effectOutput = sourceTextureView === effectTempView
              ? effectTempView2
              : effectTempView;
            const effectResult = effectsPipeline.applyEffects(
              commandEncoder,
              complexEffects,
              sampler,
              sourceTextureView,
              effectOutput,
              effectTempView,
              effectTempView2,
              width,
              height,
              effectTexturePair.pingTexture,
              effectTexturePair.pongTexture
            );
            sourceTextureView = effectResult.finalView;
          }

          if (renderEffects && renderEffects.length > 0) {
            const renderEffect = renderEffects[0];
            const particleAccumulation = sourceTextureView === effectTempView
              ? effectTempView2
              : effectTempView;
            const particleOutput = particleAccumulation === effectTempView
              ? effectTempView2
              : effectTempView;
            try {
              const renderer = getPixelParticleDisintegrateRenderer(device);
              renderer.render({
                commandEncoder,
                sampler,
                sourceView: sourceTextureView,
                accumulationView: particleAccumulation,
                outputView: particleOutput,
                outputWidth: width,
                outputHeight: height,
                effect: renderEffect,
                motionTime: layer.source?.mediaTime ?? motionTime ?? 0,
                quality: particleQuality,
              });
              sourceTextureView = particleOutput;
            } catch (error) {
              log.warn('Nested particle render effect failed; falling back to source texture', {
                layerId: layer.id,
                effectType: renderEffect.type,
                error,
              });
            }
          }
        }
      }
    }

    let pipeline: GPURenderPipeline;
    let bindGroup: GPUBindGroup;

    if (useExternalTexture && sourceExternalTexture) {
      pipeline = compositorPipeline.getExternalCompositePipeline()!;
      bindGroup = compositorPipeline.createExternalCompositeBindGroup(
        sampler,
        readView,
        sourceExternalTexture,
        uniformBuffer,
        maskTextureView
      );
    } else if (sourceTextureView) {
      pipeline = compositorPipeline.getCompositePipeline()!;
      bindGroup = compositorPipeline.createCompositeBindGroup(
        sampler,
        readView,
        sourceTextureView,
        uniformBuffer,
        maskTextureView
      );
    } else {
      continue;
    }

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    [readView, writeView] = [writeView, readView];
  }

  return readView === nestedPingView ? texturePair.pingTexture : texturePair.pongTexture;
}
