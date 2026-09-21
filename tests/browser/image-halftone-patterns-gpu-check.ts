import common from '../../src/effects/_shared/commonShader';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { crossStitch, driftLines, glitchGrid, scatterMosaic, toneGeometry } from '../../src/effects/halftone';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultCrossStitchGraph } from '../../src/services/operators/crossStitchEffectGraph';
import { createDefaultMotionHalftoneGraph, type EditableMotionHalftoneEffectType } from '../../src/services/operators/motionHalftoneEffectGraphs';
import { createDefaultToneGeometryGraph } from '../../src/services/operators/toneGeometryEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 47, height = 29, bytesPerRow = 256;
type PatternType = 'tone-geometry' | 'cross-stitch' | EditableMotionHalftoneEffectType;
type Primitive = number | boolean | string;
type Case = { name: string; params: Record<string, Primitive>; time: number };
type Fixture = { type: PatternType; definition: FullscreenEffectDefinition; factory: () => EffectOperatorGraph; cases: readonly Case[] };
const base = (minimum: number, maximum: number): Case[] => [
  { name: 'defaults', params: {}, time: 0 }, { name: 'amount-minimum', params: { amount: 0 }, time: 0 },
  { name: 'amount-maximum', params: { amount: 1 }, time: 0 }, { name: 'scale-minimum', params: { scale: minimum, amount: 1 }, time: 0 },
  { name: 'scale-maximum', params: { scale: maximum, amount: 1 }, time: 0 },
];
const animated = (minimum: number, maximum: number): Case[] => [...base(minimum, maximum),
  { name: 'speed-minimum', params: { speed: 0, amount: .83 }, time: 1.25 },
  { name: 'speed-maximum', params: { speed: 5, amount: .83 }, time: 1.25 },
  { name: 'timeline', params: { speed: 1.65, amount: .83, scale: 9.5 }, time: 2.375 },
];
const fixtures: Fixture[] = [
  { type: 'tone-geometry', definition: toneGeometry as FullscreenEffectDefinition, factory: createDefaultToneGeometryGraph, cases: [
    ...animated(2, 80), { name: 'shape-square', params: { shape: 'square', amount: 1 }, time: .75 },
    { name: 'shape-circle', params: { shape: 'circle', amount: 1 }, time: .75 },
    { name: 'shape-triangle', params: { shape: 'triangle', amount: 1 }, time: .75 },
  ] },
  { type: 'cross-stitch', definition: crossStitch as FullscreenEffectDefinition, factory: createDefaultCrossStitchGraph, cases: base(4, 40) },
  { type: 'glitch-grid', definition: glitchGrid as FullscreenEffectDefinition, factory: () => createDefaultMotionHalftoneGraph('glitch-grid'), cases: animated(2, 80) },
  { type: 'scatter-mosaic', definition: scatterMosaic as FullscreenEffectDefinition, factory: () => createDefaultMotionHalftoneGraph('scatter-mosaic'), cases: animated(2, 80) },
  { type: 'drift-lines', definition: driftLines as FullscreenEffectDefinition, factory: () => createDefaultMotionHalftoneGraph('drift-lines'), cases: animated(2, 80) },
];
function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, Primitive>): Record<string, Primitive> {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function numberAt(values: Record<string, Primitive>, id: string, fallback = 0) { const value = values[id]; return typeof value === 'number' ? value : fallback; }
function legacyUniforms(values: Record<string, Primitive>, time: number) {
  const variants: Record<string, number> = { square: 0, circle: 1, triangle: 2 };
  const colorA = colorToRgba(values.colorA, '#111827'), colorB = colorToRgba(values.colorB, '#f8fafc');
  return new Float32Array([width, height, numberAt(values, 'scale', 14), numberAt(values, 'amount', .75), numberAt(values, 'angle'), time,
    numberAt(values, 'speed'), typeof values.shape === 'string' ? variants[values.shape] ?? 0 : 0, ...colorA, ...colorB]);
}
function pixels() { const data = new Uint8Array(bytesPerRow * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
  (x * 31 + y * 11) & 255, (x * 7 + y * 43) & 255, (x * 19 + y * 23) & 255, (x * 47 + y * 67) & 255,
], y * bytesPerRow + x * 4); return data; }
function compact(data: Uint8Array) { const result = new Uint8Array(width * height * 4); for (let y = 0; y < height; y++) result.set(data.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4); return result; }
function mismatch(expected: Uint8Array, actual: Uint8Array) { let first = -1, count = 0, maximum = 0; expected.forEach((value, index) => {
  const delta = Math.abs(value - actual[index]); if (!delta) return; if (first < 0) first = index; count++; maximum = Math.max(maximum, delta); });
return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`; }

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniforms: Float32Array<ArrayBuffer> | null) {
  device.pushErrorScope('validation'); let popped = false, uniform: GPUBuffer | undefined; const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${shader}` }), errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (uniforms) { uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(uniform, 0, uniforms); entries.push({ binding: 2, resource: { buffer: uniform } }); }
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const result = compact(new Uint8Array(readback.getMappedRange())); readback.unmap(); const validation = await pop();
    if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; } finally { uniform?.destroy(); }
}
function directGraph(fixture: Fixture) { const graph = structuredClone(fixture.factory()), frame = graph.nodes.find(node => node.operator === 'image.frame');
  const output = graph.nodes.find(node => node.operator === 'image.output'); if (!frame || !output) throw new Error(`${fixture.type} graph lacks image boundaries`);
  graph.edges = graph.edges.filter(edge => edge.to !== output.id); graph.edges.push({ id: `${fixture.type}-test-direct`, from: frame.id, output: 'image', to: output.id, input: 'image' }); return graph; }

export async function checkHalftonePatternsGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), compactInput = compact(input), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]); let comparisons = 0;
  try {
    for (const fixture of fixtures) {
      let sampledAlphaObserved = false;
      for (const item of fixture.cases) {
        const values = resolved(fixture.definition, item.params), plan = compileImageOperatorGraph(fixture.factory(), values, { parameterSchema: fixture.definition.params });
        const expected = await render(device, sampler, source.createView(), target, readback, fixture.definition.shader, fixture.definition.entryPoint, legacyUniforms(values, item.time));
        const entryPoint = `${fixture.type.replace('-', '')}GraphFragment`, actual = await render(device, sampler, source.createView(), target, readback,
          imageGraphProgramShader(plan, entryPoint), entryPoint, packImageOperatorRuntimeUniforms(plan, item.time, width, height));
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${item.name}: ${mismatch(expected, actual)}`);
        sampledAlphaObserved ||= actual.some((value, index) => index % 4 === 3 && value !== compactInput[index]); comparisons++;
      }
      if (fixture.type === 'glitch-grid' || fixture.type === 'scatter-mosaic' || fixture.type === 'drift-lines') {
        if (!sampledAlphaObserved) throw new Error(`${fixture.type} cases provided no displaced-alpha evidence`);
      }
      const values = resolved(fixture.definition, {}), plan = compileImageOperatorGraph(directGraph(fixture), values, { parameterSchema: fixture.definition.params });
      const entryPoint = `${fixture.type.replace('-', '')}DirectFragment`, direct = await render(device, sampler, source.createView(), target, readback,
        imageGraphProgramShader(plan, entryPoint), entryPoint, packImageOperatorRuntimeUniforms(plan, 0, width, height));
      if (compactInput.some((value, index) => value !== direct[index])) throw new Error(`${fixture.type}/direct: ${mismatch(compactInput, direct)}`); comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
