import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { rom1 } from '../../src/effects/stylize/rom1';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultRom1Graph } from '../../src/services/operators/rom1EffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';

const width = 19, height = 13, bytesPerRow = 256;
const definition = rom1 as FullscreenEffectDefinition;
const defaults = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
const numericBounds = (bound: 'min' | 'max') => Object.fromEntries(
  ['opacity', 'gain', 'speed', 'detail', 'strength', 'density', 'gainX', 'gainY'].map(id => [id, definition.params[id][bound]]),
);
const cases = [
  { name: 'defaults-t0', params: {}, time: 0, history: 'varying' },
  { name: 'defaults-t1', params: {}, time: 1.875, history: 'varying' },
  { name: 'active-minimums', params: { ...numericBounds('min'), opacity: 1 }, time: .625, history: 'varying' },
  { name: 'maximums', params: numericBounds('max'), time: 2.25, history: 'varying' },
  { name: 'zero-strength', params: { strength: 0, opacity: 1 }, time: 1.375, history: 'varying' },
  { name: 'history-raised-alpha', params: { opacity: 1, gain: 0, strength: 0 }, time: .5, history: 'raised-alpha' },
] as const;

function pixels(history: 'source' | 'varying' | 'raised-alpha'): Uint8Array {
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgba = history === 'source'
      ? [(x * 37 + y * 13 + 7) & 255, (x * 17 + y * 83 + 31) & 255, (x * 109 + y * 29 + 3) & 255, (x * 19 + y * 23 + 17) & 127]
      : history === 'raised-alpha'
        ? [(x * 71 + y * 19 + 43) & 255, (x * 11 + y * 97 + 17) & 255, (x * 149 + y * 23 + 91) & 255, 224 + ((x + y) & 31)]
        : [(x * 71 + y * 19 + 43) & 255, (x * 11 + y * 97 + 17) & 255, (x * 149 + y * 23 + 91) & 255, (x * 37 + y * 61 + 29) & 255];
    data.set(rgba, y * bytesPerRow + x * 4);
  }
  return data;
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count += 1; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function read(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, buffer: GPUBuffer): Promise<Uint8Array> {
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(buffer.getMappedRange()).slice();
  buffer.unmap();
  return result;
}

async function renderLegacy(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, history: GPUTextureView,
  target: GPUTexture, readback: GPUBuffer, params: Record<string, unknown>, time: number): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = definition.packUniforms(params, width, height, time)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } }, { binding: 3, resource: history },
  ] });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback); uniform.destroy(); return result;
}

async function renderDirect(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer): Promise<Uint8Array> {
  const graph = createDefaultRom1Graph(), output = graph.nodes.find(node => node.operator === 'image.output'), frame = graph.nodes.find(node => node.operator === 'image.frame');
  if (!output || !frame) throw new Error('ROM1 graph lacks image boundaries.');
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: 'rom1-direct-output', from: frame.id, output: 'image', to: output.id, input: 'image' });
  const plan = compileImageOperatorGraph(graph, defaults, { parameterSchema: definition.params, allowFrameHistory: true });
  if (plan.resourceInputs?.length) throw new Error('Direct ROM1 rewire retained unreachable history.');
  const entryPoint = 'rom1DirectFragment', module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, entryPoint)}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = packImageOperatorRuntimeUniforms(plan, 0, width, height), entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: sampler }, { binding: 1, resource: source },
  ];
  let uniform: GPUBuffer | undefined;
  if (packed) { uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed); entries.push({ binding: 2, resource: { buffer: uniform } }); }
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback); uniform?.destroy(); return result;
}

export async function checkRom1GraphGpu(device: GPUDevice): Promise<number> {
  const sourceBytes = pixels('source'), historyBytes = pixels('varying');
  const textureUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: textureUsage });
  const history = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: textureUsage });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device); let comparisons = 0;
  device.queue.writeTexture({ texture: source }, sourceBytes, { bytesPerRow }, [width, height]);
  try {
    for (const item of cases) {
      const currentHistory = item.history === 'raised-alpha' ? pixels('raised-alpha') : historyBytes;
      device.queue.writeTexture({ texture: history }, currentHistory, { bytesPerRow }, [width, height]);
      const params = { ...defaults, ...item.params };
      const plan = compileImageOperatorGraph(createDefaultRom1Graph(), params, { parameterSchema: definition.params, allowFrameHistory: true });
      if (plan.passes?.length) throw new Error(`${item.name}: ROM1 unexpectedly materialized multiple passes.`);
      if (!plan.resourceInputs?.includes('effect-history')) throw new Error(`${item.name}: ROM1 omitted effect-history.`);
      const expected = await renderLegacy(device, sampler, source.createView(), history.createView(), target, readback, params, item.time);
      const encoder = device.createCommandEncoder();
      runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height, timelineTimeSeconds: item.time,
        plan, outputView: target.createView(), instanceId: `rom1-${item.name}`,
        externalResources: new Map([['effect-history', { view: history.createView(), identity: `history-${item.name}` }]]) });
      const actual = await read(device, encoder, target, readback);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      comparisons += 1;
    }
    const direct = await renderDirect(device, sampler, source.createView(), target, readback);
    if (sourceBytes.some((value, index) => value !== direct[index])) throw new Error(`direct: ${mismatch(sourceBytes, direct)}`);
    return comparisons + 1;
  } finally {
    runtime.dispose(); source.destroy(); history.destroy(); target.destroy(); readback.destroy();
  }
}
