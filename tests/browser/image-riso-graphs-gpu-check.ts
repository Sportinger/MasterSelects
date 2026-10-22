import common from '../../src/effects/_shared/commonShader';
import { parityProblem } from './patternParityTolerance';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { riso, risoGlow } from '../../src/effects/halftone';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultRisoGraph } from '../../src/services/operators/risoEffectGraphs';
import { compileImageOperatorGraph, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 47, height = 29, bytesPerRow = 256;
/** The graph against its twin (patternParityTolerance.ts): measured at most 9 % of bytes one step apart (Riso Glow's glow
 * cache) and 0.6 % of pixels further, by at most 3 steps. */
const CELL_FILTER_PARITY = { oneStep: .1, flipped: .01 };
type RisoType = 'riso' | 'riso-glow';
type Primitive = number | boolean | string;
type Case = { name: string; params: Record<string, Primitive>; time: number };
type Fixture = { type: RisoType; definition: FullscreenEffectDefinition; cases: readonly Case[] };

const baseCases: Case[] = [
  { name: 'defaults', params: {}, time: 0 },
  { name: 'amount-minimum', params: { amount: 0 }, time: 0 },
  { name: 'amount-maximum', params: { amount: 1 }, time: 0 },
  { name: 'muted-colors', params: { amount: .76, scale: 9, colorA: '#24375c', colorB: '#694052' }, time: 0 },
];
const fixtures: Fixture[] = [
  // Riso's print recipe (createRisoPrintGraph): Dot Size reaches the twin through the variant slot (variantParam).
  { type: 'riso', definition: riso as FullscreenEffectDefinition, cases: [
    ...baseCases, { name: 'registration-minimum', params: { scale: 0, amount: 1 }, time: 0 },
    { name: 'registration-maximum', params: { scale: 32, amount: 1 }, time: 0 },
    { name: 'dot-size-minimum', params: { dotSize: 2, amount: 1 }, time: 0 },
    { name: 'dot-size-maximum', params: { dotSize: 40, amount: 1 }, time: 0 },
    { name: 'black-and-white-inks', params: { colorA: '#000000', colorB: '#ffffff', amount: 1 }, time: 0 },
    { name: 'same-inks', params: { colorA: '#ef476f', colorB: '#ef476f', amount: 1 }, time: 0 },
    // The 47 × 29 frame is 1/37 of 1080p: these sizes give cells of about 8 pixels and a slip of 6, as on a real frame.
    { name: 'real-cells', params: { dotSize: 300, scale: 220, amount: 1 }, time: 0 },
  ] },
  // Riso Glow (createRisoGlowGraph): Riso's print cached with the glow share, gathered over 9 × 9 taps (two passes).
  { type: 'riso-glow', definition: risoGlow as FullscreenEffectDefinition, cases: [
    ...baseCases, { name: 'registration-maximum', params: { scale: 32, amount: 1 }, time: 0 },
    { name: 'dot-size-maximum', params: { dotSize: 40, amount: 1 }, time: 0 },
    { name: 'glow-off', params: { glow: 0, amount: 1 }, time: 0 },
    { name: 'glow-maximum', params: { glow: 2, amount: 1 }, time: 0 },
    { name: 'black-and-white-inks', params: { colorA: '#000000', colorB: '#ffffff', amount: 1 }, time: 0 },
    // The 47 × 29 frame is 1/37 of 1080p: these sizes give cells of about 8 pixels and glow taps 6 apart, as on a real frame.
    { name: 'real-cells', params: { dotSize: 300, scale: 220, amount: 1 }, time: 0 },
    { name: 'speed-minimum', params: { speed: 0, amount: .82, colorA: '#24375c', colorB: '#694052' }, time: 1.25 },
    { name: 'speed-maximum', params: { speed: 5, amount: .82, colorA: '#24375c', colorB: '#694052' }, time: 1.25 },
    { name: 'timeline', params: { speed: 1.7, amount: .82, scale: 8.5, colorA: '#24375c', colorB: '#694052' }, time: 2.375 },
  ] },
];

function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, Primitive>): Record<string, Primitive> {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function numberAt(values: Record<string, Primitive>, id: string, fallback = 0): number {
  const value = values[id]; return typeof value === 'number' ? value : fallback;
}
function legacyUniforms(type: RisoType, values: Record<string, Primitive>, time: number): Float32Array<ArrayBuffer> {
  const colorA = colorToRgba(values.colorA, '#111827'), colorB = colorToRgba(values.colorB, '#f8fafc');
  // Riso Glow's twin reads Glow from the Angle slot (createCatalogEffect angleSlotParam).
  return new Float32Array([width, height, numberAt(values, 'scale', 14), numberAt(values, 'amount', .75),
    numberAt(values, type === 'riso-glow' ? 'glow' : 'angle'), time, numberAt(values, 'speed'), numberAt(values, 'dotSize'), ...colorA, ...colorB]);
}
function pixels(): Uint8Array {
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 31 + y * 11) & 255, (x * 7 + y * 43) & 255,
    (x * 19 + y * 23) & 255, (x * 47 + y * 67) & 255,
  ], y * bytesPerRow + x * 4);
  return data;
}
function compact(data: Uint8Array) {
  const result = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) result.set(data.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  return result;
}
function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`;
}
async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniforms: Float32Array<ArrayBuffer> | null) {
  device.pushErrorScope('validation'); let popped = false, uniform: GPUBuffer | undefined;
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
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store' },
    ] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const result = compact(new Uint8Array(readback.getMappedRange())); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error;
  } finally { uniform?.destroy(); }
}
/** A graph plan on the GPU: one generated shader, or the pass runtime for a multi-pass plan (Riso Glow's cache). */
async function renderPlan(device: GPUDevice, runtime: ImageGraphPassRuntime, sampler: GPUSampler, source: GPUTexture, target: GPUTexture,
  readback: GPUBuffer, plan: ImageOperatorPlan, entryPoint: string, time: number) {
  if (!plan.passes?.length) return render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
    packImageOperatorRuntimeUniforms(plan, time, width, height));
  device.pushErrorScope('validation');
  const encoder = device.createCommandEncoder();
  runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height,
    timelineTimeSeconds: time, plan, outputView: target.createView(), instanceId: `riso-${entryPoint}` });
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ); const result = compact(new Uint8Array(readback.getMappedRange())); readback.unmap();
  const validation = await device.popErrorScope(); if (validation) throw new Error(validation.message); return result;
}
function directGraph(type: RisoType): EffectOperatorGraph {
  const graph = structuredClone(createDefaultRisoGraph(type));
  const frame = graph.nodes.find(node => node.operator === 'image.frame'), output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error(`${type} graph lacks image boundaries`);
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: `${type}-test-direct`, from: frame.id, output: 'image', to: output.id, input: 'image' }); return graph;
}
function bypassGraph(type: RisoType): EffectOperatorGraph {
  const graph = structuredClone(createDefaultRisoGraph(type));
  const amount = graph.nodes.find(node => node.operator === 'values.number' && node.bindings?.value === 'amount');
  const mixEdge = amount && graph.edges.find(edge => edge.from === amount.id && edge.input === 't');
  const mix = mixEdge && graph.nodes.find(node => node.id === mixEdge.to && node.operator === 'math.mix.rgb');
  if (!mix) throw new Error(`${type} graph lacks final amount mix`);
  mix.bypassed = true; return graph;
}

export async function checkRisoGraphsGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), compactInput = compact(input);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const runtime = new ImageGraphPassRuntime(device);
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]); let comparisons = 0;
  try {
    for (const fixture of fixtures) {
      let processed: Uint8Array | undefined;
      for (const item of fixture.cases) {
        const values = resolved(fixture.definition, item.params), plan = compileImageOperatorGraph(createDefaultRisoGraph(fixture.type), values,
          { parameterSchema: fixture.definition.params });
        const expected = await render(device, sampler, source.createView(), target, readback, fixture.definition.shader, fixture.definition.entryPoint,
          legacyUniforms(fixture.type, values, item.time));
        const actual = await renderPlan(device, runtime, sampler, source, target, readback, plan, `${fixture.type.replace('-', '')}GraphFragment`, item.time);
        const problem = parityProblem(`${fixture.type}/${item.name}`, expected, actual, CELL_FILTER_PARITY); if (problem) throw new Error(problem);
        if (item.name === 'amount-maximum') processed = actual; comparisons++;
      }
      const values = resolved(fixture.definition, { amount: 1 });
      for (const [name, graph] of [['bypass', bypassGraph(fixture.type)], ['direct', directGraph(fixture.type)]] as const) {
        const plan = compileImageOperatorGraph(graph, values, { parameterSchema: fixture.definition.params });
        const actual = await renderPlan(device, runtime, sampler, source, target, readback, plan, `${fixture.type.replace('-', '')}${name}Fragment`, 0);
        const expected = name === 'bypass' ? processed : compactInput;
        if (!expected) throw new Error(`${fixture.type}/${name}: processed reference unavailable`);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${name}: ${mismatch(expected, actual)}`); comparisons++;
      }
      if (!processed || processed.every((value, index) => value === compactInput[index])) throw new Error(`${fixture.type} processed output did not change`);
    }
    return comparisons;
  } finally { runtime.dispose(); source.destroy(); target.destroy(); readback.destroy(); }
}
