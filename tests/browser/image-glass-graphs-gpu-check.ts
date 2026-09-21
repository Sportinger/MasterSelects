import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { crystal, glassDispersion } from '../../src/effects/analog';
import { createDefaultCrystalGraph } from '../../src/services/operators/crystalEffectGraph';
import { createDefaultGlassDispersionGraph } from '../../src/services/operators/glassDispersionEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const width = 47, height = 29, bytesPerRow = 256;
const cases = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'amount-minimum', params: { amount: 0 }, time: 0 },
  { name: 'amount-maximum', params: { amount: 1 }, time: 0 },
  { name: 'scale-minimum', params: { scale: 2, amount: 1 }, time: 0 },
  { name: 'scale-maximum', params: { scale: 80, amount: 1 }, time: 0 },
  { name: 'timeline-speed', params: { scale: 9.5, amount: .83, speed: 3.25 }, time: 1.375 },
] as const;
type Factory = () => EffectOperatorGraph;
type Fixture = { name: string; definition: FullscreenEffectDefinition; factory: Factory };
const fixtures: Fixture[] = [
  { name: 'crystal', definition: crystal as FullscreenEffectDefinition, factory: createDefaultCrystalGraph },
  { name: 'glass-dispersion', definition: glassDispersion as FullscreenEffectDefinition, factory: createDefaultGlassDispersionGraph },
];

function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, number>): Record<string, unknown> {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function numberAt(values: Record<string, unknown>, id: string) {
  const value = values[id];
  if (typeof value !== 'number') throw new Error(`${id} is not numeric`);
  return value;
}
function legacyUniforms(values: Record<string, unknown>, time: number) {
  return new Float32Array([width, height, numberAt(values, 'scale'), numberAt(values, 'amount'), numberAt(values, 'angle'), time,
    numberAt(values, 'speed'), 0, 0, 0, 0, 1, 0, 0, 0, 1]);
}
function pixels() {
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
function directGraph(factory: Factory, name: string) {
  const graph = structuredClone(factory());
  const frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error(`${name} default graph lacks image boundaries`);
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: `${name}-test-direct-output`, from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

export async function checkGlassGraphsGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0;
  try {
    for (const fixture of fixtures) {
      let processed: Uint8Array | undefined;
      for (const item of cases) {
        const values = resolved(fixture.definition, item.params), plan = compileImageOperatorGraph(fixture.factory(), values);
        const expected = await render(device, sampler, source.createView(), target, readback, fixture.definition.shader, fixture.definition.entryPoint, legacyUniforms(values, item.time));
        const entryPoint = `${fixture.name.replace('-', '')}GraphFragment`;
        const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
          packImageOperatorRuntimeUniforms(plan, item.time, width, height));
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.name}/${item.name}: ${mismatch(expected, actual)}`);
        if (item.name === 'amount-maximum') processed = actual;
        comparisons++;
      }
      const plan = compileImageOperatorGraph(directGraph(fixture.factory, fixture.name), resolved(fixture.definition, { amount: 1, scale: 14, speed: 1 }));
      const entryPoint = `${fixture.name.replace('-', '')}DirectFragment`;
      const direct = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
        packImageOperatorRuntimeUniforms(plan, 0, width, height));
      if (input.some((value, index) => value !== direct[index])) throw new Error(`${fixture.name} direct output: ${mismatch(input, direct)}`);
      if (!processed || processed.every((value, index) => value === direct[index])) throw new Error(`${fixture.name} rewire did not change processed output`);
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
