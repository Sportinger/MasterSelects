import common from '../../src/effects/_shared/commonShader';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { getEffect } from '../../src/effects';
import { isFullscreenEffectDefinition, type FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';

const width = 43, height = 27, bytesPerRow = 256;
const originalEffectTypes = new Set(['contour-map', 'crosshatch', 'kilim']);
export const IMAGE_GEOMETRY_PATTERN_TYPES = ['contour-map', 'crosshatch', 'kilim', 'vector-tiling', 'embroidery', 'outline', 'bricks'] as const;
export type ImageGeometryPatternType = typeof IMAGE_GEOMETRY_PATTERN_TYPES[number];
export type ImageGeometryPatternCaseName = 'defaults' | 'minimums' | 'maximums' | 'amount-zero' | 'amount-one'
  | 'custom-colors' | 'timeline-zero' | 'timeline-later' | 'direct';
function pixels() { const data = new Uint8Array(bytesPerRow * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
  data.set([(x * 31 + y * 11) & 255, (x * 7 + y * 43) & 255, (x * 19 + y * 17) & 255, (x * 47 + y * 67) & 255], y * bytesPerRow + x * 4); return data; }
function mismatch(expected: Uint8Array, actual: Uint8Array) { let first = -1, count = 0, maximum = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maximum = Math.max(maximum, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maximum}`; }
function defaults(definition: FullscreenEffectDefinition) {
  return Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])) as Record<string, number | boolean | string>;
}
function numericBoundary(definition: FullscreenEffectDefinition, side: 'min' | 'max') {
  return Object.fromEntries(Object.entries(definition.params).flatMap(([id, spec]) => spec.type === 'number' && spec[side] !== undefined ? [[id, spec[side]!]] : []));
}
async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  shader: string, entryPoint: string, uniforms: Float32Array<ArrayBuffer> | null) {
  const module = device.createShaderModule({ code: `${common}\n${shader}` });
  const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }]; let uniform: GPUBuffer | undefined;
  if (uniforms) { uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, uniforms); entries.push({ binding: 2, resource: { buffer: uniform } }); }
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap(); uniform?.destroy(); return result;
}

export async function checkImageGeometryPatternsGpu(device: GPUDevice,
  selectedTypes: readonly ImageGeometryPatternType[] = IMAGE_GEOMETRY_PATTERN_TYPES,
  selectedCaseNames?: readonly ImageGeometryPatternCaseName[]): Promise<number> {
  const input = pixels(), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow }, [width, height]); let comparisons = 0;
  try {
    for (const type of selectedTypes) {
      const definition = getEffect(type); if (!isFullscreenEffectDefinition(definition)) throw new Error(`${type} is not fullscreen.`);
      const base = defaults(definition), allCases = [
        { name: 'defaults', params: base, time: 0 }, { name: 'minimums', params: { ...base, ...numericBoundary(definition, 'min'), amount: 1 }, time: 0 },
        { name: 'maximums', params: { ...base, ...numericBoundary(definition, 'max') }, time: 0 },
        { name: 'amount-zero', params: { ...base, amount: 0 }, time: 0 }, { name: 'amount-one', params: { ...base, amount: 1 }, time: 0 },
        { name: 'custom-colors', params: { ...base, amount: .73, colorA: '#e8174f', colorB: '#16d9a8' }, time: 0 },
        ...(!originalEffectTypes.has(type) ? [
          { name: 'timeline-zero', params: { ...base, amount: .83, speed: 1.75 }, time: 0 },
          { name: 'timeline-later', params: { ...base, amount: .83, speed: 1.75 }, time: 1.375 },
        ] : []),
      ] as const;
      const cases = selectedCaseNames ? allCases.filter(item => selectedCaseNames.includes(item.name)) : allCases;
      let processed: Uint8Array | undefined;
      for (const item of cases) {
        const effect = { type, params: item.params }, graph = effectOperatorGraph(effect), params = effectOperatorParams(effect);
        const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext(effect));
        if (plan.passes?.length || plan.resources?.length) throw new Error(`${type}/${item.name} unexpectedly materialized a pass.`);
        const expected = await render(device, sampler, source.createView(), target, readback, definition.shader, definition.entryPoint,
          definition.packUniforms(item.params, width, height, item.time));
        const entry = `${type.replaceAll('-', '')}GraphFragment`, actual = await render(device, sampler, source.createView(), target, readback,
          imageGraphProgramShader(plan, entry), entry, packImageOperatorRuntimeUniforms(plan, item.time, width, height));
        if (expected.some((value, index) => value !== actual[index])) throw new Error(`${type}/${item.name}: ${mismatch(expected, actual)}`);
        for (let y = 0; type !== 'bricks' && y < height; y++) for (let x = 0; x < width; x++) {
          const alpha = y * bytesPerRow + x * 4 + 3;
          if (actual[alpha] !== input[alpha]) throw new Error(`${type}/${item.name}: alpha changed at ${x},${y}.`);
        }
        if (item.name === 'amount-one') processed = actual; comparisons++;
      }
      if (selectedCaseNames && !selectedCaseNames.includes('direct')) continue;
      const effect = { type, params: { ...base, amount: 1 } }, direct = structuredClone(effectOperatorGraph(effect));
      const frame = direct.nodes.find(node => node.operator === 'image.frame'), output = direct.nodes.find(node => node.operator === 'image.output');
      if (!frame || !output) throw new Error(`${type} graph lacks image boundaries.`);
      direct.edges = direct.edges.filter(edge => edge.to !== output.id);
      direct.edges.push({ id: `${type}-direct`, from: frame.id, output: 'image', to: output.id, input: 'image' });
      const plan = compileImageOperatorGraph(direct, effectOperatorParams(effect), effectOperatorCompileContext(effect));
      if (plan.passes?.length || plan.resources?.length) throw new Error(`${type} unexpectedly materialized a pass.`);
      const entry = `${type.replaceAll('-', '')}DirectFragment`, actual = await render(device, sampler, source.createView(), target, readback,
        imageGraphProgramShader(plan, entry), entry, packImageOperatorRuntimeUniforms(plan, 0, width, height));
      if (input.some((value, index) => value !== actual[index])) throw new Error(`${type}/direct: ${mismatch(input, actual)}`);
      if (processed?.every((value, index) => value === actual[index])) throw new Error(`${type} processed graph matched direct source.`);
      comparisons++;
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
