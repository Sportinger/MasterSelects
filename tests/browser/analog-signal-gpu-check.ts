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

type Rgba = [number, number, number, number];

/** Renders `source(x, y)` (0–1 RGBA) through the default graph at `width` x `height`; returns 0–1 RGBA rows. */
async function renderImage(device: GPUDevice, runtime: AnalogSignalRuntime, instanceId: string, width: number, height: number,
  source: (x: number, y: number) => Rgba, params: Record<string, number | string | boolean>): Promise<(x: number, y: number) => Rgba> {
  const definition = getEffect('analog-signal-lab');
  if (!isComputeEffectDefinition(definition)) throw new Error('Analog Signal Lab is unavailable');
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const input = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const output = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(source(x, y).map(value => Math.round(value * 255)), (y * width + x) * 4);
  device.queue.writeTexture({ texture: input }, data, { bytesPerRow: width * 4 }, [width, height]);
  const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  runtime.encode({ commandEncoder: encoder, definition, plan: compileAnalogSignalGraph(createDefaultAnalogSignalGraph(), { ...getDefaultParams('analog-signal-lab'), ...params }),
    instanceId, inputView: input.createView(), outputView: output.createView(), width, height, timelineTimeSeconds: 2.5 });
  encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ); const result = new Uint8Array(readback.getMappedRange().slice(0)); readback.unmap();
  input.destroy(); output.destroy(); readback.destroy();
  return (x, y) => [0, 1, 2, 3].map(channel => result[y * bytesPerRow + x * 4 + channel] / 255) as Rgba;
}

// Independent reference: plain BT.601 colour maths on the source colours.
const chroma = ([r, g, b]: Rgba) => [-.169 * r - .331 * g + .5 * b, .5 * r - .419 * g - .081 * b] as const;
const hue = (pixel: Rgba) => { const [cb, cr] = chroma(pixel); return Math.atan2(cr, cb) * 180 / Math.PI; };
const saturation = (pixel: Rgba) => Math.hypot(...chroma(pixel));
const hueDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const average = (read: (x: number, y: number) => Rgba, x0: number, x1: number, y0: number, y1: number): Rgba => {
  const sum: Rgba = [0, 0, 0, 0]; let count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, count++) read(x, y).forEach((value, channel) => { sum[channel] += value; });
  return sum.map(value => value / count) as Rgba;
};
const BARS: Rgba[] = [[.75, .75, 0, 1], [0, .75, .75, 1], [0, .75, 0, 1], [.75, 0, .75, 1], [.75, 0, 0, 1], [0, 0, .75, 1]];
const CLEAN = { rfAmount: 0, vhsAmount: 0, crtAmount: 0 };

/** PAL separation against independent colour maths: no colour from luma, true hues, VHS keeps hue and streaks its chroma noise. */
async function checkPalSeparation(device: GPUDevice, runtime: AnalogSignalRuntime): Promise<string> {
  // 1. Flat grey stays grey: the chroma demodulator rejects luma.
  const grey = await renderImage(device, runtime, 'pal-grey', 256, 144, () => [.5, .5, .5, 1], CLEAN);
  for (let y = 20; y < 124; y += 7) for (let x = 20; x < 236; x += 5) {
    const [r, g, b] = grey(x, y);
    if (Math.max(Math.abs(r - g), Math.abs(b - g)) > 4 / 255) throw new Error(`Flat grey decodes with colour at ${x},${y}: ${r} ${g} ${b}`);
  }
  // 2. Chroma Level 0 stays monochrome. Luma near the 4.43 MHz subcarrier becomes colour only through
  // Y/C Crosstalk: none at 0, and at the default only on stripes close to the subcarrier (cross-colour).
  const chromaStats = async (id: string, pattern: (x: number, y: number) => Rgba, params: Record<string, number>) => {
    const read = await renderImage(device, runtime, id, 1024, 192, pattern, { ...CLEAN, chromaLevel: 0, ...params });
    const values: number[] = [];
    for (let y = 8; y < 184; y += 3) for (let x = 16; x < 1008; x += 3) values.push(saturation(read(x, y)));
    values.sort((a, b) => a - b);
    return { mean: values.reduce((a, b) => a + b) / values.length * 255, p99: values[Math.floor(values.length * .99)] * 255 };
  };
  // Stripes 2 to 9 px wide (1024 px span the 702-sample line: 4 to 5 px stripes sit at the subcarrier) and hard blocks.
  const fine = (x: number, y: number): Rgba => { const period = 2 + Math.floor(y / 24) % 8; const v = (Math.floor(x / period) + Math.floor(y / 37)) % 2 ? .85 : .2; return [v, v, v, 1]; };
  const coarse = (x: number, y: number): Rgba => { const period = 8 + 2 * (Math.floor(y / 24) % 5); const v = (Math.floor(x / period) + Math.floor(y / 37)) % 2 ? .85 : .2; return [v, v, v, 1]; };
  const separated = await chromaStats('pal-mono-separated', fine, { ycCrosstalk: 0 });
  if (separated.mean > 2 || separated.p99 > 8) throw new Error(`Y/C Crosstalk 0 still shows colour on fine detail: mean ${separated.mean.toFixed(1)}, p99 ${separated.p99.toFixed(1)} (of 255)`);
  const ordinary = await chromaStats('pal-mono-coarse', coarse, {});
  if (ordinary.mean > 4 || ordinary.p99 > 12) throw new Error(`Chroma Level 0 shows colour on ordinary detail: mean ${ordinary.mean.toFixed(1)}, p99 ${ordinary.p99.toFixed(1)} (of 255)`);
  const crossColour = await chromaStats('pal-mono-fine', fine, {});
  if (crossColour.p99 > 40) throw new Error(`Default cross-colour on fine stripes is not subtle: p99 ${crossColour.p99.toFixed(1)} of 255`);
  const mean = ordinary.mean;
  // 3. Colour bars keep their hue and saturation through PAL, and through a VHS LP transport.
  const bars = (x: number): Rgba => BARS[Math.min(BARS.length - 1, Math.floor(x / 64))];
  const notes: string[] = [];
  for (const [name, params, minimum] of [['PAL', CLEAN, .85], ['VHS LP', { rfAmount: 0, crtAmount: 0, vhsAmount: 1, tapeSpeed: 'lp', tracking: 0, dropout: 0,
    headSwitching: 0, tapeWear: .2, chromaBleed: .3, timebaseError: .2 }, .75]] as const) {
    const read = await renderImage(device, runtime, `pal-bars-${name}`, 384, 96, bars, params);
    const ratios: number[] = [];
    BARS.forEach((bar, index) => {
      const decoded = average(read, index * 64 + 22, index * 64 + 42, 30, 66);
      if (hueDistance(hue(decoded), hue(bar)) > 12) throw new Error(`${name} bar ${index}: hue ${hue(decoded).toFixed(0)} instead of ${hue(bar).toFixed(0)}`);
      ratios.push(saturation(decoded) / saturation(bar));
    });
    if (Math.min(...ratios) < minimum || Math.max(...ratios) > 1.15) throw new Error(`${name} saturation ratios ${ratios.map(value => value.toFixed(2)).join(' ')}`);
    notes.push(`${name} saturation ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}`);
  }
  // 4. VHS chroma noise streaks sideways: correlated along the line, independent between lines.
  const worn = await renderImage(device, runtime, 'pal-vhs-noise', 720, 288, () => [.5, .5, .5, 1],
    { rfAmount: 0, crtAmount: 0, vhsAmount: 1, tapeSpeed: 'lp', tapeWear: 1, tracking: 0, dropout: 0, headSwitching: 0, decoder: 'simple' });
  const cb = (x: number, y: number) => chroma(worn(x, y))[0];
  const correlation = (dx: number, dy: number) => {
    let sum = 0, a2 = 0, b2 = 0;
    for (let y = 20; y < 260; y += 2) for (let x = 40; x < 680; x += 3) { const a = cb(x, y), b = cb(x + dx, y + dy); sum += a * b; a2 += a * a; b2 += b * b; }
    return sum / Math.sqrt(a2 * b2);
  };
  const along = correlation(6, 0), across = correlation(0, 1);
  if (!(along > .5 && across < .35)) throw new Error(`VHS chroma noise is not streaky: along ${along.toFixed(2)}, across ${across.toFixed(2)}`);
  return `PAL grey stays grey; Chroma Level 0: ordinary detail mean ${mean.toFixed(1)}/255, crosstalk 0 p99 ${separated.p99.toFixed(1)}/255, `
    + `default cross-colour on subcarrier stripes p99 ${crossColour.p99.toFixed(1)}/255; ${notes.join(', ')}; VHS chroma noise along ${along.toFixed(2)} / across ${across.toFixed(2)}`;
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
    const separation = await checkPalSeparation(device, runtime);
    const validation = await device.popErrorScope(); if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    return `compiled default equals fixed legacy schedule; RF/VHS bypass equality; source alpha preserved; ${separation}`;
  } finally { runtime.clear(); device.destroy(); }
}

const output = document.querySelector<HTMLElement>('#result');
checkAnalogSignalGpu().then(message => { if (output) output.textContent = `PASS: ${message}`; })
  .catch(error => { if (output) output.textContent = `FAIL: ${String(error)}`; });
