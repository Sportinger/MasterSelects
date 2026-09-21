import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { glow } from '../../src/effects/stylize/glow';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultGlowGraph } from '../../src/services/operators/glowEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';

const rowPitch = 256;
const cases = [
  { name: 'default-fractional-counts', params: {}, width: 47, height: 29 },
  { name: 'minimum-counts', params: { rings: 1, samplesPerRing: 4 }, width: 47, height: 29 },
  { name: 'maximum-counts', params: { rings: 32, samplesPerRing: 64 }, width: 16, height: 11 },
  { name: 'zero-amount', params: { amount: 0 }, width: 47, height: 29 },
  { name: 'maximum-amount', params: { amount: 5 }, width: 47, height: 29 },
  { name: 'zero-threshold-min-radius-softness', params: { threshold: 0, radius: 1, softness: .1 }, width: 47, height: 29 },
  { name: 'maximum-threshold-radius-softness', params: { threshold: 1, radius: 100, softness: 1 }, width: 47, height: 29 },
] as const;

function fixture(width: number, height: number) {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set([
    ((x ^ y) & 3) ? (x * 37 + y * 11) & 255 : 251,
    (x * 13 + y * 83) & 255,
    ((x + y) % 5) ? (x * 97 + y * 7) & 255 : 3,
    (x * 43 + y * 71) & 255,
  ], y * rowPitch + x * 4);
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function read(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, buffer: GPUBuffer, width: number, height: number) {
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowPitch }, [width, height]);
  device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(buffer.getMappedRange()).slice(); buffer.unmap(); return result;
}

async function renderDefinition(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number) {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = definition.packUniforms(params, width, height, 0), uniform = packed
    ? device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : undefined;
  if (packed && uniform) device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  if (uniform) entries.push({ binding: 2, resource: { buffer: uniform } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback, width, height); uniform?.destroy(); return result;
}

export async function checkGlowGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device); let comparisons = 0;
  device.pushErrorScope('validation'); let popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    for (const item of cases) {
      const input = fixture(item.width, item.height);
      const source = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const target = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [item.width, item.height]);
        const params = effectOperatorParams({ type: 'glow', params: item.params }), graph = createDefaultGlowGraph();
        if (item.name === 'default-fractional-counts' && (params.rings !== 6.85 || params.samplesPerRing !== 17.95))
          throw new Error(`Glow owner defaults changed: rings=${params.rings}, samplesPerRing=${params.samplesPerRing}`);
        const plan = compileImageOperatorGraph(graph, params);
        if ((plan.passes?.length ?? 0) > 1) throw new Error(`${item.name}: Glow compiled to ${plan.passes!.length} passes`);
        const expected = await renderDefinition(device, sampler, source.createView(), target, readback, glow as FullscreenEffectDefinition, params, item.width, item.height);
        let actual: Uint8Array;
        if (plan.passes?.length) {
          const encoder = device.createCommandEncoder();
          runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width: item.width, height: item.height,
            timelineTimeSeconds: 0, plan, outputView: target.createView(), instanceId: `glow-${item.name}` });
          actual = await read(device, encoder, target, readback, item.width, item.height);
        } else {
          const definition = imageGraphDefinition({ type: 'glow', params, operatorGraph: graph }, glow as FullscreenEffectDefinition);
          actual = await renderDefinition(device, sampler, source.createView(), target, readback, definition, params, item.width, item.height);
        }
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
        for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3;
          if (actual[alpha] !== input[alpha]) throw new Error(`${item.name}: center alpha differs at (${x},${y})`);
        }
        comparisons++;
        if (item.name === 'default-fractional-counts') {
          const edited = createDefaultGlowGraph(); edited.nodes.find(node => node.id === 'ten')!.constants = { value: 8 };
          const editedDefinition = imageGraphDefinition({ type: 'glow', params, operatorGraph: edited }, glow as FullscreenEffectDefinition);
          const changed = await renderDefinition(device, sampler, source.createView(), target, readback, editedDefinition, params, item.width, item.height);
          if (changed.every((value, index) => value === actual[index])) throw new Error('Edited Glow radius coefficient did not change output');
          comparisons++;
        }
      } finally { source.destroy(); target.destroy(); readback.destroy(); }
    }
    const validation = await pop(); if (validation) throw new Error(validation.message); return comparisons;
  } catch (error) { const validation = popped ? null : await pop();
    if (validation) throw new Error(`Glow WebGPU validation failed: ${validation.message}`, { cause: error }); throw error;
  } finally { runtime.dispose(); }
}
