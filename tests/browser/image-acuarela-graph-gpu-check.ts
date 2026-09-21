import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { acuarela } from '../../src/effects/stylize/acuarela';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';

const rowPitch = 256;
const definition = acuarela as FullscreenEffectDefinition;
const defaults = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
const numericBounds = (bound: 'min' | 'max') => Object.fromEntries(['opacity', 'gain', 'speed', 'detail', 'strength', 'density', 'gainX', 'gainY']
  .map(id => [id, definition.params[id][bound]]));
const cases = [
  { name: 'default', params: {}, time: .75 },
  { name: 'zero-strength', params: { strength: 0 }, time: 1.5 },
  { name: 'minimums', params: numericBounds('min'), time: 0 },
  { name: 'maximums', params: numericBounds('max'), time: 2.25 },
] as const;

function pixels(width: number, height: number, history = false) {
  const data = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(history ? [
    (x * 71 + y * 19 + 43) & 255, (x * 11 + y * 97 + 17) & 255,
    (x * 149 + y * 23 + 91) & 255, (x * 37 + y * 61 + 29) & 255,
  ] : [
    (x * 37 + y * 13 + 7) & 255, (x * 17 + y * 83 + 31) & 255,
    (x * 109 + y * 29 + 3) & 255, (x * 43 + y * 67 + 11) & 255,
  ], y * rowPitch + x * 4);
  return data;
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

async function renderDefinition(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, history: GPUTextureView | undefined,
  target: GPUTexture, readback: GPUBuffer, effect: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number, time: number) {
  const module = device.createShaderModule({ code: `${common}\n${effect.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: effect.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = effect.packUniforms(params, width, height, time), uniform = packed
    ? device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : undefined;
  if (packed && uniform) device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  if (uniform) entries.push({ binding: 2, resource: { buffer: uniform } });
  if (history) entries.push({ binding: 3, resource: history });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  const result = await read(device, encoder, target, readback, width, height); uniform?.destroy(); return result;
}

export async function checkAcuarelaGraphGpu(device: GPUDevice): Promise<number> {
  const width = 17, height = 13, sourceBytes = pixels(width, height), historyBytes = pixels(width, height, true);
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const history = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: rowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device); let comparisons = 0;
  device.queue.writeTexture({ texture: source }, sourceBytes, { bytesPerRow: rowPitch }, [width, height]);
  device.queue.writeTexture({ texture: history }, historyBytes, { bytesPerRow: rowPitch }, [width, height]);
  try {
    for (const item of cases) {
      const params = { ...defaults, ...item.params }, graph = createDefaultAcuarelaGraph();
      const plan = compileImageOperatorGraph(graph, params, { parameterSchema: definition.params, allowFrameHistory: true });
      if (plan.passes?.length) throw new Error(`${item.name}: Acuarela unexpectedly compiled to multiple passes`);
      if (!plan.resourceInputs?.includes('effect-history')) throw new Error(`${item.name}: missing effect-history resource`);
      const expected = await renderDefinition(device, sampler, source.createView(), history.createView(), target, readback, definition, params, width, height, item.time);
      const encoder = device.createCommandEncoder();
      runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height, timelineTimeSeconds: item.time,
        plan, outputView: target.createView(), instanceId: `acuarela-${item.name}`,
        externalResources: new Map([['effect-history', { view: history.createView(), identity: `history-${item.name}` }]]) });
      const actual = await read(device, encoder, target, readback, width, height);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      comparisons++;
    }

    const graph = createDefaultAcuarelaGraph(), outputEdge = graph.edges.find(edge => edge.to === 'output' && edge.input === 'image');
    if (!outputEdge) throw new Error('Acuarela output edge is unavailable for direct rewire');
    outputEdge.from = 'source'; outputEdge.output = 'image';
    const params = { ...defaults }, plan = compileImageOperatorGraph(graph, params, { parameterSchema: definition.params, allowFrameHistory: true });
    const directDefinition: FullscreenEffectDefinition = { ...definition, usesFeedback: false,
      shader: imageGraphProgramShader(plan, definition.entryPoint),
      packUniforms: (_params, outputWidth, outputHeight) => packImageOperatorRuntimeUniforms(plan, 0, outputWidth, outputHeight) };
    const direct = await renderDefinition(device, sampler, source.createView(), undefined, target, readback, directDefinition, params, width, height, 0);
    if (sourceBytes.some((value, index) => value !== direct[index])) throw new Error(`direct-rewire: ${mismatch(sourceBytes, direct)}`);
    if (plan.resourceInputs?.length) throw new Error('Direct Acuarela rewire retained unreachable history resource');
    comparisons++;
    return comparisons;
  } finally { runtime.dispose(); source.destroy(); history.destroy(); target.destroy(); readback.destroy(); }
}
