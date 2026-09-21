import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { boxBlur } from '../../src/effects/blur/box';
import { gaussianBlur } from '../../src/effects/blur/gaussian';
import { sharpen } from '../../src/effects/stylize/sharpen';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultBoxBlurGraph } from '../../src/services/operators/blurEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const rowPitch = 256;
const definitions = { 'box-blur': boxBlur, 'gaussian-blur': gaussianBlur, sharpen } as const;
const cases = [
  { name: 'box-radius-zero', type: 'box-blur', params: { radius: 0 }, width: 64, height: 37 },
  { name: 'box-radius-under-half', type: 'box-blur', params: { radius: 0.49 }, width: 64, height: 37 },
  { name: 'box-radius-half', type: 'box-blur', params: { radius: 0.5 }, width: 64, height: 37 },
  { name: 'box-default', type: 'box-blur', params: {}, width: 64, height: 37 },
  { name: 'box-max', type: 'box-blur', params: { radius: 20 }, width: 64, height: 37 },
  { name: 'gaussian-radius-zero', type: 'gaussian-blur', params: { radius: 0 }, width: 64, height: 37 },
  { name: 'gaussian-radius-under-half', type: 'gaussian-blur', params: { radius: 0.49 }, width: 64, height: 37 },
  { name: 'gaussian-radius-half', type: 'gaussian-blur', params: { radius: 0.5 }, width: 64, height: 37 },
  { name: 'gaussian-default', type: 'gaussian-blur', params: {}, width: 64, height: 37 },
  { name: 'gaussian-samples-one', type: 'gaussian-blur', params: { radius: 10, samples: 1 }, width: 64, height: 37 },
  { name: 'gaussian-max-small', type: 'gaussian-blur', params: { radius: 50, samples: 64 }, width: 32, height: 19 },
  { name: 'sharpen-default', type: 'sharpen', params: {}, width: 64, height: 37 },
  { name: 'sharpen-amount-zero', type: 'sharpen', params: { amount: 0, radius: 1 }, width: 64, height: 37 },
  { name: 'sharpen-max', type: 'sharpen', params: { amount: 5, radius: 5 }, width: 64, height: 37 },
] as const;

function fixture(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set([(x * 29 + y * 3) % 256, (y * 47 + x * 5) % 256, (x * 11 + y * 17) % 256,
      (x * 13 + y * 19) % 256], y * rowPitch + x * 4);
  }
  return pixels;
}

function mismatchSummary(expected: Uint8Array, actual: Uint8Array, width: number): string {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue;
    if (first < 0) first = index;
    count++;
    maxDelta = Math.max(maxDelta, delta);
  }
  const row = Math.floor(first / rowPitch), column = Math.floor((first % rowPitch) / 4);
  return `byte ${first} (pixel ${column},${row} of width ${width}): expected ${expected[first]}, actual ${actual[first]}; ${count} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let scopePopped = false, uniform: GPUBuffer | undefined;
  const popError = async () => { scopePopped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
    const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = definition.packUniforms(params, width, height, 0)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
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

export async function checkBlurEffectsGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let weightedAlphaCases = 0;
  for (const item of cases) {
    const sourcePixels = fixture(item.width, item.height);
    const source = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const target = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: sourcePixels.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: rowPitch }, [item.width, item.height]);
      const legacy = definitions[item.type] as FullscreenEffectDefinition;
      const params = effectOperatorParams({ type: item.type, params: item.params });
      const graph = imageGraphDefinition({ type: item.type, params }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params, item.width, item.height);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, params, item.width, item.height);
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error(`${item.name} graph differs from registered shader: ${mismatchSummary(expected, actual, item.width)}`);
      }
      if (item.name === 'box-default' || item.name === 'gaussian-default') {
        let alphaWasWeighted = false;
        for (let y = 0; y < item.height && !alphaWasWeighted; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3;
          if (actual[alpha] !== sourcePixels[alpha]) { alphaWasWeighted = true; break; }
        }
        if (!alphaWasWeighted) throw new Error(`${item.name} kept center alpha instead of filtering RGBA`);
        weightedAlphaCases++;
      }
      if (item.name === 'sharpen-default') {
        for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3;
          if (actual[alpha] !== sourcePixels[alpha]) throw new Error(`Sharpen changed center alpha at ${x},${y}`);
        }
      }
      if (item.name === 'box-default') {
        const edited = createDefaultBoxBlurGraph();
        edited.nodes.find(node => node.id === 'one')!.constants = { value: 2 };
        const editedDefinition = imageGraphDefinition({ type: 'box-blur', params, operatorGraph: edited },
          boxBlur as FullscreenEffectDefinition);
        const editedOutput = await render(device, sampler, source.createView(), target, readback, editedDefinition, params, item.width, item.height);
        if (editedOutput.every((value, index) => value === actual[index])) {
          throw new Error('Edited Box Blur texel-step graph did not change actual GPU pixels');
        }
      }
    } finally { source.destroy(); target.destroy(); readback.destroy(); }
  }
  if (weightedAlphaCases !== 2) throw new Error(`Expected two weighted-alpha blur checks, got ${weightedAlphaCases}`);
  return cases.length + 1;
}
