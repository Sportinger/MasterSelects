import { getRenderableImageBlob } from './rawImageDecode';
import { lensCorrection } from '../../effects/distort/lens-correction';
import { guidedPerspective } from '../../effects/distort/guided-perspective';
import commonShader from '../../effects/_shared/commonShader';
import type { Effect } from '../../types/effects';
import { isFullscreenEffectDefinition } from '../../effects/types';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import { renderSoftwareGuidePhoto } from './lensPhotoSoftware';

/** Bounded still-image guide canvas uses exactly the preceding lens shader. */
export async function createGuidedPhotoPreview(file: File, lensEffects: Effect[], maxDimension = 1600): Promise<{ blob: Blob; aspect: number; sourceWidth: number; sourceHeight: number }> {
  if (lensEffects.some(effect => !['lens-correction', 'guided-perspective'].includes(effect.type))) {
    throw new Error('Photo capture supports Lens Correction and Guided Perspective. Place other effects after AI Edge Fill.');
  }
  let bitmap = await createImageBitmap(await getRenderableImageBlob(file));
  const aspect = bitmap.width / bitmap.height;
  const dimensions = { sourceWidth: bitmap.width, sourceHeight: bitmap.height };
  const resize = Math.min(1, Math.min(4096, Math.max(256, maxDimension)) / Math.max(bitmap.width, bitmap.height));
  if (resize < 1) {
    const smaller = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * resize), resizeHeight: Math.round(bitmap.height * resize), resizeQuality: 'high' });
    bitmap.close(); bitmap = smaller;
  }
  if (prefersSoftwareTimelineCanvas() || typeof OffscreenCanvas === 'undefined') {
    try { return { blob: await renderSoftwareGuidePhoto(bitmap, lensEffects), aspect, ...dimensions }; }
    finally { bitmap.close(); }
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  if (!lensEffects.length) {
    try { canvas.getContext('2d')!.drawImage(bitmap, 0, 0); return { blob: await canvas.convertToBlob(), aspect, ...dimensions }; }
    finally { bitmap.close(); }
  }
  let ownedDevice: GPUDevice | undefined;
  const resources: Array<GPUTexture | GPUBuffer> = [];
  let context: GPUCanvasContext | null = null;
  try {
    const { renderHostPort } = await import('../render/renderHostPort');
    let device = renderHostPort.getDevice();
    if (!device) {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('WebGPU is needed to show the lens-corrected guide image.');
      ownedDevice = await adapter.requestDevice(); device = ownedDevice;
    }
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('Guide image canvas unavailable.');
    context.configure({ device, format: 'rgba8unorm', alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
    const texture = () => {
      const result = device!.createTexture({ size: [bitmap.width, bitmap.height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
      resources.push(result); return result;
    };
    let input = texture();
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: input }, [bitmap.width, bitmap.height]);
    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const encoder = device.createCommandEncoder();
    for (const effect of lensEffects) {
      const definition = effect.type === 'guided-perspective' ? guidedPerspective : lensCorrection;
      if (!isFullscreenEffectDefinition(definition)) throw new Error('Photo shader unavailable.');
      const module = device.createShaderModule({ code: `${commonShader}\n${definition.shader}` });
      const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
      const uniforms = definition.packUniforms({ ...effect.params as Record<string, number | boolean | string>, sourceAspect: aspect }, bitmap.width, bitmap.height)!;
      const buffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      resources.push(buffer); device.queue.writeBuffer(buffer, 0, uniforms.buffer);
      const output = texture();
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sampler }, { binding: 1, resource: input.createView() }, { binding: 2, resource: { buffer } },
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end(); input = output;
    }
    encoder.copyTextureToTexture({ texture: input }, { texture: context.getCurrentTexture() }, [bitmap.width, bitmap.height]);
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    return { blob: await canvas.convertToBlob(), aspect, ...dimensions };
  } catch {
    return { blob: await renderSoftwareGuidePhoto(bitmap, lensEffects), aspect, ...dimensions };
  } finally {
    bitmap.close(); context?.unconfigure(); resources.forEach(resource => resource.destroy()); ownedDevice?.destroy();
  }
}
