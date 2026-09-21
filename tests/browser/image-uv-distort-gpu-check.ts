import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { bulge } from '../../src/effects/distort/bulge';
import { kaleidoscope } from '../../src/effects/distort/kaleidoscope';
import { twirl } from '../../src/effects/distort/twirl';
import { wave } from '../../src/effects/distort/wave';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultUvDistortGraph, type EditableUvDistortEffectType } from '../../src/services/operators/uvDistortEffectGraphs';

const width = 47, height = 29, rowPitch = 256;
const definitions = { wave, twirl, bulge, kaleidoscope } as const;
const cases: readonly { name: string; type: EditableUvDistortEffectType; params: Record<string, number> }[] = [
  { name: 'wave-default', type: 'wave', params: {} },
  { name: 'wave-min', type: 'wave', params: { amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1 } },
  { name: 'wave-max', type: 'wave', params: { amplitudeX: .1, amplitudeY: .1, frequencyX: 20, frequencyY: 20 } },
  { name: 'twirl-default', type: 'twirl', params: {} },
  { name: 'twirl-min', type: 'twirl', params: { amount: -10, radius: .1, centerX: 0, centerY: 0 } },
  { name: 'twirl-max', type: 'twirl', params: { amount: 10, radius: 1, centerX: 1, centerY: 1 } },
  { name: 'twirl-noncentral', type: 'twirl', params: { amount: 2.37, radius: .73, centerX: .27, centerY: .68 } },
  { name: 'bulge-default', type: 'bulge', params: {} },
  { name: 'bulge-min', type: 'bulge', params: { amount: .1, radius: .1, centerX: 0, centerY: 0 } },
  { name: 'bulge-max', type: 'bulge', params: { amount: 3, radius: 1, centerX: 1, centerY: 1 } },
  { name: 'bulge-noncentral', type: 'bulge', params: { amount: 1.37, radius: .81, centerX: .31, centerY: .72 } },
  { name: 'kaleidoscope-default', type: 'kaleidoscope', params: {} },
  { name: 'kaleidoscope-min', type: 'kaleidoscope', params: { segments: 2, rotation: 0 } },
  { name: 'kaleidoscope-max', type: 'kaleidoscope', params: { segments: 16, rotation: 6.28318 } },
  { name: 'kaleidoscope-fractional', type: 'kaleidoscope', params: { segments: 6.5, rotation: 1.17 } },
];

function fixture() {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set([
    (x * 37 + y * 11) & 255, ((x ^ y) * 53 + y * 7) & 255,
    ((x + y) % 4) ? (x * 17 + y * 89) & 255 : 247, (x * 43 + y * 71) & 255,
  ], y * rowPitch + x * 4);
  return result;
}

function mismatch(expected: Uint8Array, actual: Uint8Array) {
  let first = -1, count = 0, maxDelta = 0;
  expected.forEach((value, index) => { const delta = Math.abs(value - actual[index]); if (!delta) return;
    if (first < 0) first = index; count++; maxDelta = Math.max(maxDelta, delta); });
  return `byte ${first}: expected ${expected[first]}, actual ${actual[first]}; ${count}/${expected.length} differ, max delta ${maxDelta}`;
}

async function render(device: GPUDevice, sampler: GPUSampler, source: GPUTextureView, target: GPUTexture, readback: GPUBuffer,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>) {
  device.pushErrorScope('validation'); let popped = false, uniform: GPUBuffer | undefined;
  const pop = async () => { popped = true; return device.popErrorScope(); };
  try {
    const module = device.createShaderModule({ code: `${common}\n${definition.shader}` }), info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
    const packed = definition.packUniforms(params, width, height, 0);
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: sampler }, { binding: 1, resource: source }];
    if (packed) {
      uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
      entries.push({ binding: 2, resource: { buffer: uniform } });
    }
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const validation = await pop(); if (validation) throw new Error(validation.message); return result;
  } catch (error) { const validation = popped ? null : await pop(); if (validation) throw new Error(validation.message, { cause: error }); throw error; }
  finally { uniform?.destroy(); }
}

function directUvGraph(type: EditableUvDistortEffectType) {
  const graph = createDefaultUvDistortGraph(type);
  graph.edges = graph.edges.filter(edge => !(edge.to === 'sample' && edge.input === 'uv'));
  graph.edges.push({ id: 'direct-source-uv', from: 'uv', output: 'uv', to: 'sample', input: 'uv' });
  return graph;
}

export async function checkUvDistortGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const input = fixture(), source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]);
  let comparisons = 0;
  try {
    for (const item of cases) {
      const params = effectOperatorParams({ type: item.type, params: item.params }), legacy = definitions[item.type] as FullscreenEffectDefinition;
      const canonical = imageGraphDefinition({ type: item.type, params }, legacy);
      const expected = await render(device, sampler, source.createView(), target, readback, legacy, params);
      const actual = await render(device, sampler, source.createView(), target, readback, canonical, params);
      if (expected.some((value, index) => value !== actual[index])) throw new Error(`${item.name}: ${mismatch(expected, actual)}`);
      comparisons++;
      if (item.name.endsWith('-default')) {
        if (actual.every((value, index) => value === input[index])) throw new Error(`${item.name}: canonical graph did not transform pixels`);
        let sampledAlpha = false;
        for (let y = 0; y < height && !sampledAlpha; y++) for (let x = 0; x < width; x++) {
          const alpha = y * rowPitch + x * 4 + 3; if (actual[alpha] !== input[alpha]) { sampledAlpha = true; break; }
        }
        if (!sampledAlpha) throw new Error(`${item.name}: alpha appears pinned to the source-center pixel instead of sampled UV`);
        const direct = imageGraphDefinition({ type: item.type, params, operatorGraph: directUvGraph(item.type) }, legacy);
        const rewired = await render(device, sampler, source.createView(), target, readback, direct, params);
        if (input.some((value, index) => value !== rewired[index])) throw new Error(`${item.name} direct-UV rewire: ${mismatch(input, rewired)}`);
        if (rewired.every((value, index) => value === actual[index])) throw new Error(`${item.name}: rewiring sample UV did not change GPU pixels`);
        comparisons++;
      }
      if (item.name === 'bulge-default') {
        const center = Math.floor(height / 2) * rowPitch + Math.floor(width / 2) * 4;
        for (let channel = 0; channel < 4; channel++) if (actual[center + channel] !== input[center + channel])
          throw new Error(`bulge-default: exact center channel ${channel} changed`);
      }
    }
    return comparisons;
  } finally { source.destroy(); target.destroy(); readback.destroy(); }
}
