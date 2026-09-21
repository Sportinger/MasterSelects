import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { crtScreen } from '../../src/effects/analog';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import { createDefaultCrtScreenGraph } from '../../src/services/operators/crtScreenEffectGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 64;
const height = 37;
const bytesPerRow = width * 4;

const cases = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'amount-zero', params: { amount: 0 }, time: 0 },
  { name: 'scale-minimum', params: { scale: 1, amount: 1 }, time: 0 },
  { name: 'scale-maximum', params: { scale: 12, amount: 1 }, time: 0 },
  { name: 'timeline-speed', params: { scale: 5, amount: .86, speed: 2.35 }, time: 1.375 },
] as const;

function resolvedParams(overrides: Record<string, number>): Record<string, unknown> {
  return { ...Object.fromEntries(Object.entries(crtScreen.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}

function numeric(params: Record<string, unknown>, id: string): number {
  const value = params[id];
  if (typeof value !== 'number') throw new Error(`CRT Screen parameter ${id} is not numeric`);
  return value;
}

function packLegacy(params: Record<string, unknown>, time: number): Float32Array {
  return new Float32Array([
    width, height, numeric(params, 'scale'), numeric(params, 'amount'), numeric(params, 'angle'), time, numeric(params, 'speed'), 0,
    0, 0, 0, 1, 0, 0, 0, 1,
  ]);
}

function fixture(): Uint8Array {
  const result = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    result.set([
      (x * 29 + y * 7) & 255,
      (x * 3 + y * 47) & 255,
      (x * 17 + y * 13) & 255,
      (x * 43 + y * 71) & 255,
    ], (y * width + x) * 4);
  }
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => {
    const delta = Math.abs(value - actual[index]);
    if (!delta) return;
    if (first < 0) first = index;
    count++;
    maximum = Math.max(maximum, delta);
  });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}

async function render(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  shader: string,
  entryPoint: string,
  uniforms: Float32Array | null,
): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let popped = false;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  let uniform: GPUBuffer | undefined;
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] },
    });
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sampler },
      { binding: 1, resource: source },
    ];
    if (uniforms) {
      uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, uniforms);
      entries.push({ binding: 2, resource: { buffer: uniform } });
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
    pass.draw(6);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    const validation = await pop();
    if (validation) throw new Error(validation.message);
    return result;
  } catch (error) {
    const validation = popped ? null : await pop();
    if (validation) throw new Error(validation.message, { cause: error });
    throw error;
  } finally {
    uniform?.destroy();
  }
}

function directGraph(): EffectOperatorGraph {
  const graph = structuredClone(createDefaultCrtScreenGraph());
  graph.edges = graph.edges.filter(edge => !graph.nodes.some(node => node.operator === 'image.output' && node.id === edge.to));
  const frame = graph.nodes.find(node => node.operator === 'image.frame');
  const output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error('CRT Screen default graph lacks image boundaries');
  graph.edges.push({ id: 'crt-test-direct-output', from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

export async function checkCrtScreenGraphGpu(device: GPUDevice): Promise<number> {
  const input = fixture();
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0;
  let processedStrong: Uint8Array | undefined;
  try {
    for (const item of cases) {
      const params = resolvedParams(item.params);
      const plan = compileImageOperatorGraph(createDefaultCrtScreenGraph(), params);
      const expected = await render(device, sampler, source.createView(), target, readback,
        crtScreen.shader, crtScreen.entryPoint, packLegacy(params, item.time));
      const actual = await render(device, sampler, source.createView(), target, readback,
        imageGraphProgramShader(plan, 'crtScreenGraphFragment'), 'crtScreenGraphFragment',
        packImageOperatorRuntimeUniforms(plan, item.time, width, height));
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      }
      if (item.name === 'amount-zero') for (let index = 3; index < actual.length; index += 4) {
        if (actual[index] !== input[index]) throw new Error(`amount-zero: alpha changed at pixel ${Math.floor(index / 4)}`);
      }
      if (item.name === 'scale-minimum') processedStrong = actual;
      comparisons++;
    }

    const params = resolvedParams({ amount: 1, scale: 3, speed: 1 });
    const plan = compileImageOperatorGraph(directGraph(), params);
    const direct = await render(device, sampler, source.createView(), target, readback,
      imageGraphProgramShader(plan, 'crtScreenDirectFragment'), 'crtScreenDirectFragment',
      packImageOperatorRuntimeUniforms(plan, 0, width, height));
    if (input.some((value, index) => value !== direct[index])) throw new Error(`rewired direct output differs from input: ${mismatch(input, direct)}`);
    if (!processedStrong || processedStrong.every((value, index) => value === direct[index])) {
      throw new Error('rewired CRT Screen branch did not change the processed output');
    }
    comparisons++;
    return comparisons;
  } finally {
    source.destroy();
    target.destroy();
    readback.destroy();
  }
}
