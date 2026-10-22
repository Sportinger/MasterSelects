import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { getDefaultParams, getEffect } from '../../src/effects';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createStylizeRecipeGraph } from '../../src/services/operators/stylizeRecipes';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';

/**
 * The current stylize recipes (2026-10-21) on the GPU against the CPU software evaluation of the
 * same plan: the Glow bloom pyramid (scaled Cache Images), the derivative-of-Gaussian Edge
 * Detect, the Sharpen soft window, Film Grain's Random (Cell) noise, Vignette, Scanlines and
 * Posterize Brightness Only. The fixture mixes opaque, partly transparent and empty areas.
 */
const rowPitch = 512, width = 96, height = 54, time = 1.25;
const cases: { name: string; type: string; params: Record<string, unknown>; tolerance: number }[] = [
  { name: 'glow-default', type: 'glow', params: {}, tolerance: 3 },
  { name: 'glow-wide-red', type: 'glow', params: { amount: 3, threshold: 0.3, radius: 300, color: '#ff4020' }, tolerance: 3 },
  { name: 'edge-default', type: 'edge-detect', params: {}, tolerance: 2 },
  { name: 'edge-width-colour', type: 'edge-detect', params: { width: 3, strength: 1.5, colorize: 1 }, tolerance: 2 },
  { name: 'edge-inverted', type: 'edge-detect', params: { invert: true }, tolerance: 2 },
  // 2 sigma = 12 px: the window keeps 8 taps per side and spreads them 1.5 px apart (bilinear reads).
  { name: 'edge-spread-taps', type: 'edge-detect', params: { width: 120, strength: 1.5 }, tolerance: 2 },
  { name: 'sharpen-strong', type: 'sharpen', params: { amount: 5, radius: 5 }, tolerance: 2 },
  { name: 'grain-colour', type: 'grain', params: { amount: 0.4, size: 3, chroma: 1, seed: 9 }, tolerance: 2 },
  { name: 'vignette-frame-shape', type: 'vignette', params: { amount: 0.8, roundness: 0, softness: 0 }, tolerance: 2 },
  { name: 'scanlines-dense', type: 'scanlines', params: { density: 9, opacity: 0.8, speed: 1 }, tolerance: 2 },
  { name: 'posterize-brightness', type: 'posterize', params: { levels: 4, softness: 0.2, brightnessOnly: true }, tolerance: 2 },
];

/** One fullscreen draw of a single-pass graph (the pass runtime only runs multi-pass plans). */
async function renderSinglePass(device: GPUDevice, encoder: GPUCommandEncoder, sampler: GPUSampler, source: GPUTexture, target: GPUTexture,
  definition: FullscreenEffectDefinition, params: Record<string, unknown>) {
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` }), info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error'); if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const packed = definition.packUniforms(params as Record<string, number>, width, height, time)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler },
    { binding: 1, resource: source.createView() }, { binding: 2, resource: { buffer: uniform } }] })); pass.draw(6); pass.end();
  return uniform;
}

function fixture() {
  const result = new Uint8Array(rowPitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x > 14 && x < 80 && y > 8 && y < 46, light = Math.hypot(x - 40, y - 26) < 6;
    result.set(light ? [255, 250, 235, 255] : [(x * 37 + y * 11) & 255, (x * 13 + y * 83) & 255, 128 + ((x * 5) & 127),
      inside ? 255 : x < 6 ? 0 : (x * 43 + y * 71) & 255], y * rowPitch + x * 4);
  }
  return result;
}

export async function checkStylizeRecipesGpu(device: GPUDevice): Promise<number> {
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const runtime = new ImageGraphPassRuntime(device), input = fixture();
  const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeTexture({ texture: source }, input, { bytesPerRow: rowPitch }, [width, height]);
  device.pushErrorScope('validation');
  let comparisons = 0;
  try {
    for (const item of cases) {
      const effect = { type: item.type, params: { ...getDefaultParams(item.type), ...item.params }, operatorGraph: createStylizeRecipeGraph(item.type) };
      const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect));
      const encoder = device.createCommandEncoder();
      const uniform = plan.passes?.length
        ? (runtime.encode({ encoder, sampler, source: { kind: 'texture', view: source.createView() }, width, height,
          timelineTimeSeconds: time, plan, outputView: target.createView(), instanceId: item.name }), undefined)
        : await renderSinglePass(device, encoder, sampler, source, target,
          imageGraphDefinition(effect, getEffect(item.type) as FullscreenEffectDefinition, time, plan), effectOperatorParams(effect));
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: rowPitch }, [width, height]);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ); uniform?.destroy();
      const gpu = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
      const cpu = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) cpu.set(input.subarray(y * rowPitch, y * rowPitch + width * 4), y * width * 4);
      applyWorkerSoftwareImageGraphs(cpu, width, height, [plan], time);
      let worst = 0, at = 0, changed = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) {
        const delta = Math.abs(gpu[y * rowPitch + x] - cpu[y * width * 4 + x]);
        if (delta > worst) { worst = delta; at = y * width * 4 + x; }
        if (gpu[y * rowPitch + x] !== input[y * rowPitch + x]) changed++;
      }
      const pixel = Math.floor(at / 4), px = pixel % width, py = Math.floor(pixel / width);
      if (worst > item.tolerance) throw new Error(`${item.name}: GPU differs from the CPU reference by ${worst} at pixel (${px}, ${py}) channel ${at % 4}: `
        + `GPU ${[...gpu.subarray(py * rowPitch + px * 4, py * rowPitch + px * 4 + 4)]}, CPU ${[...cpu.subarray(pixel * 4, pixel * 4 + 4)]}`);
      if (!changed) throw new Error(`${item.name}: the effect changed no pixel`);
      comparisons++;
    }
    const validation = await device.popErrorScope(); if (validation) throw new Error(validation.message);
    return comparisons;
  } finally { runtime.dispose(); source.destroy(); target.destroy(); readback.destroy(); }
}
