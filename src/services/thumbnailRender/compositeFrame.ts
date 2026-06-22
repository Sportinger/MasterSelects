import { Logger } from '../logger';
import { splitLayerEffects } from '../../engine/render/layerEffectStack';
import { getPixelParticleDisintegrateRenderer } from '../../engine/particles/PixelParticleDisintegrateRenderer';
import type { Layer } from '../../types/layers';
import type { ThumbnailLayerData, ThumbnailRenderTarget, ThumbnailResources } from './contracts';
import { blobToDataURL } from './frameCapture';

const log = Logger.create('ThumbnailRenderer');

interface CompositeLayerOptions {
  uniformId: (layer: Layer) => string;
  maskLookupId: (layer: Layer) => string;
  conversionErrorMessage: string;
}

export async function renderThumbnailLayerData(
  resources: ThumbnailResources,
  target: ThumbnailRenderTarget,
  layerData: ThumbnailLayerData[],
  width: number,
  height: number,
  options: CompositeLayerOptions
): Promise<string | null> {
  const { device, sampler, compositorPipeline, outputPipeline } = resources;

  compositorPipeline.beginFrame();

  const commandEncoder = device.createCommandEncoder();
  let readView = target.pingView;
  let writeView = target.pongView;

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
    const result = renderLayerToTarget(
      resources,
      target,
      commandEncoder,
      data,
      readView,
      writeView,
      outputAspect,
      width,
      height,
      options
    );
    if (!result) continue;
    readView = result.readView;
    writeView = result.writeView;
  }

  outputPipeline.updateResolution(width, height);
  const outputBindGroup = outputPipeline.createOutputBindGroup(sampler, readView);
  outputPipeline.renderToCanvas(commandEncoder, target.canvasContext, outputBindGroup);

  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  try {
    const blob = await target.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
    return await blobToDataURL(blob);
  } catch (e) {
    log.warn(options.conversionErrorMessage, e);
    return null;
  }
}

function renderLayerToTarget(
  resources: ThumbnailResources,
  target: ThumbnailRenderTarget,
  commandEncoder: GPUCommandEncoder,
  data: ThumbnailLayerData,
  readView: GPUTextureView,
  writeView: GPUTextureView,
  outputAspect: number,
  width: number,
  height: number,
  options: CompositeLayerOptions
): { readView: GPUTextureView; writeView: GPUTextureView } | null {
  const { sampler, compositorPipeline, maskTextureManager } = resources;
  const layer = data.layer;
  const uniformBuffer = compositorPipeline.getOrCreateUniformBuffer(options.uniformId(layer));
  const sourceAspect = data.sourceWidth / data.sourceHeight;

  const maskInfo = maskTextureManager.getMaskInfo(options.maskLookupId(layer));
  const { inlineEffects } = splitLayerEffects(layer.effects);
  compositorPipeline.updateLayerUniforms(
    layer,
    sourceAspect,
    outputAspect,
    maskInfo.hasMask,
    uniformBuffer,
    inlineEffects
  );

  const source = applyComplexEffectsIfNeeded(resources, target, commandEncoder, data, width, height);
  if (!source.textureView && !source.externalTexture) {
    return null;
  }

  const composite = createCompositeBinding(resources, sampler, readView, uniformBuffer, maskInfo.view, source);
  if (!composite) {
    return null;
  }

  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
  });
  pass.setPipeline(composite.pipeline);
  pass.setBindGroup(0, composite.bindGroup);
  pass.draw(6);
  pass.end();

  return { readView: writeView, writeView: readView };
}

function applyComplexEffectsIfNeeded(
  resources: ThumbnailResources,
  target: ThumbnailRenderTarget,
  commandEncoder: GPUCommandEncoder,
  data: ThumbnailLayerData,
  width: number,
  height: number
): { textureView: GPUTextureView | null; externalTexture: GPUExternalTexture | null; useExternalTexture: boolean } {
  const { device, sampler, compositorPipeline, effectsPipeline } = resources;
  const {
    complexEffects,
    renderEffects,
    unsupportedAfterRenderEffect,
  } = splitLayerEffects(data.layer.effects);
  let textureView = data.textureView;
  let externalTexture = data.externalTexture;
  let useExternalTexture = data.isVideo && !!data.externalTexture;
  if (unsupportedAfterRenderEffect?.length) {
    log.warn('Ignoring thumbnail effects after terminal render effect', {
      layerId: data.layer.id,
      effects: unsupportedAfterRenderEffect.map((effect) => effect.type),
    });
  }

  const hasComplexEffects = !!complexEffects && complexEffects.length > 0;
  const hasRenderEffects = !!renderEffects && renderEffects.length > 0;
  if (!hasComplexEffects && !hasRenderEffects) {
    return { textureView, externalTexture, useExternalTexture };
  }

  if (useExternalTexture && externalTexture) {
    const copyPipeline = compositorPipeline.getExternalCopyPipeline?.();
    const copyBindGroup = copyPipeline
      ? compositorPipeline.createExternalCopyBindGroup?.(sampler, externalTexture, data.layer.id)
      : null;

    if (copyPipeline && copyBindGroup) {
      copySourceToTemp(commandEncoder, target.effectTempView, copyPipeline, copyBindGroup);
      textureView = target.effectTempView;
      externalTexture = null;
      useExternalTexture = false;
    }
  }

  if (!textureView) {
    return { textureView, externalTexture, useExternalTexture };
  }

  if (hasComplexEffects) {
    const effectOutput = textureView === target.effectTempView
      ? target.effectTempView2
      : target.effectTempView;
    const effectResult = effectsPipeline.applyEffects(
      commandEncoder,
      complexEffects,
      sampler,
      textureView,
      effectOutput,
      target.effectTempView,
      target.effectTempView2,
      width,
      height,
      target.effectTempTexture,
      target.effectTempTexture2
    );

    textureView = effectResult.finalView;
    externalTexture = null;
    useExternalTexture = false;
  }

  if (hasRenderEffects && renderEffects) {
    const renderEffect = renderEffects[0];
    const accumulationView = textureView === target.effectTempView
      ? target.effectTempView2
      : target.effectTempView;
    const outputView = accumulationView === target.effectTempView
      ? target.effectTempView2
      : target.effectTempView;
    try {
      const renderer = getPixelParticleDisintegrateRenderer(device);
      renderer.render({
        commandEncoder,
        sampler,
        sourceView: textureView,
        accumulationView,
        outputView,
        outputWidth: width,
        outputHeight: height,
        effect: renderEffect,
        motionTime: data.layer.source?.mediaTime ?? 0,
        quality: 'preview',
      });

      textureView = outputView;
      externalTexture = null;
      useExternalTexture = false;
    } catch (error) {
      log.warn('Thumbnail particle render effect failed; falling back to source texture', {
        layerId: data.layer.id,
        effectType: renderEffect.type,
        error,
      });
    }
  }

  return { textureView, externalTexture, useExternalTexture };
}

function copySourceToTemp(
  commandEncoder: GPUCommandEncoder,
  effectTempView: GPUTextureView,
  copyPipeline: GPURenderPipeline,
  copyBindGroup: GPUBindGroup
): void {
  const copyPass = commandEncoder.beginRenderPass({
    colorAttachments: [{ view: effectTempView, loadOp: 'clear', storeOp: 'store' }],
  });
  copyPass.setPipeline(copyPipeline);
  copyPass.setBindGroup(0, copyBindGroup);
  copyPass.draw(6);
  copyPass.end();
}

function createCompositeBinding(
  resources: ThumbnailResources,
  sampler: GPUSampler,
  readView: GPUTextureView,
  uniformBuffer: GPUBuffer,
  maskTextureView: GPUTextureView,
  source: { textureView: GPUTextureView | null; externalTexture: GPUExternalTexture | null; useExternalTexture: boolean }
): { pipeline: GPURenderPipeline; bindGroup: GPUBindGroup } | null {
  const { compositorPipeline } = resources;

  if (source.useExternalTexture && source.externalTexture) {
    return {
      pipeline: compositorPipeline.getExternalCompositePipeline()!,
      bindGroup: compositorPipeline.createExternalCompositeBindGroup(
        sampler,
        readView,
        source.externalTexture,
        uniformBuffer,
        maskTextureView
      ),
    };
  }

  if (source.textureView) {
    return {
      pipeline: compositorPipeline.getCompositePipeline()!,
      bindGroup: compositorPipeline.createCompositeBindGroup(
        sampler,
        readView,
        source.textureView,
        uniformBuffer,
        maskTextureView
      ),
    };
  }

  return null;
}
