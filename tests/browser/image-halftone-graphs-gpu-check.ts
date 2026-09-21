import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { halftone, patternHalftone } from '../../src/effects/halftone';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultHalftoneGraph, type EditableHalftoneEffectType } from '../../src/services/operators/halftoneEffectGraphs';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 47, height = 29, bytesPerRow = 256;
type Case = { name: string; params: Record<string, number | string> };
type Fixture = { type: EditableHalftoneEffectType; definition: FullscreenEffectDefinition; cases: readonly Case[] };
type Primitive = number | boolean | string;

const commonCases: Case[] = [
  { name: 'defaults', params: {} },
  { name: 'amount-minimum', params: { amount: 0 } },
  { name: 'amount-maximum', params: { amount: 1 } },
  { name: 'scale-minimum', params: { scale: 2, amount: 1 } },
  { name: 'scale-maximum', params: { scale: 80, amount: 1 } },
  { name: 'nonzero-angle', params: { scale: 9.5, amount: .82, angle: 37 } },
];
const fixtures: Fixture[] = [
  { type: 'halftone', definition: halftone as FullscreenEffectDefinition, cases: commonCases },
  { type: 'pattern-halftone', definition: patternHalftone as FullscreenEffectDefinition, cases: [
    ...commonCases, { name: 'shape-circle', params: { shape: 'circle', amount: 1 } },
    { name: 'shape-diamond', params: { shape: 'diamond', amount: 1 } },
    { name: 'shape-line', params: { shape: 'line', amount: 1 } },
  ] },
];

function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, number | string>): Record<string, Primitive> {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}

function pixels(): Uint8Array {
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 31 + y * 11) & 255, (x * 7 + y * 43) & 255,
    (x * 19 + y * 23) & 255, (x * 47 + y * 67) & 255,
  ], y * bytesPerRow + x * 4);
  return data;
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
    if (uniforms) {
      uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, uniforms);
      entries.push({ binding: 2, resource: { buffer: uniform } });
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

function directGraph(type: EditableHalftoneEffectType): EffectOperatorGraph {
  const graph = structuredClone(createDefaultHalftoneGraph(type));
  const frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error(`${type} graph lacks image boundaries`);
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: `${type}-test-direct`, from: frame.id, output: 'image', to: output.id, input: 'image' });
  return graph;
}

function bypassGraph(type: EditableHalftoneEffectType): EffectOperatorGraph {
  const graph = structuredClone(createDefaultHalftoneGraph(type));
  const mixed = graph.nodes.find(node => node.id === 'mixed-color');
  if (!mixed) throw new Error(`${type} graph lacks mixed-color node`);
  mixed.bypassed = true;
  return graph;
}

export async function checkHalftoneGraphsGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), compactInput = compact(input);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  let comparisons = 0;
  try {
    for (const fixture of fixtures) {
      let processed: Uint8Array | undefined;
      for (const item of fixture.cases) {
        const values = resolved(fixture.definition, item.params), context = { parameterSchema: fixture.definition.params };
        const plan = compileImageOperatorGraph(createDefaultHalftoneGraph(fixture.type), values, context);
        const legacyUniforms = fixture.definition.packUniforms(values, width, height, 0);
        if (!legacyUniforms) throw new Error(`${fixture.type} legacy definition did not provide uniforms`);
        const expected = await render(device, sampler, source.createView(), target, readback, fixture.definition.shader,
          fixture.definition.entryPoint, new Float32Array(legacyUniforms));
        const entryPoint = `${fixture.type.replace('-', '')}GraphFragment`;
        const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
          packImageOperatorRuntimeUniforms(plan, 0, width, height));
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${item.name}: ${mismatch(expected, actual)}`);
        if (item.name === 'amount-maximum') processed = actual;
        comparisons++;
      }
      const values = resolved(fixture.definition, { amount: 1, scale: 14 });
      for (const [name, graph] of [['bypass', bypassGraph(fixture.type)], ['direct', directGraph(fixture.type)]] as const) {
        const plan = compileImageOperatorGraph(graph, values, { parameterSchema: fixture.definition.params }), entryPoint = `${fixture.type.replace('-', '')}${name}Fragment`;
        const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
          packImageOperatorRuntimeUniforms(plan, 0, width, height));
        const expected = name === 'bypass' ? processed : compactInput;
        if (!expected) throw new Error(`${fixture.type}/${name}: processed reference is unavailable`);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${name}: ${mismatch(expected, actual)}`);
        comparisons++;
      }
      if (!processed || processed.every((value, index) => value === compactInput[index])) throw new Error(`${fixture.type} processed output did not change`);
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
