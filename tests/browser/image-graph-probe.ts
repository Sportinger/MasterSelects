import common from '../../src/effects/_shared/common.wgsl?raw';
import { invert } from '../../src/effects/color/invert';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { checkImageCompositeGpu } from './image-composite-gpu-check';
import { checkWorkerImageGraphGpu } from './image-worker-gpu-check';
import { checkRemainingColorEffectsGpu } from './image-color-effects-gpu-check';
import { checkPointwiseEffectsGpu } from './image-pointwise-effects-gpu-check';
import { checkVignetteGpu } from './image-vignette-gpu-check';
import { checkTimeEffectsGpu } from './image-time-effects-gpu-check';

async function checkGpu() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const size = 64;
  const pixels = new Uint8Array(size * 4);
  for (let x = 0; x < size; x++) pixels.set([x * 4, 255 - x * 4, 37, x * 4], x * 4);
  const source = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, 1]);
  const target = device.createTexture({ size: [size, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const base = { id: 'gpu-fixture', type: 'invert' as const, params: {} };
  const bypass = createDefaultInvertImageGraph();
  bypass.nodes.filter(node => node.id.startsWith('invert-')).forEach(node => { node.bypassed = true; });
  const direct = createDefaultInvertImageGraph();
  direct.edges = direct.edges.filter(edge => edge.to !== 'output');
  direct.edges.push({ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' });
  const definitions = [invert as FullscreenEffectDefinition,
    imageGraphDefinition(base, invert as FullscreenEffectDefinition),
    imageGraphDefinition({ ...base, operatorGraph: bypass }, invert as FullscreenEffectDefinition),
    imageGraphDefinition({ ...base, operatorGraph: direct }, invert as FullscreenEffectDefinition)];
  const results: Uint8Array[] = [];
  try {
    for (const definition of definitions) {
      const module = device.createShaderModule({ code: common + '\n' + definition.shader });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
      const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
      const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sampler }, { binding: 1, resource: source.createView() },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
      // common.wgsl defines a six-vertex fullscreen quad, not the compositor's three-vertex triangle.
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(6); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: size * 4 }, [size, 1]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      results.push(new Uint8Array(readback.getMappedRange()).slice()); readback.unmap();
    }
    const equal = (a: Uint8Array, b: Uint8Array) => a.every((value, i) => value === b[i]);
    const mismatch = (a: Uint8Array, b: Uint8Array) => {
      const index = a.findIndex((value, i) => value !== b[i]);
      return index < 0 ? 'none' : `byte ${index} (pixel ${Math.floor(index / 4)}, channel ${index % 4}): actual=${a[index]}, expected=${b[index]}`;
    };
    if (!equal(results[0], results[1])) throw new Error('Default graph differs from legacy shader');
    if (!equal(results[2], pixels)) throw new Error(`Bypass output differs from input at ${mismatch(results[2], pixels)}`);
    if (!equal(results[3], pixels)) throw new Error(`Direct output differs from input at ${mismatch(results[3], pixels)}`);
    if (equal(results[0], results[2])) throw new Error('Graph edit did not change pixels');
    const opaque = pixels.slice();
    for (let index = 3; index < opaque.length; index += 4) opaque[index] = 255;
    await checkImageCompositeGpu(device, sampler, opaque, size);
    await checkImageCompositeGpu(device, sampler, pixels, size);
    const colorComparisons = await checkRemainingColorEffectsGpu(device, sampler, pixels, size);
    if (colorComparisons !== 10) throw new Error(`Expected 10 remaining color comparisons, got ${colorComparisons}`);
    const pointwiseComparisons = await checkPointwiseEffectsGpu(device, sampler);
    const vignetteComparisons = await checkVignetteGpu(device, sampler);
    const timeComparisons = await checkTimeEffectsGpu(device, sampler);
    const workerResult = `${await checkWorkerImageGraphGpu(device)}; ${colorComparisons} remaining-color, ${pointwiseComparisons} pointwise, ${vignetteComparisons} vignette, and ${timeComparisons} time-effect shader comparisons`;
    const validation = await device.popErrorScope();
    if (validation) throw new Error(validation.message);
    return `PASS: 64 RGBA pixels — legacy/default byte equality; bypass and rewired output equal input; alpha preserved; actual GPU output changes; ${workerResult}; no validation errors.`;
  } finally { source.destroy(); target.destroy(); readback.destroy(); device.destroy(); }
}

document.getElementById('run')!.addEventListener('click', async () => {
  const result = document.getElementById('result')!;
  result.textContent = 'Running…';
  try { result.textContent = await checkGpu(); } catch (error) { result.textContent = `FAIL: ${error}`; }
});
