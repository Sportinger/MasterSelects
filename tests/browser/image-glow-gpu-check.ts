import common from '../../src/effects/_shared/commonShader';
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

/** Independent three-pass reference: shader.wgsl's horizontal, vertical and resolve entry points.
 * Also compiles the registered single-pass entry under the generic effect layout used by prewarm. */
async function renderReference(device: GPUDevice, sampler: GPUSampler, source: GPUTexture, target: GPUTexture, readback: GPUBuffer,
  params: Record<string, unknown>, width: number, height: number) {
  const definition = glow as FullscreenEffectDefinition;
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  // EffectPipelineCache prewarms the registered entry with sampler/texture/uniform only (no binding 3).
  const genericLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [genericLayout] }),
    vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const pipeline = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint, targets: [{ format }] } });
  const [horizontal, vertical, resolve] = await Promise.all([pipeline('glowPrefilterHorizontal', 'rgba16float'),
    pipeline('glowPrefilterVertical', 'rgba16float'), pipeline('glowResolve', 'rgba8unorm')]);
  const packed = definition.packUniforms(params as Record<string, number>, width, height, 0)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const cache = () => device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const first = cache(), second = cache(), encoder = device.createCommandEncoder();
  const base = (input: GPUTexture): GPUBindGroupEntry[] => [{ binding: 0, resource: sampler }, { binding: 1, resource: input.createView() },
    { binding: 2, resource: { buffer: uniform } }];
  const draw = (stage: GPURenderPipeline, output: GPUTexture, entries: GPUBindGroupEntry[]) => {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(stage); pass.setBindGroup(0, device.createBindGroup({ layout: stage.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
  };
  draw(horizontal, first, base(source));
  draw(vertical, second, base(first));
  draw(resolve, target, [...base(source), { binding: 3, resource: second.createView() }]);
  try { return await read(device, encoder, target, readback, width, height); }
  finally { uniform.destroy(); first.destroy(); second.destroy(); }
}

async function renderGraph(device: GPUDevice, runtime: ImageGraphPassRuntime, sampler: GPUSampler, source: GPUTexture, target: GPUTexture,
  readback: GPUBuffer, graph: ReturnType<typeof createDefaultGlowGraph>, params: Record<string, unknown>, width: number, height: number, instanceId: string) {
  const plan = compileImageOperatorGraph(graph, params);
  if (plan.passes?.length !== 3) throw new Error(`${instanceId}: Glow compiled to ${plan.passes?.length ?? 1} passes instead of 3`);
  const encoder = device.createCommandEncoder();
  runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height,
    timelineTimeSeconds: 0, plan, outputView: target.createView(), instanceId });
  return read(device, encoder, target, readback, width, height);
}

function maxDelta(expected: Uint8Array, actual: Uint8Array) {
  return expected.reduce((largest, value, index) => Math.max(largest, Math.abs(value - actual[index])), 0);
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
        const params = effectOperatorParams({ type: 'glow', params: item.params });
        if (item.name === 'default-fractional-counts' && (params.rings !== 6.85 || params.samplesPerRing !== 17.95))
          throw new Error(`Glow owner defaults changed: rings=${params.rings}, samplesPerRing=${params.samplesPerRing}`);
        const expected = await renderReference(device, sampler, source, target, readback, params, item.width, item.height);
        const actual = await renderGraph(device, runtime, sampler, source, target, readback, createDefaultGlowGraph(), params, item.width, item.height, `glow-${item.name}`);
        // Both paths keep rgba16float intermediates; allow one 8-bit step for float evaluation order.
        if (maxDelta(expected, actual) > 1) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
        for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3;
          if (actual[alpha] < input[alpha]) throw new Error(`${item.name}: Glow reduced source alpha at (${x},${y})`);
        }
        comparisons++;
        if (item.name === 'default-fractional-counts') {
          const edited = createDefaultGlowGraph(); edited.nodes.find(node => node.id === 'ten')!.constants = { value: 8 };
          const changed = await renderGraph(device, runtime, sampler, source, target, readback, edited, params, item.width, item.height, 'glow-edited');
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
