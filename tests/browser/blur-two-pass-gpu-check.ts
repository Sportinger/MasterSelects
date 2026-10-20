import common from '../../src/effects/_shared/commonShader';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/** Shared harness for the multi-pass blur checks: the operator graph through ImageGraphPassRuntime
 * against the WGSL reference's pass entry points, chained through rgba16float caches. */
export const ROW_PITCH = 256;

export interface BlurCase { name: string; type: string; params: Record<string, unknown>; width: number; height: number;
  /** Source pixels (ROW_PITCH rows); defaults to `blurFixture`. */
  fixture?: (width: number, height: number) => Uint8Array }

/** Opaque red left of `edge`, fully transparent black from it: a hard alpha edge (text, logos, cutouts). */
export function alphaEdgeFixture(edge: number) {
  return (width: number, height: number): Uint8Array => {
    const result = new Uint8Array(ROW_PITCH * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < Math.min(edge, width); x++) result.set([255, 0, 0, 255], y * ROW_PITCH + x * 4);
    return result;
  };
}

/** Straight colour must stay the edge colour wherever the blur leaves some coverage. */
export function assertCleanAlphaEdge(name: string, actual: Uint8Array, width: number, height: number): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * ROW_PITCH + x * 4;
    if (actual[index + 3] < 8) continue;
    if (actual[index] < 252 || actual[index + 1] > 3 || actual[index + 2] > 3) {
      throw new Error(`${name}: dark or tinted fringe at ${x},${y}: rgba ${[...actual.slice(index, index + 4)].join(',')}`);
    }
  }
}

export function blurFixture(width: number, height: number): Uint8Array {
  const result = new Uint8Array(ROW_PITCH * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set([
    ((x ^ y) & 1) ? 250 : (x * 37 + y * 5) % 256, (x * 11 + y * 97) % 256,
    ((x + y) % 3) ? 3 : 247, (x * 43 + y * 71) % 256,
  ], y * ROW_PITCH + x * 4);
  return result;
}

export function maxDelta(expected: Uint8Array, actual: Uint8Array): number {
  return expected.reduce((largest, value, index) => Math.max(largest, Math.abs(value - actual[index])), 0);
}

export function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, largest = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; largest = Math.max(largest, delta); });
  return `byte ${first} (pixel ${Math.floor((first % ROW_PITCH) / 4)},${Math.floor(first / ROW_PITCH)}): expected ${expected[first]}, actual ${actual[first]}; ${count} differ, max delta ${largest}`;
}

async function read(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, buffer: GPUBuffer, width: number, height: number) {
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: ROW_PITCH }, [width, height]);
  device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(buffer.getMappedRange()).slice(); buffer.unmap(); return result;
}

/** The WGSL reference: each entry but the last into an rgba16float cache that the next one reads, the
 * last into the target. Also builds the registered single-pass entry under the generic effect layout used by prewarm. */
export async function renderReference(device: GPUDevice, sampler: GPUSampler, source: GPUTexture, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number, entries: readonly string[]) {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  // One explicit layout: a stage that does not read the uniforms (the premultiply pass) keeps binding 2.
  const bindGroupLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ layout,
    vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint, targets: [{ format }] } });
  const [registered, ...stages] = await Promise.all([pipeline(definition.entryPoint, 'rgba8unorm'),
    ...entries.map((entry, index) => pipeline(entry, index < entries.length - 1 ? 'rgba16float' : 'rgba8unorm'))]);
  void registered;
  const packed = definition.packUniforms(params as Record<string, number>, width, height, 0)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const caches = stages.slice(0, -1).map(() => device.createTexture({ size: [width, height], format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
  const encoder = device.createCommandEncoder();
  const draw = (stage: GPURenderPipeline, input: GPUTexture, output: GPUTexture) => {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(stage); pass.setBindGroup(0, device.createBindGroup({ layout: bindGroupLayout, entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: input.createView() }, { binding: 2, resource: { buffer: uniform } }] }));
    pass.draw(6); pass.end();
  };
  stages.forEach((stage, index) => draw(stage, index ? caches[index - 1] : source, caches[index] ?? target));
  try { return await read(device, encoder, target, readback, width, height); }
  finally { uniform.destroy(); caches.forEach(cache => cache.destroy()); }
}

export async function renderGraph(device: GPUDevice, runtime: ImageGraphPassRuntime, sampler: GPUSampler, source: GPUTexture, target: GPUTexture,
  readback: GPUBuffer, effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }, width: number, height: number,
  instanceId: string, passes: number) {
  const graph = effect.operatorGraph ?? effectOperatorGraph(effect);
  const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
  if (plan.passes?.length !== passes) throw new Error(`${instanceId}: ${effect.type} compiled to ${plan.passes?.length ?? 1} passes instead of ${passes}`);
  const encoder = device.createCommandEncoder();
  runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height,
    timelineTimeSeconds: 0, plan, outputView: target.createView(), instanceId });
  return read(device, encoder, target, readback, width, height);
}

/** Runs every case; `extra` may add assertions per case and returns the number it added. */
export async function checkTwoPassBlurs(device: GPUDevice, cases: readonly BlurCase[], definitions: Record<string, FullscreenEffectDefinition>,
  entries: readonly string[], extra?: (item: BlurCase, input: Uint8Array, actual: Uint8Array,
    rerender: (operatorGraph: EffectOperatorGraph) => Promise<Uint8Array>) => Promise<number>): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device); let comparisons = 0;
  device.pushErrorScope('validation'); let popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    for (const item of cases) {
      const input = (item.fixture ?? blurFixture)(item.width, item.height);
      const source = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const target = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        device.queue.writeTexture({ texture: source }, input, { bytesPerRow: ROW_PITCH }, [item.width, item.height]);
        const params = effectOperatorParams({ type: item.type, params: item.params });
        const expected = await renderReference(device, sampler, source, target, readback, definitions[item.type], params, item.width, item.height, entries);
        const actual = await renderGraph(device, runtime, sampler, source, target, readback, { type: item.type, params: item.params }, item.width, item.height,
          `${item.name}`, entries.length);
        // Both keep an rgba16float cache; allow one 8-bit step for float evaluation order.
        if (maxDelta(expected, actual) > 1) throw new Error(`${item.name} graph differs from WGSL reference: ${mismatch(expected, actual)}`);
        comparisons++;
        if (extra) comparisons += await extra(item, input, actual, operatorGraph => renderGraph(device, runtime, sampler, source, target, readback,
          { type: item.type, params: item.params, operatorGraph }, item.width, item.height, `${item.name}-edited`, entries.length));
      } finally { source.destroy(); target.destroy(); readback.destroy(); }
    }
    const validation = await pop(); if (validation) throw new Error(validation.message); return comparisons;
  } catch (error) {
    const validation = popped ? null : await pop();
    if (validation) throw new Error(`Blur WebGPU validation failed: ${validation.message}`, { cause: error }); throw error;
  } finally { runtime.dispose(); }
}
