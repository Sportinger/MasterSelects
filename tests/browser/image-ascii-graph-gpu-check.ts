import common from '../../src/effects/_shared/commonShader';
import { resolveImageGraphExternalResources } from '../../src/effects/_shared/imageGraphExternalResources';
import { getGlyphAtlas, releaseGlyphAtlasesForDevice } from '../../src/effects/_shared/glyphAtlas';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { ascii, asciiGhost, brandGenerator, capsuleCloud, dataHatch, ditherText, glyphMatrix, gridGlyph, inscribe, matrix, numberField, pixelCode, pixelDither, retroMatrix, stitchPoster, symbolMatrix, uiCollage, wordMosaic } from '../../src/effects/glyph';
import { contourType } from '../../src/effects/geometry';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultAsciiGhostGraph, createDefaultAsciiGraph, createDefaultBrandGeneratorGraph, createDefaultCapsuleCloudGraph, createDefaultContourTypeGraph, createDefaultDataHatchGraph, createDefaultDitherTextGraph, createDefaultGlyphMatrixGraph, createDefaultGridGlyphGraph, createDefaultInscribeGraph, createDefaultMatrixGraph, createDefaultNumberFieldGraph, createDefaultPixelCodeGraph, createDefaultPixelDitherGraph, createDefaultRetroMatrixGraph, createDefaultStitchPosterGraph, createDefaultSymbolMatrixGraph, createDefaultUiCollageGraph, createDefaultWordMosaicGraph } from '../../src/services/operators/asciiEffectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const width = 64;
const height = 29;
const bytesPerRow = 256;
const asciiDefinition = ascii as FullscreenEffectDefinition;

const cases = [
  { name: 'defaults', params: {} },
  { name: 'cell-minimum', params: { cellSize: 4 } },
  { name: 'cell-maximum', params: { cellSize: 72 } },
  { name: 'amount-zero', params: { amount: 0 } },
  { name: 'amount-one', params: { amount: 1 } },
  { name: 'duotone', params: { colorMode: 'duotone', colorA: '#17304f', colorB: '#f2c45e' } },
  { name: 'invert', params: { invert: true } },
  { name: 'custom-unicode', params: { customRamp: ' .░▒▓█λ猫', fontFamily: 'Georgia, serif', fontWeight: 900 } },
] as const;
const variantCases = [
  { name: 'defaults', params: {} },
  { name: 'cell-minimum', params: { cellSize: 4 } },
  { name: 'cell-maximum', params: { cellSize: 72 } },
  { name: 'amount-minimum', params: { amount: 0 } },
  { name: 'amount-maximum', params: { amount: 1 } },
] as const;
const animatedCases = [
  ...variantCases.map(item => ({ ...item, time: .73 })),
  { name: 'speed-minimum', params: { speed: 0 }, time: 1.25 },
  { name: 'speed-maximum', params: { speed: 5 }, time: 1.25 },
] as const;

type Params = Record<string, number | boolean | string>;

function resolved(definition: FullscreenEffectDefinition, overrides: Record<string, number | boolean | string>): Params {
  return { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])), ...overrides } as Params;
}

function fixture(): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set([
      (x * 31 + y * 7 + 11) & 255,
      (x * 5 + y * 43 + 29) & 255,
      (x * 19 + y * 13 + 47) & 255,
      (x * 37 + y * 61 + 17) & 255,
    ], (y * width + x) * 4);
  }
  return pixels;
}

function historyFixture(): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([
    180 + ((x * 7 + y * 3) % 76), 170 + ((x * 5 + y * 11) % 86),
    160 + ((x * 13 + y * 2) % 96), 190 + ((x * 3 + y * 17) % 66),
  ], (y * width + x) * 4);
  return pixels;
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

async function read(device: GPUDevice, target: GPUTexture, readback: GPUBuffer): Promise<Uint8Array> {
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(readback.getMappedRange()).slice();
  readback.unmap();
  return result;
}

async function legacy(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  params: Params,
  definition: FullscreenEffectDefinition,
  timelineTimeSeconds = 0,
  history?: GPUTextureView,
): Promise<Uint8Array> {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] },
  });
  const packed = definition.packUniforms(params, width, height, timelineTimeSeconds)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed);
  const atlas = getGlyphAtlas(device, definition.glyphAtlas!(params));
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: sampler }, { binding: 1, resource: source },
    { binding: 2, resource: { buffer: uniform } }, ...(history ? [{ binding: 3, resource: history }] : []),
    { binding: 4, resource: atlas.view },
  ] });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  uniform.destroy();
  return read(device, target, readback);
}

function compile(params: Params, graph: EffectOperatorGraph, definition: FullscreenEffectDefinition) {
  return compileImageOperatorGraph(graph, params, {
    parameterSchema: definition.params,
    ...(definition.usesFeedback ? { allowFrameHistory: true } : {}),
    resolveGlyphAtlas: (bindings, values) => definition.glyphAtlas!({
      rampPreset: values[bindings.rampPreset] as string,
      customRamp: values[bindings.customRamp] as string,
      fontFamily: values[bindings.fontFamily] as string,
      fontWeight: values[bindings.fontWeight] as number,
    }),
  });
}

async function renderGraph(
  device: GPUDevice,
  runtime: ImageGraphPassRuntime,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  params: Params,
  definition: FullscreenEffectDefinition,
  factory: () => EffectOperatorGraph,
  timelineTimeSeconds = 0,
  history?: GPUTextureView,
): Promise<Uint8Array> {
  const plan = compile(params, factory(), definition);
  const externalResources = new Map(resolveImageGraphExternalResources(device, plan));
  if (history) externalResources.set('effect-history', { view: history, identity: `${definition.id}-history` });
  const encoder = device.createCommandEncoder();
  const encoded = runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source }, width, height,
    timelineTimeSeconds, plan, outputView: target.createView(), outputFormat: 'rgba8unorm',
    instanceId: `${definition.id}:${timelineTimeSeconds}:${JSON.stringify(params)}`, externalResources });
  if (!encoded) throw new Error(`${definition.name} graph did not exercise the external-resource pass runtime.`);
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(readback.getMappedRange()).slice();
  readback.unmap();
  return result;
}

function directGraph(factory: () => EffectOperatorGraph, effectId: string): EffectOperatorGraph {
  const result = structuredClone(factory());
  result.edges = result.edges.filter(edge => edge.to !== 'output');
  result.edges.push({ id: `${effectId}-test-direct`, from: 'frame', output: 'image', to: 'output', input: 'image' });
  return result;
}

async function direct(
  device: GPUDevice,
  sampler: GPUSampler,
  source: GPUTextureView,
  target: GPUTexture,
  readback: GPUBuffer,
  params: Params,
  definition: FullscreenEffectDefinition,
  factory: () => EffectOperatorGraph,
  timelineTimeSeconds = 0,
): Promise<Uint8Array> {
  const plan = compile(params, directGraph(factory, definition.id), definition);
  if (plan.resourceInputs?.length || plan.externalResources?.length) throw new Error(`Direct ${definition.name} graph retained an unreachable atlas resource.`);
  const entryPoint = `${definition.id.replaceAll('-', '')}DirectFragment`;
  const module = device.createShaderModule({ code: `${common}\n${imageGraphProgramShader(plan, entryPoint)}` });
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = packImageOperatorRuntimeUniforms(plan, timelineTimeSeconds, width, height);
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
  let uniform: GPUBuffer | undefined;
  if (packed) {
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed); entries.push({ binding: 2, resource: { buffer: uniform } });
  }
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap(); uniform?.destroy();
  return result;
}

export async function checkAsciiGraphGpu(device: GPUDevice): Promise<number> {
  const input = fixture(), historyInput = historyFixture();
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const history = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const clearHistory = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const runtime = new ImageGraphPassRuntime(device);
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  device.queue.writeTexture({ texture: history }, historyInput, { bytesPerRow }, [width, height]);
  device.queue.writeTexture({ texture: clearHistory }, new Uint8Array(width * height * 4), { bytesPerRow }, [width, height]);
  let comparisons = 0;
  try {
    for (const item of cases) {
      const params = resolved(asciiDefinition, item.params);
      const expected = await legacy(device, sampler, source.createView(), target, readback, params, asciiDefinition);
      const actual = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params, asciiDefinition, createDefaultAsciiGraph);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`ASCII ${item.name}: ${mismatch(expected, actual)}`);
      comparisons++;
    }
    for (const [definition, factory] of [
      [numberField as FullscreenEffectDefinition, createDefaultNumberFieldGraph],
      [gridGlyph as FullscreenEffectDefinition, createDefaultGridGlyphGraph],
      [pixelCode as FullscreenEffectDefinition, createDefaultPixelCodeGraph],
      [wordMosaic as FullscreenEffectDefinition, createDefaultWordMosaicGraph],
      [brandGenerator as FullscreenEffectDefinition, createDefaultBrandGeneratorGraph],
      [stitchPoster as FullscreenEffectDefinition, createDefaultStitchPosterGraph],
      [inscribe as FullscreenEffectDefinition, createDefaultInscribeGraph],
    ] as const) {
      for (const item of variantCases) {
        const params = resolved(definition, item.params);
        const expected = await legacy(device, sampler, source.createView(), target, readback, params, definition);
        const actual = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params, definition, factory);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${definition.name} ${item.name}: ${mismatch(expected, actual)}`);
        comparisons++;
      }
    }
    for (const item of animatedCases) {
      const definition = asciiGhost as FullscreenEffectDefinition, params = resolved(definition, item.params);
      const expected = await legacy(device, sampler, source.createView(), target, readback, params, definition, item.time, history.createView());
      const actual = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params,
        definition, createDefaultAsciiGhostGraph, item.time, history.createView());
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${definition.name} ${item.name}: ${mismatch(expected, actual)}`);
      if (item.name === 'defaults') {
        const withoutHistory = await legacy(device, sampler, source.createView(), target, readback, params, definition, item.time, clearHistory.createView());
        for (let channel = 0; channel < 4; channel++) if (!expected.some((value, index) => index % 4 === channel && value !== withoutHistory[index])) {
          throw new Error(`${definition.name} history did not exercise channel ${channel}.`);
        }
      }
      comparisons++;
    }
    for (const [definition, factory] of [
      [glyphMatrix as FullscreenEffectDefinition, createDefaultGlyphMatrixGraph],
      [dataHatch as FullscreenEffectDefinition, createDefaultDataHatchGraph],
      [ditherText as FullscreenEffectDefinition, createDefaultDitherTextGraph],
      [symbolMatrix as FullscreenEffectDefinition, createDefaultSymbolMatrixGraph],
      [pixelDither as FullscreenEffectDefinition, createDefaultPixelDitherGraph],
      [retroMatrix as FullscreenEffectDefinition, createDefaultRetroMatrixGraph],
      [capsuleCloud as FullscreenEffectDefinition, createDefaultCapsuleCloudGraph],
      [uiCollage as FullscreenEffectDefinition, createDefaultUiCollageGraph],
      [matrix as FullscreenEffectDefinition, createDefaultMatrixGraph],
    ] as const) {
      for (const item of animatedCases) {
        const params = resolved(definition, item.params);
        const expected = await legacy(device, sampler, source.createView(), target, readback, params, definition, item.time);
        const actual = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params, definition, factory, item.time);
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${definition.name} ${item.name}: ${mismatch(expected, actual)}`);
        comparisons++;
      }
    }
    for (const [definition, factory] of [
      [asciiDefinition, createDefaultAsciiGraph],
      [numberField as FullscreenEffectDefinition, createDefaultNumberFieldGraph],
      [gridGlyph as FullscreenEffectDefinition, createDefaultGridGlyphGraph],
      [pixelCode as FullscreenEffectDefinition, createDefaultPixelCodeGraph],
      [wordMosaic as FullscreenEffectDefinition, createDefaultWordMosaicGraph],
      [glyphMatrix as FullscreenEffectDefinition, createDefaultGlyphMatrixGraph],
      [dataHatch as FullscreenEffectDefinition, createDefaultDataHatchGraph],
      [brandGenerator as FullscreenEffectDefinition, createDefaultBrandGeneratorGraph],
      [stitchPoster as FullscreenEffectDefinition, createDefaultStitchPosterGraph],
      [ditherText as FullscreenEffectDefinition, createDefaultDitherTextGraph],
      [symbolMatrix as FullscreenEffectDefinition, createDefaultSymbolMatrixGraph],
      [pixelDither as FullscreenEffectDefinition, createDefaultPixelDitherGraph],
      [retroMatrix as FullscreenEffectDefinition, createDefaultRetroMatrixGraph],
      [capsuleCloud as FullscreenEffectDefinition, createDefaultCapsuleCloudGraph],
      [uiCollage as FullscreenEffectDefinition, createDefaultUiCollageGraph],
      [matrix as FullscreenEffectDefinition, createDefaultMatrixGraph],
      [asciiGhost as FullscreenEffectDefinition, createDefaultAsciiGhostGraph],
      [inscribe as FullscreenEffectDefinition, createDefaultInscribeGraph],
    ] as const) {
      const timelineTimeSeconds = ['glyph-matrix', 'data-hatch', 'dither-text', 'symbol-matrix', 'pixel-dither', 'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost'].includes(definition.id) ? .73 : 0;
      const params = resolved(definition, { amount: 1 });
      const processed = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params, definition, factory,
        timelineTimeSeconds, definition.id === 'ascii-ghost' ? history.createView() : undefined);
      const output = await direct(device, sampler, source.createView(), target, readback, params, definition, factory, timelineTimeSeconds);
      if (input.some((value, index) => value !== output[index])) throw new Error(`${definition.name} direct rewire differs from source: ${mismatch(input, output)}`);
      if (processed.every((value, index) => value === output[index])) throw new Error(`${definition.name} direct rewire did not differ from processed output.`);
      comparisons++;
    }
    return comparisons;
  } finally {
    runtime.dispose(); source.destroy(); history.destroy(); clearHistory.destroy(); target.destroy(); readback.destroy();
    releaseGlyphAtlasesForDevice(device);
  }
}

/** Isolated Contour Type coverage; does not rerun the established glyph matrix. */
export async function checkContourTypeGraphGpu(device: GPUDevice): Promise<number> {
  const definition = contourType as FullscreenEffectDefinition, input = fixture();
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const runtime = new ImageGraphPassRuntime(device); device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]);
  const contourCases = [
    { name: 'defaults', params: {} },
    { name: 'cell-minimum-active', params: { cellSize: 4, amount: 1 } },
    { name: 'cell-maximum', params: { cellSize: 72, amount: 1 } },
    { name: 'custom-ramp', params: { customRamp: ' .:+*#@', fontFamily: 'Georgia, serif', fontWeight: 900 } },
    { name: 'custom-colors', params: { colorMode: 'duotone', colorA: '#e8174f', colorB: '#16d9a8', amount: .73 } },
    { name: 'amount-zero', params: { amount: 0 } },
  ] as const;
  let comparisons = 0;
  try {
    for (const item of contourCases) {
      const params = resolved(definition, item.params), expected = await legacy(device, sampler, source.createView(), target, readback, params, definition);
      const actual = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params,
        definition, createDefaultContourTypeGraph);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`Contour Type ${item.name}: ${mismatch(expected, actual)}`);
      comparisons++;
    }
    const params = resolved(definition, { amount: 1 });
    const processed = await renderGraph(device, runtime, sampler, source.createView(), target, readback, params,
      definition, createDefaultContourTypeGraph);
    const output = await direct(device, sampler, source.createView(), target, readback, params,
      definition, createDefaultContourTypeGraph);
    if (input.some((value, index) => value !== output[index])) throw new Error(`Contour Type direct: ${mismatch(input, output)}`);
    if (processed.every((value, index) => value === output[index])) throw new Error('Contour Type direct output matched processed output.');
    comparisons++; return comparisons;
  } finally {
    runtime.dispose(); source.destroy(); target.destroy(); readback.destroy(); releaseGlyphAtlasesForDevice(device);
  }
}
