import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { motionBlur } from '../../src/effects/blur/motion';
import { radialBlur } from '../../src/effects/blur/radial';
import { zoomBlur } from '../../src/effects/blur/zoom';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultZoomBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const rowPitch = 256;
const definitions = { 'motion-blur': motionBlur, 'radial-blur': radialBlur, 'zoom-blur': zoomBlur } as const;
const cases = [
  { name: 'motion-zero', type: 'motion-blur', params: { amount: 0 }, width: 64, height: 37 },
  { name: 'motion-under-bypass', type: 'motion-blur', params: { amount: 0.0009 }, width: 64, height: 37 },
  { name: 'motion-at-boundary', type: 'motion-blur', params: { amount: 0.001, samples: 4 }, width: 64, height: 37 },
  { name: 'motion-default', type: 'motion-blur', params: {}, width: 64, height: 37 },
  { name: 'motion-fractional-samples', type: 'motion-blur', params: { amount: 0.12, angle: 1.1, samples: 5.9 }, width: 64, height: 37 },
  { name: 'motion-max', type: 'motion-blur', params: { amount: 0.3, angle: 6.28318, samples: 128 }, width: 32, height: 19 },
  { name: 'radial-zero', type: 'radial-blur', params: { amount: 0 }, width: 64, height: 37 },
  { name: 'radial-under-bypass', type: 'radial-blur', params: { amount: 0.009 }, width: 64, height: 37 },
  { name: 'radial-at-boundary', type: 'radial-blur', params: { amount: 0.01, samples: 4 }, width: 64, height: 37 },
  { name: 'radial-default', type: 'radial-blur', params: {}, width: 64, height: 37 },
  { name: 'radial-fractional-samples', type: 'radial-blur', params: { amount: 1.1, centerX: 0.2, centerY: 0.8, samples: 7.9 }, width: 64, height: 37 },
  { name: 'radial-max', type: 'radial-blur', params: { amount: 2, centerX: 0, centerY: 1, samples: 256 }, width: 32, height: 19 },
  { name: 'zoom-zero', type: 'zoom-blur', params: { amount: 0, samples: 4 }, width: 64, height: 37 },
  { name: 'zoom-default', type: 'zoom-blur', params: {}, width: 64, height: 37 },
  { name: 'zoom-fractional-samples', type: 'zoom-blur', params: { amount: 0.65, centerX: 0.3, centerY: 0.7, samples: 6.9 }, width: 64, height: 37 },
  { name: 'zoom-max', type: 'zoom-blur', params: { amount: 1, centerX: 1, centerY: 0, samples: 256 }, width: 32, height: 19 },
] as const;

function fixture(width: number, height: number) {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set([
    ((x ^ y) & 1) ? 250 : (x * 37 + y * 5) % 256, (x * 11 + y * 97) % 256,
    ((x + y) % 3) ? 3 : 247, (x * 43 + y * 71) % 256,
  ], y * rowPitch + x * 4);
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) { const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue; if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); }
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number) {
  device.pushErrorScope('validation'); let popped = false, uniform: GPUBuffer | undefined;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
    const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = definition.packUniforms(params, width, height, 0)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(`${definition.id}: ${validation.message}`); return result;
  } catch (error) { const validation = popped ? null : await pop();
    if (validation) throw new Error(`${definition.id}: ${validation.message}`, { cause: error }); throw error;
  } finally { uniform?.destroy(); }
}

export async function checkDirectionalBlurGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let averagedAlpha = 0;
  for (const item of cases) {
    const pixels = fixture(item.width, item.height);
    const source = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const target = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: rowPitch }, [item.width, item.height]);
      const legacy = definitions[item.type] as FullscreenEffectDefinition, params = effectOperatorParams({ type: item.type, params: item.params });
      const graph = imageGraphDefinition({ type: item.type, params }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params, item.width, item.height);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, params, item.width, item.height);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name} graph differs from registered shader: ${mismatch(expected, actual)}`);
      if (item.name.endsWith('-default')) {
        let differs = false;
        for (let y = 0; y < item.height && !differs; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3; if (actual[alpha] !== pixels[alpha]) { differs = true; break; }
        }
        if (!differs) throw new Error(`${item.name} kept center alpha instead of averaging full RGBA`);
        averagedAlpha++;
      }
      if (item.name === 'zoom-default') {
        const edited = createDefaultZoomBlurGraph();
        edited.nodes.find(node => node.id === 'amount-scale')!.constants = { value: 0.25 };
        const editedDefinition = imageGraphDefinition({ type: 'zoom-blur', params, operatorGraph: edited }, zoomBlur as FullscreenEffectDefinition);
        const editedOutput = await render(device, sampler, source.createView(), target, readback, editedDefinition, params, item.width, item.height);
        if (editedOutput.every((value, index) => value === actual[index])) throw new Error('Edited Zoom Blur amount-scale literal did not change actual GPU pixels');
      }
    } finally { source.destroy(); target.destroy(); readback.destroy(); }
  }
  if (averagedAlpha !== 3) throw new Error(`Expected three full-RGBA alpha checks, got ${averagedAlpha}`);
  return cases.length + 1;
}
