import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { grain } from '../../src/effects/stylize/grain';
import { scanlines } from '../../src/effects/stylize/scanlines';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const width = 64, height = 32, bytesPerRow = width * 4;
const definitions = { scanlines, grain } as const;
const cases = [
  { name: 'scanlines-default', type: 'scanlines', params: {}, time: 0 },
  { name: 'scanlines-moving-a', type: 'scanlines', params: { density: 8, opacity: 0.65, speed: 2 }, time: 0.5 },
  { name: 'scanlines-moving-b', type: 'scanlines', params: { density: 8, opacity: 0.65, speed: 2 }, time: 2 },
  { name: 'grain-default', type: 'grain', params: {}, time: 0 },
  { name: 'grain-seeded-a', type: 'grain', params: { amount: 0.12, size: 1.4, speed: 1.5, seed: 17 }, time: 1.25 },
  { name: 'grain-seeded-b', type: 'grain', params: { amount: 0.32, size: 1.4, speed: 1.5, seed: 17 }, time: 1.25 },
  { name: 'grain-seek', type: 'grain', params: { amount: 0.32, size: 1.4, speed: 1.5, seed: 17 }, time: 2.5 },
] as const;

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture,
  readback: GPUBuffer, definition: FullscreenEffectDefinition, params: Record<string, number>, time: number): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let errorScopePopped = false;
  let uniform: GPUBuffer | undefined;
  const popValidationError = async (): Promise<GPUError | null> => {
    errorScopePopped = true;
    return device.popErrorScope();
  };
  try {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  if (definition.uniformSize > 0) {
    const packed = definition.packUniforms(params, width, height, time)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    entries.push({ binding: 2, resource: { buffer: uniform } });
  }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validationError = await popValidationError();
    if (validationError) throw new Error(`WebGPU validation failed for ${definition.id}: ${validationError.message}`);
    return result;
  } catch (error) {
    const validationError = errorScopePopped ? null : await popValidationError();
    if (validationError) throw new Error(`WebGPU validation failed for ${definition.id}: ${validationError.message}`, { cause: error });
    throw error;
  } finally { uniform?.destroy(); }
}

function describePixelMismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, differing = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (delta === 0) continue;
    if (first < 0) first = index;
    differing++;
    maxDelta = Math.max(maxDelta, delta);
  }
  return `byte ${first} (expected ${expected[first]}, actual ${actual[first]}), ${differing}/${expected.length} bytes differ, max delta ${maxDelta}`;
}

export async function checkTimeEffectsGpu(device: GPUDevice, sampler: GPUSampler): Promise<number> {
  const fixture = new Uint8Array(bytesPerRow * height);
  for (let index = 0; index < width * height; index++) fixture.set([70 + index % 90, 130, 205, index % 5 === 0 ? 0 : (index * 13) % 256], index * 4);
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: fixture.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow }, [width, height]);
  const outputs = new Map<string, Uint8Array>(), graphIds = new Map<string, string>();
  try {
    for (const item of cases) {
      const legacy = definitions[item.type] as FullscreenEffectDefinition;
      const graph = imageGraphDefinition({ type: item.type, params: item.params }, legacy, item.time);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, item.params, item.time);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, item.params, item.time);
      const mismatch = expected.findIndex((value, index) => value !== actual[index]);
      if (mismatch >= 0) throw new Error(`${item.name} graph differs from registered shader: ${describePixelMismatch(expected, actual)}`);
      for (let alpha = 3; alpha < actual.length; alpha += 4) if (actual[alpha] !== fixture[alpha]) throw new Error(`${item.name} changed straight alpha`);
      outputs.set(item.name, actual); graphIds.set(item.name, graph.id);
      if (item.name === 'grain-seeded-a') {
        const repeat = await render(device, sampler, source.createView(), target, readback, graph, item.params, item.time);
        if (repeat.some((value, index) => value !== actual[index])) throw new Error('Seeded Grain is not deterministic at identical composition time');
      }
    }
    const equal = (a: Uint8Array, b: Uint8Array) => a.every((value, index) => value === b[index]);
    if (equal(outputs.get('scanlines-moving-a')!, outputs.get('scanlines-moving-b')!)) throw new Error('Scanlines ignored composition time');
    if (equal(outputs.get('grain-seeded-b')!, outputs.get('grain-seek')!)) throw new Error('Grain ignored composition-time seek');
    if (equal(outputs.get('grain-seeded-a')!, outputs.get('grain-seeded-b')!)) throw new Error('Grain bound amount edit did not change pixels');
    if (graphIds.get('grain-seeded-a') !== graphIds.get('grain-seeded-b')) throw new Error('Grain bound amount edit changed structural pipeline key');
    return cases.length;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
