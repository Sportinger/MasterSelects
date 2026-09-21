import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { filmPrism } from '../../src/effects/analog';
import { createDefaultFilmPrismGraph } from '../../src/services/operators/filmPrismEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 47, height = 29, bytesPerRow = 256;
const cases = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'amount-minimum', params: { amount: 0 }, time: 0 },
  { name: 'amount-maximum', params: { amount: 1 }, time: 0 },
  { name: 'timeline-speed-a', params: { amount: .83, speed: .35 }, time: 1.375 },
  { name: 'timeline-speed-b', params: { amount: .42, speed: 5 }, time: 4.125 },
] as const;

function params(overrides: Record<string, number>): Record<string, unknown> {
  return { ...Object.fromEntries(Object.entries(filmPrism.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function numberAt(values: Record<string, unknown>, id: string) {
  const value = values[id];
  if (typeof value !== 'number') throw new Error(`Film Prism parameter ${id} is not numeric`);
  return value;
}
function legacyUniforms(values: Record<string, unknown>, time: number) {
  return new Float32Array([width, height, numberAt(values, 'scale'), numberAt(values, 'amount'), numberAt(values, 'angle'), time,
    numberAt(values, 'speed'), 0, 0, 0, 0, 1, 0, 0, 0, 1]);
}
function fixture() {
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 31 + y * 11) & 255, (x * 5 + y * 43) & 255, (x * 19 + y * 17) & 255, (x * 47 + y * 67) & 255,
  ], y * bytesPerRow + x * 4);
  return data;
}
function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniforms: Float32Array<ArrayBuffer> | null) {
  device.pushErrorScope('validation');
  let popped = false, uniform: GPUBuffer | undefined;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` });
    const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (uniforms) { uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, uniforms); entries.push({ binding: 2, resource: { buffer: uniform } }); }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) {
    const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error;
  } finally { uniform?.destroy(); }
}

function directGraph(): EffectOperatorGraph {
  const graph = structuredClone(createDefaultFilmPrismGraph());
  const frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error('Film Prism default graph lacks image boundaries');
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: 'film-prism-test-direct-output', from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

export async function checkFilmPrismGraphGpu(device: GPUDevice): Promise<number> {
  const input = fixture(), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0, processed: Uint8Array | undefined;
  try {
    for (const item of cases) {
      const values = params(item.params), plan = compileImageOperatorGraph(createDefaultFilmPrismGraph(), values);
      const expected = await render(device, sampler, source.createView(), target, readback, filmPrism.shader, filmPrism.entryPoint, legacyUniforms(values, item.time));
      const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, 'filmPrismGraphFragment'),
        'filmPrismGraphFragment', packImageOperatorRuntimeUniforms(plan, item.time, width, height));
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      if (item.name === 'amount-maximum') processed = actual;
      comparisons++;
    }
    const plan = compileImageOperatorGraph(directGraph(), params({ amount: 1, speed: 1 }));
    const direct = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, 'filmPrismDirectFragment'),
      'filmPrismDirectFragment', packImageOperatorRuntimeUniforms(plan, 0, width, height));
    if (input.some((value, index) => value !== direct[index])) throw new Error(`rewired direct output differs from input: ${mismatch(input, direct)}`);
    if (!processed || processed.every((value, index) => value === direct[index])) throw new Error('rewired Film Prism branch did not change processed output');
    return comparisons + 1;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
