import common from '../../src/effects/_shared/commonShader';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { holo } from '../../src/effects/analog';
import { createDefaultHoloGraph } from '../../src/services/operators/holoEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 17, height = 13, bytesPerRow = 256;
type Primitive = number | boolean | string;
const cases = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'amount-minimum', params: { amount: 0 }, time: 0 },
  { name: 'amount-maximum', params: { amount: 1 }, time: 0 },
  { name: 'speed-minimum', params: { speed: 0, amount: .67, colorA: '#18313b', colorB: '#51213d' }, time: 1.375 },
  { name: 'speed-maximum', params: { speed: 5, amount: .67, colorA: '#18313b', colorB: '#51213d' }, time: 1.375 },
  { name: 'timeline-muted-colors', params: { speed: 1.65, amount: .73, colorA: '#142936', colorB: '#48203b' }, time: 2.125 },
] as const;

function resolved(overrides: Record<string, Primitive>): Record<string, Primitive> {
  return { ...Object.fromEntries(Object.entries(holo.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function numberAt(values: Record<string, Primitive>, id: string): number {
  const value = values[id];
  if (typeof value !== 'number') throw new Error(`Holo parameter ${id} is not numeric`);
  return value;
}
function legacyUniforms(values: Record<string, Primitive>, time: number): Float32Array<ArrayBuffer> {
  const colorA = colorToRgba(values.colorA, '#22d3ee'), colorB = colorToRgba(values.colorB, '#f472b6');
  return new Float32Array([
    width, height, numberAt(values, 'scale'), numberAt(values, 'amount'), numberAt(values, 'angle'), time,
    numberAt(values, 'speed'), 0, ...colorA, ...colorB,
  ]);
}
function pixels(): Uint8Array {
  const result = new Uint8Array(bytesPerRow * height);
  const cells = [
    [42, 55, 61, 29], [69, 47, 76, 223],
    [51, 72, 43, 151], [78, 58, 66, 251],
  ];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    result.set(cells[(y & 1) * 2 + (x & 1)], y * bytesPerRow + x * 4);
  }
  return result;
}
function compact(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) result.set(data.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  return result;
}
function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniforms: Float32Array<ArrayBuffer> | null): Promise<Uint8Array> {
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
    if (uniforms) {
      uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, uniforms); entries.push({ binding: 2, resource: { buffer: uniform } });
    }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store' },
    ] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = compact(new Uint8Array(readback.getMappedRange())); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) {
    const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error;
  } finally { uniform?.destroy(); }
}

function directGraph(): EffectOperatorGraph {
  const graph = structuredClone(createDefaultHoloGraph());
  const frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error('Holo default graph lacks image boundaries');
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: 'holo-test-direct', from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

export async function checkHoloGraphGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), compactInput = compact(input);
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0, processed: Uint8Array | undefined;
  try {
    for (const item of cases) {
      const values = resolved(item.params), context = { parameterSchema: holo.params };
      const plan = compileImageOperatorGraph(createDefaultHoloGraph(), values, context);
      const expected = await render(device, sampler, source.createView(), target, readback, holo.shader, holo.entryPoint, legacyUniforms(values, item.time));
      const actual = await render(device, sampler, source.createView(), target, readback,
        imageGraphProgramShader(plan, 'holoGraphFragment'), 'holoGraphFragment', packImageOperatorRuntimeUniforms(plan, item.time, width, height));
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      if (item.name === 'timeline-muted-colors') processed = actual;
      comparisons++;
    }
    const values = resolved({ speed: 1.65, amount: .73, colorA: '#142936', colorB: '#48203b' });
    const directPlan = compileImageOperatorGraph(directGraph(), values, { parameterSchema: holo.params });
    const direct = await render(device, sampler, source.createView(), target, readback,
      imageGraphProgramShader(directPlan, 'holoDirectFragment'), 'holoDirectFragment', packImageOperatorRuntimeUniforms(directPlan, 2.125, width, height));
    if (compactInput.some((value, index) => value !== direct[index])) throw new Error(`direct: ${mismatch(compactInput, direct)}`);
    if (!processed || processed.every((value, index) => value === direct[index])) throw new Error('Holo graph did not change the processed output');
    return comparisons + 1;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
