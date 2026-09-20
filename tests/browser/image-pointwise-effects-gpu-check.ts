import common from '../../src/effects/_shared/common.wgsl?raw';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { posterize } from '../../src/effects/stylize/posterize';
import { threshold } from '../../src/effects/stylize/threshold';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const definitions = { threshold, posterize } as const;
const cases = [
  { name: 'threshold-default', type: 'threshold', params: {} },
  { name: 'threshold-equality', type: 'threshold', params: { level: 0 } },
  { name: 'threshold-rec709', type: 'threshold', params: { level: 0.25 } },
  { name: 'posterize-default', type: 'posterize', params: {} },
  { name: 'posterize-white-overflow', type: 'posterize', params: { levels: 3 } },
] as const;

async function render(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  definition: FullscreenEffectDefinition,
  params: Record<string, number>,
): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  let uniform: GPUBuffer | undefined;
  if (definition.uniformSize > 0) {
    const packed = definition.packUniforms(params, 64, 1)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    entries.push({ binding: 2, resource: { buffer: uniform } });
  }
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [64, 1]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    return result;
  } finally { uniform?.destroy(); }
}

export async function checkPointwiseEffectsGpu(device: GPUDevice, sampler: GPUSampler): Promise<number> {
  const fixture = new Uint8Array(256);
  const pixels = [[0, 0, 0, 17], [255, 0, 0, 31], [255, 255, 255, 63], [0, 255, 0, 127]];
  for (let index = 0; index < 64; index++) fixture.set(pixels[index % pixels.length], index * 4);
  const source = device.createTexture({ size: [64, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [64, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow: 256 }, [64, 1]);
  try {
    for (const item of cases) {
      const legacy = definitions[item.type] as FullscreenEffectDefinition;
      const graph = imageGraphDefinition({ type: item.type, params: item.params }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, item.params);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, item.params);
      const mismatch = expected.findIndex((value, index) => value !== actual[index]);
      if (mismatch >= 0) throw new Error(`${item.name} graph differs from registered shader at byte ${mismatch}`);
      for (let alpha = 3; alpha < actual.length; alpha += 4) {
        if (actual[alpha] !== fixture[alpha]) throw new Error(`${item.name} changed straight alpha`);
      }
      if (item.name === 'threshold-equality' && actual[0] !== 0) throw new Error('Threshold equality must select black');
      if (item.name === 'threshold-rec709' && actual[4] !== 0) throw new Error('Threshold must use Rec.709 luminance');
      if (item.name === 'posterize-white-overflow' && actual[8] !== 255) throw new Error('Posterize white must clamp at the render target');
    }
    return cases.length;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
