import { getDefaultParams, getEffect } from '../../src/effects';
import { AnalogSignalRuntime } from '../../src/effects/analog/signal-lab/AnalogSignalRuntime';
import { isComputeEffectDefinition } from '../../src/effects/types';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import type { AnalogSignalPlan } from '../../src/services/operators/analogSignalGraph';

async function pixels(device: GPUDevice, runtime: AnalogSignalRuntime, instanceId: string, graph: ReturnType<typeof createDefaultAnalogSignalGraph>, params = getDefaultParams('analog-signal-lab'), fixedPlan?: AnalogSignalPlan): Promise<Uint8Array> {
  const size = 128, definition = getEffect('analog-signal-lab');
  if (!isComputeEffectDefinition(definition)) throw new Error('Analog Signal Lab is unavailable');
  const input = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const output = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const source = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) source.set([x * 2, y * 2, 255 - x, (x + y) % 5 ? 255 : 96], (y * size + x) * 4);
  device.queue.writeTexture({ texture: input }, source, { bytesPerRow: size * 4 }, [size, size]);
  const readback = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  runtime.encode({ commandEncoder: encoder, definition, plan: fixedPlan ?? compileAnalogSignalGraph(graph, params), instanceId,
    inputView: input.createView(), outputView: output.createView(), width: size, height: size, timelineTimeSeconds: 4.25 });
  encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]); device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange().slice(0)); readback.unmap();
  input.destroy(); output.destroy(); readback.destroy(); return result;
}

export async function checkAnalogSignalGpu(): Promise<string> {
  const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice(), runtime = new AnalogSignalRuntime(device);
  try {
    device.pushErrorScope('validation');
    const defaultGraph = createDefaultAnalogSignalGraph();
    const nondefault = { ...getDefaultParams('analog-signal-lab'), seed: 47, rfNoise: 0.37, ghostLevel: 0.11, tracking: 0.23, crtAmount: 0.41 };
    const first = await pixels(device, runtime, 'default-a', defaultGraph, nondefault), second = await pixels(device, runtime, 'default-b', defaultGraph, nondefault);
    if (first.some((value, index) => value !== second[index])) throw new Error('Default graph is not deterministic');
    const legacyPlan: AnalogSignalPlan = { key: 'legacy-fixed-six-pass', output: 'resolve', passthrough: false, stages: [
      { nodeId: 'encode', kind: 'encode', input: 'frame', params: nondefault },
      { nodeId: 'rf', kind: 'rf', input: 'encode', params: nondefault },
      { nodeId: 'vhs', kind: 'vhs', input: 'rf', params: nondefault },
      { nodeId: 'analyze', kind: 'analyze', input: 'vhs', params: nondefault },
      { nodeId: 'decode', kind: 'decode', input: 'vhs', receiver: 'analyze', params: nondefault },
      { nodeId: 'resolve', kind: 'resolve', input: 'decode', source: 'frame', params: nondefault },
    ] };
    const legacy = await pixels(device, runtime, 'legacy', defaultGraph, nondefault, legacyPlan);
    if (first.some((value, index) => value !== legacy[index])) throw new Error('Compiled default differs from the fixed legacy six-pass schedule');
    const bypassed = createDefaultAnalogSignalGraph(); bypassed.nodes.find(node => node.id === 'rf')!.bypassed = true; bypassed.nodes.find(node => node.id === 'vhs')!.bypassed = true;
    const bypassPixels = await pixels(device, runtime, 'bypass', bypassed);
    if (!bypassPixels.some((value, index) => value !== first[index])) throw new Error('RF/VHS bypass did not change output');
    const zeroed = await pixels(device, runtime, 'zeroed', defaultGraph, { ...getDefaultParams('analog-signal-lab'), rfAmount: 0, vhsAmount: 0 });
    if (bypassPixels.some((value, index) => value !== zeroed[index])) throw new Error('Bypassed RF/VHS differs from active zero-amount legacy stages');
    const size = 128;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4 + 3, expected = (x + y) % 5 ? 255 : 96;
      if (first[index] !== expected || bypassPixels[index] !== expected) throw new Error(`Analog graph changed source alpha at ${x},${y}`);
    }
    const validation = await device.popErrorScope(); if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    return 'compiled default equals fixed legacy schedule; RF/VHS bypass equality; source alpha preserved';
  } finally { runtime.clear(); device.destroy(); }
}

const output = document.querySelector<HTMLElement>('#result');
checkAnalogSignalGpu().then(message => { if (output) output.textContent = `PASS: ${message}`; })
  .catch(error => { if (output) output.textContent = `FAIL: ${String(error)}`; });
