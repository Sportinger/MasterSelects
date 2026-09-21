import common from '../../src/effects/_shared/commonShader';
import { edgeDetect } from '../../src/effects/stylize/edge-detect';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultEdgeDetectGraph } from '../../src/services/operators/edgeDetectEffectGraph';

const rowPitch = 256, width = 47, height = 29;
const cases = [
  { name: 'default-high-contrast', params: {}, pattern: 'contrast' },
  { name: 'zero-strength', params: { strength: 0 }, pattern: 'contrast' },
  { name: 'fractional-strength', params: { strength: 1.73 }, pattern: 'diagonal' },
  { name: 'maximum-inverted', params: { strength: 5, invert: true }, pattern: 'corner' },
  { name: 'uniform', params: { strength: 2.4 }, pattern: 'uniform' },
  { name: 'uniform-inverted', params: { strength: 2.4, invert: true }, pattern: 'uniform' },
] as const;

function pixels(pattern: typeof cases[number]['pattern']) {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const high = pattern === 'uniform' ? 91 : pattern === 'diagonal' ? (x > y * 1.4 ? 255 : 0)
      : pattern === 'corner' ? (x > width / 2 && y > height / 2 ? 255 : 0) : ((x ^ y) & 4 ? 255 : 0);
    result.set(pattern === 'uniform' ? [91, 91, 91, (x * 31 + y * 47) & 255]
      : [high, (high + x * 19 + y * 7) & 255, 255 - high, (x * 31 + y * 47) & 255], y * rowPitch + x * 4);
  }
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let index = -1, count = 0, maxDelta = 0;
  expected.forEach((value, offset) => { const delta = Math.abs(value - actual[offset]); if (!delta) return;
    if (index < 0) index = offset; count++; maxDelta = Math.max(maxDelta, delta); });
  return index < 0 ? 'none' : `byte ${index}: expected ${expected[index]}, actual ${actual[index]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>) {
  device.pushErrorScope('validation'); let uniform: GPUBuffer | undefined, popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` }), info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = definition.packUniforms(params, width, height, 0)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler },
      { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
  finally { uniform?.destroy(); }
}

export async function checkEdgeDetectGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let comparisons = 0;
  for (const item of cases) {
    const input = pixels(item.pattern), source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]);
      const params = effectOperatorParams({ type: 'edge-detect', params: item.params }), legacy = edgeDetect as FullscreenEffectDefinition;
      const graph = imageGraphDefinition({ type: 'edge-detect', params }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, params);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      for (let y = 0; y < height; y++) for (let x = 3; x < width * 4; x += 4) if (actual[y * rowPitch + x] !== 255) throw new Error(`${item.name}: alpha is not opaque`);
      if (item.name === 'uniform' || item.name === 'uniform-inverted') {
        const expectedChannel = item.name === 'uniform-inverted' ? 255 : 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x += 4) for (let channel = 0; channel < 3; channel++)
          if (actual[y * rowPitch + x + channel] !== expectedChannel) throw new Error(`${item.name}: expected uniform channel ${expectedChannel}`);
      }
      comparisons++;
      if (item.name === 'default-high-contrast') {
        const edited = createDefaultEdgeDetectGraph(); edited.nodes.find(node => node.id === 'two')!.constants = { value: 1.5 };
        const changed = imageGraphDefinition({ type: 'edge-detect', params, operatorGraph: edited }, legacy);
        const output = await render(device, sampler, source.createView(), target, readback, changed, params);
        if (output.every((value, index) => value === actual[index])) throw new Error('Edited Sobel coefficient did not change output');
        comparisons++;
      }
    } finally { source.destroy(); target.destroy(); readback.destroy(); }
  }
  return comparisons;
}
