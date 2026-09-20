import common from '../../src/effects/_shared/common.wgsl?raw';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { vignette } from '../../src/effects/stylize/vignette';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const width = 64, height = 32, bytesPerRow = width * 4;
const cases = [
  { name: 'default', params: {} },
  { name: 'nondefault', params: { amount: 0.82, size: 0.28, softness: 0.17, roundness: 1.65 } },
] as const;

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture,
  readback: GPUBuffer, definition: FullscreenEffectDefinition, params: Record<string, number>, legacy: boolean): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  let uniform: GPUBuffer | undefined;
  if (legacy) {
    const packed = definition.packUniforms(params, width, height)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    entries.push({ binding: 2, resource: { buffer: uniform } });
  }
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap(); return result;
  } finally { uniform?.destroy(); }
}

export async function checkVignetteGpu(device: GPUDevice, sampler: GPUSampler): Promise<number> {
  const fixture = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * bytesPerRow + x * 4;
    fixture.set([80 + (x % 32), 140 + (y % 32), 210, (x * 7 + y * 11) % 256], offset);
  }
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: fixture.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow }, [width, height]);
  try {
    for (const item of cases) {
      const graph = imageGraphDefinition({ type: 'vignette', params: item.params }, vignette as FullscreenEffectDefinition);
      const expected = await render(device, sampler, source.createView(), target, readback, vignette as FullscreenEffectDefinition, item.params, true);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, item.params, false);
      const mismatch = expected.findIndex((value, index) => value !== actual[index]);
      if (mismatch >= 0) throw new Error(`Vignette ${item.name} graph differs from registered shader at byte ${mismatch}`);
      for (let alpha = 3; alpha < actual.length; alpha += 4) {
        if (actual[alpha] !== fixture[alpha]) throw new Error(`Vignette ${item.name} changed straight alpha`);
      }
      if (actual[0] >= fixture[0]) throw new Error(`Vignette ${item.name} did not darken a corner`);
    }
    return cases.length;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
