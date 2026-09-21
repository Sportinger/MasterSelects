import common from '../../src/effects/_shared/common.wgsl?raw';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { mirror } from '../../src/effects/distort/mirror';
import { pixelate } from '../../src/effects/distort/pixelate';
import { rgbSplit } from '../../src/effects/distort/rgb-split';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultPixelateGraph } from '../../src/services/operators/samplingEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const width = 64, height = 37, bytesPerRow = width * 4;
const definitions = { pixelate, mirror, 'rgb-split': rgbSplit } as const;
const cases = [
  { name: 'pixelate-min', type: 'pixelate', params: { size: 1 } },
  { name: 'pixelate-default', type: 'pixelate', params: {} },
  { name: 'pixelate-max', type: 'pixelate', params: { size: 64 } },
  { name: 'mirror-none', type: 'mirror', params: { horizontal: false, vertical: false } },
  { name: 'mirror-horizontal', type: 'mirror', params: { horizontal: true, vertical: false } },
  { name: 'mirror-vertical', type: 'mirror', params: { horizontal: false, vertical: true } },
  { name: 'mirror-both', type: 'mirror', params: { horizontal: true, vertical: true } },
  { name: 'rgb-split-zero', type: 'rgb-split', params: { amount: 0, angle: 0 } },
  { name: 'rgb-split-default', type: 'rgb-split', params: {} },
  { name: 'rgb-split-angle', type: 'rgb-split', params: { amount: 0.037, angle: Math.PI / 3 } },
  { name: 'rgb-split-max', type: 'rgb-split', params: { amount: 0.1, angle: 6.28318 } },
] as const;

const upstreamPixelateReference: FullscreenEffectDefinition = {
  ...pixelate,
  id: 'pixelate-upstream-reference',
  shader: `
struct PixelateParams { pixelSize: f32, width: f32, height: f32, _p: f32, };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelateParams;
@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixel = vec2f(params.pixelSize / params.width, params.pixelSize / params.height);
  let uv = floor(input.uv / pixel) * pixel + pixel * 0.5;
  let sampled = textureSample(inputTex, texSampler, uv);
  return vec4f(sampled.rgb + vec3f(0.1), sampled.a);
}`,
};

function pixelateWithUpstreamRgbOffset() {
  const graph = createDefaultPixelateGraph();
  graph.edges = graph.edges.filter(edge => !(edge.from === 'frame' && edge.to === 'sample' && edge.input === 'image'));
  graph.nodes.push(
    { id: 'upstream-split', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
    { id: 'upstream-offset', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.1 } },
    { id: 'upstream-splat', operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} },
    { id: 'upstream-add', operator: 'math.add.rgb', operatorVersion: 1, bindings: {} },
    { id: 'upstream-combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
  );
  graph.edges.push(
    { id: 'upstream-frame-split', from: 'frame', output: 'image', to: 'upstream-split', input: 'image' },
    { id: 'upstream-offset-splat', from: 'upstream-offset', output: 'value', to: 'upstream-splat', input: 'value' },
    { id: 'upstream-split-add', from: 'upstream-split', output: 'rgb', to: 'upstream-add', input: 'a' },
    { id: 'upstream-splat-add', from: 'upstream-splat', output: 'rgb', to: 'upstream-add', input: 'b' },
    { id: 'upstream-add-combine', from: 'upstream-add', output: 'value', to: 'upstream-combine', input: 'rgb' },
    { id: 'upstream-alpha-combine', from: 'upstream-split', output: 'alpha', to: 'upstream-combine', input: 'alpha' },
    { id: 'upstream-combine-sample', from: 'upstream-combine', output: 'image', to: 'sample', input: 'image' },
  );
  return graph;
}

function mismatchSummary(expected: Uint8Array, actual: Uint8Array): string {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue;
    if (first < 0) first = index;
    count++;
    maxDelta = Math.max(maxDelta, delta);
  }
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture,
  readback: GPUBuffer, definition: FullscreenEffectDefinition, params: Record<string, unknown>): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let scopePopped = false, uniform: GPUBuffer | undefined;
  const popError = async () => { scopePopped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
    const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (definition.uniformSize > 0) {
      const packed = definition.packUniforms(params, width, height, 0)!;
      uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
      entries.push({ binding: 2, resource: { buffer: uniform } });
    }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
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

export async function checkSamplingEffectsGpu(device: GPUDevice, sampler: GPUSampler): Promise<number> {
  const fixture = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    fixture.set([(x * 29 + y * 3) % 256, (y * 47 + x * 5) % 256, (x * 11 + y * 17) % 256, (x + y) % 7 ? 211 : 0], index);
  }
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: fixture.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, fixture, { bytesPerRow }, [width, height]);
  try {
    let comparisons = 0;
    const compare = async (item: typeof cases[number], activeSampler: GPUSampler, suffix = '') => {
      const legacy = definitions[item.type] as FullscreenEffectDefinition;
      const params = effectOperatorParams({ type: item.type, params: item.params });
      const graph = imageGraphDefinition({ type: item.type, params }, legacy);
      const expected = await render(device, activeSampler, source.createView(), target, readback, legacy, params);
      const actual = await render(device, activeSampler, source.createView(), target, readback, graph, params);
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error(`${item.name}${suffix} graph differs from registered shader: ${mismatchSummary(expected, actual)}`);
      }
      comparisons++;
    };
    for (const item of cases) await compare(item, sampler);
    const linearSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    await compare(cases.find(item => item.name === 'pixelate-default')!, linearSampler, '-linear');
    await compare(cases.find(item => item.name === 'rgb-split-angle')!, linearSampler, '-linear');
    const upstreamParams = effectOperatorParams({ type: 'pixelate', params: {} });
    const upstreamGraph = imageGraphDefinition({ type: 'pixelate', params: upstreamParams,
      operatorGraph: pixelateWithUpstreamRgbOffset() }, pixelate as FullscreenEffectDefinition);
    const upstreamExpected = await render(device, sampler, source.createView(), target, readback, upstreamPixelateReference, upstreamParams);
    const upstreamActual = await render(device, sampler, source.createView(), target, readback, upstreamGraph, upstreamParams);
    if (upstreamExpected.some((value, index) => value !== upstreamActual[index])) {
      throw new Error(`pixelate upstream-expression graph differs from independent WGSL: ${mismatchSummary(upstreamExpected, upstreamActual)}`);
    }
    comparisons++;
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
