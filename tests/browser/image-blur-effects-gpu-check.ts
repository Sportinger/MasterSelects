import common from '../../src/effects/_shared/commonShader';
import { createEarlierStylizeGraph } from '../../src/services/operators/stylizeRecipes';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { boxBlur } from '../../src/effects/blur/box';
import { gaussianBlur } from '../../src/effects/blur/gaussian';
import { sharpen } from '../../src/effects/stylize/sharpen';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultBoxBlurGraph } from '../../src/services/operators/blurEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { alphaEdgeFixture, assertCleanAlphaEdge, checkTwoPassBlurs, ROW_PITCH } from './blur-two-pass-gpu-check';

const rowPitch = 256;
// Sharpen stays a single-pass graph checked against its registered shader.
const cases = [
  { name: 'sharpen-default', type: 'sharpen', params: {}, width: 64, height: 37 },
  { name: 'sharpen-amount-zero', type: 'sharpen', params: { amount: 0, radius: 1 }, width: 64, height: 37 },
  { name: 'sharpen-max', type: 'sharpen', params: { amount: 5, radius: 5 }, width: 64, height: 37 },
] as const;
// Box and Gaussian: radius is in pixels of a 1080p frame (shorter side), so these 40 px tall
// fixtures use 40/1080 of it; radii beyond the slider range keep the kernels several taps wide.
const separableCases = [
  { name: 'box-radius-zero', type: 'box-blur', params: { radius: 0 }, width: 64, height: 40 },
  { name: 'box-default', type: 'box-blur', params: {}, width: 64, height: 40 },
  { name: 'box-fractional', type: 'box-blur', params: { radius: 120.5 }, width: 64, height: 40 },
  { name: 'box-wide', type: 'box-blur', params: { radius: 400 }, width: 64, height: 40 },
  { name: 'gaussian-radius-zero', type: 'gaussian-blur', params: { radius: 0 }, width: 64, height: 40 },
  { name: 'gaussian-default', type: 'gaussian-blur', params: {}, width: 64, height: 40 },
  { name: 'gaussian-legacy-samples', type: 'gaussian-blur', params: { radius: 250, samples: 1 }, width: 64, height: 40 },
  { name: 'gaussian-wide', type: 'gaussian-blur', params: { radius: 400 }, width: 64, height: 40 },
  // Past 127 pair taps per side the pairs spread out instead of truncating the kernel.
  { name: 'gaussian-stride', type: 'gaussian-blur', params: { radius: 10000 }, width: 64, height: 40 },
  // A hard alpha edge inside a merged pair: the premultiplied source cache keeps the colour (no dark fringe).
  { name: 'gaussian-alpha-edge', type: 'gaussian-blur', params: { radius: 108 }, width: 64, height: 40, fixture: alphaEdgeFixture(31) },
  { name: 'box-alpha-edge', type: 'box-blur', params: { radius: 135 }, width: 64, height: 40, fixture: alphaEdgeFixture(32) },
];

function fixture(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set([(x * 29 + y * 3) % 256, (y * 47 + x * 5) % 256, (x * 11 + y * 17) % 256,
      (x * 13 + y * 19) % 256], y * rowPitch + x * 4);
  }
  return pixels;
}

function mismatchSummary(expected: Uint8Array, actual: Uint8Array, width: number): string {
  let first = -1, count = 0, maxDelta = 0;
  for (let index = 0; index < expected.length; index++) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (!delta) continue;
    if (first < 0) first = index;
    count++;
    maxDelta = Math.max(maxDelta, delta);
  }
  const row = Math.floor(first / rowPitch), column = Math.floor((first % rowPitch) / 4);
  return `byte ${first} (pixel ${column},${row} of width ${width}): expected ${expected[first]}, actual ${actual[first]}; ${count} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>, width: number, height: number): Promise<Uint8Array> {
  device.pushErrorScope('validation');
  let scopePopped = false, uniform: GPUBuffer | undefined;
  const popError = async () => { scopePopped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
    const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = definition.packUniforms(params, width, height, 0)!;
    uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, { binding: 1, resource: source }, { binding: 2, resource: { buffer: uniform } },
    ] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
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

export async function checkBlurEffectsGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  for (const item of cases) {
    const sourcePixels = fixture(item.width, item.height);
    const source = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const target = device.createTexture({ size: [item.width, item.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const readback = device.createBuffer({ size: sourcePixels.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      device.queue.writeTexture({ texture: source }, sourcePixels, { bytesPerRow: rowPitch }, [item.width, item.height]);
      const legacy = sharpen as FullscreenEffectDefinition;
      const params = effectOperatorParams({ type: item.type, params: item.params });
      // The registered shader is the earlier (pre-2026-10-21) Sharpen; saved projects keep that recipe.
      const graph = imageGraphDefinition({ type: item.type, params, operatorGraph: createEarlierStylizeGraph(item.type) }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params, item.width, item.height);
      const actual = await render(device, sampler, source.createView(), target, readback, graph, params, item.width, item.height);
      if (expected.some((value, index) => value !== actual[index])) {
        throw new Error(`${item.name} graph differs from registered shader: ${mismatchSummary(expected, actual, item.width)}`);
      }
      if (item.name === 'sharpen-default') {
        for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
          const alpha = y * rowPitch + x * 4 + 3;
          if (actual[alpha] !== sourcePixels[alpha]) throw new Error(`Sharpen changed center alpha at ${x},${y}`);
        }
      }
    } finally { source.destroy(); target.destroy(); readback.destroy(); }
  }
  let weightedAlphaCases = 0;
  const separable = await checkTwoPassBlurs(device, separableCases,
    { 'box-blur': boxBlur as FullscreenEffectDefinition, 'gaussian-blur': gaussianBlur as FullscreenEffectDefinition },
    ['separableBlurPremultiply', 'separableBlurHorizontal', 'separableBlurVertical'], async (item, input, actual, rerender) => {
      if (item.name.endsWith('alpha-edge')) { assertCleanAlphaEdge(item.name, actual, item.width, item.height); return 1; }
      if (item.name.endsWith('radius-zero')) {
        // Radius 0 is the identity up to the premultiplied rgba16float round trip (fully transparent RGB is not kept).
        actual.forEach((value, index) => { if ((index % ROW_PITCH) < item.width * 4 && input[index - (index % 4) + 3] > 0
          && Math.abs(value - input[index]) > 1) throw new Error(`${item.name} changed pixels at byte ${index}`); });
      }
      if (item.name === 'box-fractional' || item.name === 'gaussian-wide') {
        if (!actual.some((value, index) => (index % 4) === 3 && (index % ROW_PITCH) < item.width * 4 && value !== input[index])) {
          throw new Error(`${item.name} kept center alpha instead of filtering RGBA`);
        }
        weightedAlphaCases++;
      }
      if (item.name !== 'box-fractional') return 0;
      const edited = createDefaultBoxBlurGraph();
      edited.nodes.find(node => node.id === 'reference-height')!.constants = { value: 540 };
      const editedOutput = await rerender(edited);
      if (editedOutput.every((value, index) => value === actual[index])) throw new Error('Edited Box Blur reference height did not change actual GPU pixels');
      return 1;
    });
  if (weightedAlphaCases !== 2) throw new Error(`Expected two weighted-alpha blur checks, got ${weightedAlphaCases}`);
  return cases.length + separable;
}
