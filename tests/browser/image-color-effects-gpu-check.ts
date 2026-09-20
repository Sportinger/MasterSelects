import common from '../../src/effects/_shared/common.wgsl?raw';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { exposure } from '../../src/effects/color/exposure';
import { hueShift } from '../../src/effects/color/hue-shift';
import { levels } from '../../src/effects/color/levels';
import { temperature } from '../../src/effects/color/temperature';
import { vibrance } from '../../src/effects/color/vibrance';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const effects = { exposure, levels, 'hue-shift': hueShift, temperature, vibrance } as const;
type EffectType = keyof typeof effects;

const cases: Array<{ type: EffectType; params: Record<string, number> }> = [
  { type: 'exposure', params: {} },
  { type: 'exposure', params: { exposure: 1.4, offset: -0.12, gamma: 0.7 } },
  { type: 'levels', params: {} },
  { type: 'levels', params: { inputBlack: 0.99, inputWhite: 1, gamma: 0.1, outputBlack: 0.85, outputWhite: 0.15 } },
  { type: 'hue-shift', params: {} },
  { type: 'hue-shift', params: { shift: 0.93 } },
  { type: 'temperature', params: {} },
  { type: 'temperature', params: { temperature: 0.85, tint: -0.7 } },
  { type: 'vibrance', params: {} },
  { type: 'vibrance', params: { amount: 1 } },
];

async function renderDefinition(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  definition: FullscreenEffectDefinition,
  params: Record<string, number>,
  size: number,
): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] },
  });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  let uniform: GPUBuffer | undefined;
  if (definition.uniformSize > 0) {
    const packed = definition.packUniforms(params, size, 1)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    entries.push({ binding: 2, resource: { buffer: uniform } });
  }
  try {
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target },
      { buffer: readback, bytesPerRow: size * 4 }, [size, 1]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    return bytes;
  } finally { uniform?.destroy(); }
}

export async function checkRemainingColorEffectsGpu(
  device: GPUDevice,
  sampler: GPUSampler,
  fixture: Uint8Array,
  size: number,
): Promise<number> {
  const source = device.createTexture({ size: [size, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [size, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow: size * 4 }, [size, 1]);
  let comparisons = 0;
  try {
    for (const item of cases) {
      const legacy = effects[item.type] as FullscreenEffectDefinition;
      const graph = imageGraphDefinition({ type: item.type, params: item.params }, legacy);
      const legacyBytes = await renderDefinition(device, sampler, source.createView(), target, readback,
        legacy, item.params, size);
      const graphBytes = await renderDefinition(device, sampler, source.createView(), target, readback,
        graph, item.params, size);
      const mismatch = legacyBytes.findIndex((value, index) => value !== graphBytes[index]);
      if (mismatch >= 0) throw new Error(`${item.type} graph differs from registered shader at byte ${mismatch}`);
      for (let offset = 3; offset < graphBytes.length; offset += 4) {
        if (graphBytes[offset] !== fixture[offset]) throw new Error(`${item.type} graph changed straight alpha`);
      }
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
