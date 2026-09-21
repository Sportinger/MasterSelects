import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { blockify, blockMosaic } from '../../src/effects/pixel';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultBlockifyGraph } from '../../src/services/operators/blockEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const width = 64, height = 37, bytesPerRow = width * 4;
const definitions = { blockify, 'block-mosaic': blockMosaic } as const;
const cases = [
  { name: 'blockify-default', type: 'blockify', params: {}, time: 0 },
  { name: 'blockify-min', type: 'blockify', params: { scale: 2, amount: 1 }, time: 0 },
  { name: 'blockify-max', type: 'blockify', params: { scale: 96, amount: 1 }, time: 0 },
  { name: 'blockify-amount-zero', type: 'blockify', params: { scale: 16, amount: 0 }, time: 0 },
  { name: 'blockify-amount-one', type: 'blockify', params: { scale: 16, amount: 1 }, time: 0 },
  { name: 'mosaic-default-t0', type: 'block-mosaic', params: {}, time: 0 },
  { name: 'mosaic-default-t1', type: 'block-mosaic', params: {}, time: 1.25 },
  { name: 'mosaic-amount-zero', type: 'block-mosaic', params: { scale: 22, amount: 0, speed: 1 }, time: 1.25 },
  { name: 'mosaic-min-custom', type: 'block-mosaic', params: { scale: 4, amount: 1, speed: 2, colorA: '#33669980', colorB: '#f0c04040' }, time: 1.25 },
  { name: 'mosaic-max-custom', type: 'block-mosaic', params: { scale: 120, amount: 1, speed: 0.5, colorA: '#ef7a2299', colorB: '#102030cc' }, time: 1.25 },
] as const;

function mismatchSummary(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue;
    if (first < 0) first = index;
    count++;
    maxDelta = Math.max(maxDelta, delta);
  }
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, time: number): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let scopePopped = false, uniform: GPUBuffer | undefined;
  const popError = async () => { scopePopped = true; return device.popErrorScope(); };
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
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await popError();
    if (validation) throw new Error(`${definition.id}: ${validation.message}`);
    return result;
  } catch (error) {
    const validation = scopePopped ? null : await popError();
    if (validation) throw new Error(`${definition.id}: ${validation.message}`, { cause: error });
    throw error;
  } finally { uniform?.destroy(); }
}

export async function checkBlockEffectsGpu(device: GPUDevice, sampler: GPUSampler): Promise<number> {
  const fixture = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    fixture.set([(x * 29 + y * 3) % 256, (y * 47 + x * 5) % 256, (x * 11 + y * 17) % 256, (x * 13 + y * 19) % 256], index);
  }
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: fixture.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow }, [width, height]);
  const outputs = new Map<string, Uint8Array>();
  try {
    for (const item of cases) {
      const legacy = definitions[item.type] as FullscreenEffectDefinition;
      const params = effectOperatorParams({ type: item.type, params: item.params });
      const graph = imageGraphDefinition({ type: item.type, params }, legacy, item.time);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params, item.time);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, params, item.time);
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error(`${item.name} graph differs from registered shader: ${mismatchSummary(expected, actual)}`);
      }
      outputs.set(item.name, actual);
      if (item.name === 'mosaic-min-custom') {
        const repeated = await render(device, sampler, source.createView(), target, readback, graph, params, item.time);
        if (actual.some((value, index) => value !== repeated[index])) throw new Error('Block Mosaic is not deterministic at identical composition time');
      }
    }
    if (outputs.get('mosaic-default-t0')!.every((value, index) => value === outputs.get('mosaic-default-t1')![index])) {
      throw new Error('Block Mosaic ignored explicit composition-time seek');
    }
    const direct = createDefaultBlockifyGraph();
    direct.edges = direct.edges.filter(edge => edge.to !== 'output');
    direct.edges.push({ id: 'edited-direct-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    const directParams = effectOperatorParams({ type: 'blockify', params: {} });
    const directDefinition = imageGraphDefinition({ type: 'blockify', params: directParams, operatorGraph: direct },
      blockify as FullscreenEffectDefinition);
    const directOutput = await render(device, sampler, source.createView(), target, readback, directDefinition, directParams, 0);
    if (fixture.some((value, index) => value !== directOutput[index])) {
      throw new Error(`edited Blockify direct branch differs from source: ${mismatchSummary(fixture, directOutput)}`);
    }
    return cases.length + 1;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
