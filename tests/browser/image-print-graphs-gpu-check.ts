import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { paperPrint, pixelPoster } from '../../src/effects/halftone';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createEarlierPaperPrintGraph } from '../../src/services/operators/paperPrintEffectGraph';
import { createDefaultPaperPrintGraph } from '../../src/services/operators/paperPrintGrainGraph';
import { createDefaultPixelPosterGraph } from '../../src/services/operators/pixelPosterEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 47, height = 29, bytesPerRow = 256;
type PrintType = 'paper-print' | 'paper-print-earlier' | 'pixel-poster';
type Primitive = number | boolean | string;
type Case = { name: string; params: Record<string, Primitive> };
type Fixture = { type: PrintType; definition: FullscreenEffectDefinition; factory: () => EffectOperatorGraph; cases: readonly Case[]; entryPoint?: string };
const amountCases: Case[] = [{ name: 'defaults', params: {} }, { name: 'amount-minimum', params: { amount: 0 } },
  { name: 'amount-maximum', params: { amount: 1 } }];
const fixtures: Fixture[] = [
  // Paper Print's grain print (paperPrintGrainGraph.ts) against its twin paperPrintFragment; 47 × 29 px measures sizes small.
  { type: 'paper-print', definition: paperPrint as FullscreenEffectDefinition, factory: createDefaultPaperPrintGraph, cases: [
    ...amountCases, { name: 'scale-minimum', params: { scale: 1, amount: 1 } }, { name: 'scale-large', params: { scale: 80, amount: 1 } },
    { name: 'scale-below-range', params: { scale: .25, amount: 1 } }, { name: 'texture-none', params: { texture: 0, scale: 30 } },
    { name: 'texture-full', params: { texture: 1, scale: 40 } }, { name: 'texture-below-range', params: { texture: -1, scale: 40 } },
    { name: 'custom-colors', params: { scale: 33, amount: .78, colorA: '#263851', colorB: '#c1aa91' } },
    { name: 'light-ink-dark-paper', params: { scale: 50, colorA: '#eef2f6', colorB: '#1d4c8c' } },
    { name: 'equal-brightness', params: { scale: 50, colorA: '#808080', colorB: '#808080' } },
  ] },
  // The earlier recipe, kept for graph-less saves from before Texture, against paperPrintEarlierFragment.
  { type: 'paper-print-earlier', definition: paperPrint as FullscreenEffectDefinition, factory: createEarlierPaperPrintGraph, entryPoint: 'paperPrintEarlierFragment', cases: [
    ...amountCases, { name: 'scale-minimum', params: { scale: 4, amount: 1 } }, { name: 'scale-maximum', params: { scale: 80, amount: 1 } },
    { name: 'custom-colors', params: { scale: 13, amount: .78, colorA: '#263851', colorB: '#c1aa91' } },
  ] },
  // Block Size counts 1080p pixels, so on 47 × 29 px the default is one pixel: Amount 0 is checked on blocks of 64 (1.7 px).
  { type: 'pixel-poster', definition: pixelPoster as FullscreenEffectDefinition, factory: createDefaultPixelPosterGraph, cases: [
    amountCases[0], { name: 'amount-minimum', params: { amount: 0, scale: 64 } }, amountCases[2], { name: 'scale-minimum', params: { scale: 2, amount: 1 } }, { name: 'scale-maximum', params: { scale: 64, amount: 1 } },
  ] },
];

function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, Primitive>): Record<string, Primitive> {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides };
}
function pixels() {
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([
    (x * 31 + y * 11) & 255, (x * 7 + y * 43) & 255, (x * 19 + y * 23) & 255, (x * 47 + y * 67) & 255,
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
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ); const result = compact(new Uint8Array(readback.getMappedRange())); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error;
  } finally { uniform?.destroy(); }
}
function directGraph(fixture: Fixture) {
  const graph = structuredClone(fixture.factory()), frame = graph.nodes.find(node => node.operator === 'image.frame');
  const output = graph.nodes.find(node => node.operator === 'image.output');
  if (!frame || !output) throw new Error(`${fixture.type} graph lacks image boundaries`);
  graph.edges = graph.edges.filter(edge => edge.to !== output.id);
  graph.edges.push({ id: `${fixture.type}-test-direct`, from: frame.id, output: 'image', to: output.id, input: 'image' }); return graph;
}
function bypassGraph(fixture: Fixture) {
  const graph = structuredClone(fixture.factory());
  const amount = graph.nodes.find(node => node.operator === 'values.number' && node.bindings?.value === 'amount');
  const mixEdge = amount && graph.edges.find(edge => edge.from === amount.id && edge.input === 't');
  const mix = mixEdge && graph.nodes.find(node => node.id === mixEdge.to && node.operator === 'math.mix.rgb');
  if (!mix) throw new Error(`${fixture.type} graph lacks final amount mix`);
  mix.bypassed = true; return graph;
}

export async function checkPrintGraphsGpu(device: GPUDevice): Promise<number> {
  const input = pixels(), compactInput = compact(input), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]); let comparisons = 0;
  try {
    for (const fixture of fixtures) {
      let processed: Uint8Array | undefined, amountZero: Uint8Array | undefined;
      for (const item of fixture.cases) {
        const values = resolved(fixture.definition, item.params), plan = compileImageOperatorGraph(fixture.factory(), values, { parameterSchema: fixture.definition.params });
        const packed = fixture.definition.packUniforms(values, width, height, 0); if (!packed) throw new Error(`${fixture.type} legacy uniforms unavailable`);
        const expected = await render(device, sampler, source.createView(), target, readback, fixture.definition.shader, fixture.entryPoint ?? fixture.definition.entryPoint, new Float32Array(packed));
        const entryPoint = `${fixture.type.replaceAll('-', '')}GraphFragment`, actual = await render(device, sampler, source.createView(), target, readback,
          imageGraphProgramShader(plan, entryPoint), entryPoint, packImageOperatorRuntimeUniforms(plan, 0, width, height));
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${item.name}: ${mismatch(expected, actual)}`);
        if (item.name === 'amount-maximum') processed = actual; if (item.name === 'amount-minimum') amountZero = actual; comparisons++;
      }
      if (fixture.type === 'pixel-poster' && (!amountZero || amountZero.every((value, index) => value === compactInput[index]))) {
        throw new Error('pixel-poster amount zero incorrectly removed pixel sampling');
      }
      const values = resolved(fixture.definition, { amount: 1 });
      for (const [name, graph] of [['bypass', bypassGraph(fixture)], ['direct', directGraph(fixture)]] as const) {
        const plan = compileImageOperatorGraph(graph, values, { parameterSchema: fixture.definition.params }), entryPoint = `${fixture.type.replaceAll('-', '')}${name}Fragment`;
        const actual = await render(device, sampler, source.createView(), target, readback, imageGraphProgramShader(plan, entryPoint), entryPoint,
          packImageOperatorRuntimeUniforms(plan, 0, width, height));
        const expected = name === 'bypass' ? processed : compactInput; if (!expected) throw new Error(`${fixture.type}/${name}: processed reference unavailable`);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${fixture.type}/${name}: ${mismatch(expected, actual)}`); comparisons++;
      }
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
