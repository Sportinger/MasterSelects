/**
 * Effect Lab: renders one effect through the real EffectsPipeline on fixed test images
 * and returns PNG data URLs. Driven by `scripts/effect-lab.mjs` (real GPU) for effect
 * review, regression comparison and documentation stills. Effects that need clip
 * context (masks, landmarks, temporal source, tracking) render without it here; check
 * those in the editor.
 */
import { EffectsPipeline } from '../../../src/effects/EffectsPipeline';
import { getAllEffects, getDefaultParams, getEffect } from '../../../src/effects';
import { guardGpuDevice, getGpuPipelineFailures } from '../../../src/engine/core/gpuPipelineGuard';
import { getEffectGpuFailure } from '../../../src/effects/effectGpuFailures';

export interface EffectLabJob {
  effectId: string;
  /** Overrides on top of the effect defaults. */
  params?: Record<string, number | boolean | string>;
  image: string;
  width?: number;
  height?: number;
  /** Timeline seconds of each rendered frame; feedback/temporal effects see them in order. */
  times?: number[];
  frameRate?: number;
  /** Return the scaled source image without the effect (the "original" column). */
  bypass?: boolean;
  /** Draw the image at this fraction of the frame, centred on transparency, to check alpha handling. */
  inset?: number;
}

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
  | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING;
const status = document.querySelector('#status')!;
let devicePromise: Promise<GPUDevice> | null = null;
let pipeline: EffectsPipeline | null = null;
let pipelineChanges = 0;
let scope = 0;
const images = new Map<string, Promise<ImageBitmap>>();

async function device(): Promise<GPUDevice> {
  devicePromise ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const gpu = guardGpuDevice(await adapter.requestDevice({ requiredFeatures: adapter.features.has('float32-filterable') ? ['float32-filterable'] : [] }), 'editor');
    pipeline = new EffectsPipeline(gpu, () => { pipelineChanges += 1; });
    return gpu;
  })();
  return devicePromise;
}

function loadImage(name: string): Promise<ImageBitmap> {
  if (!images.has(name)) images.set(name, fetch(new URL(`./images/${name}`, import.meta.url)).then(r => {
    if (!r.ok) throw new Error(`Test image ${name}: HTTP ${r.status}`);
    return r.blob();
  }).then(blob => createImageBitmap(blob, { colorSpaceConversion: 'none' })));
  return images.get(name)!;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function toPng(gpu: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<string> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const buffer = gpu.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = gpu.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  gpu.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) rgba.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  buffer.destroy();
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
}

/** Renders the job; the last frame is returned. Retries while pipelines are still compiling. */
async function render(job: EffectLabJob) {
  const gpu = await device();
  const definition = getEffect(job.effectId);
  if (!definition) throw new Error(`Unknown effect: ${job.effectId}`);
  const bitmap = await loadImage(job.image);
  const width = job.width ?? 960;
  const height = job.height ?? Math.round(width * bitmap.height / bitmap.width);
  const source = gpu.createTexture({ size: [width, height], format: 'rgba8unorm', usage: USAGE });
  let scaled: ImageBitmap | OffscreenCanvas = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  if (job.inset && job.inset > 0 && job.inset < 1) {
    const canvas = new OffscreenCanvas(width, height), inner = [Math.round(width * job.inset), Math.round(height * job.inset)];
    canvas.getContext('2d')!.drawImage(scaled, Math.round((width - inner[0]) / 2), Math.round((height - inner[1]) / 2), inner[0], inner[1]);
    scaled = canvas;
  }
  gpu.queue.copyExternalImageToTexture({ source: scaled }, { texture: source }, [width, height]);
  if (job.bypass) {
    const png = await toPng(gpu, source, width, height);
    source.destroy();
    return { png, width, height, renderMs: 0, gpuFailure: null, pipelineFailures: [] };
  }
  const ping = gpu.createTexture({ size: [width, height], format: 'rgba8unorm', usage: USAGE });
  const pong = gpu.createTexture({ size: [width, height], format: 'rgba8unorm', usage: USAGE });
  const sampler = gpu.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const sourceView = source.createView(), pingView = ping.createView(), pongView = pong.createView();
  const params = { ...getDefaultParams(job.effectId), ...job.params };
  const effect = { id: `lab-${job.effectId}`, type: job.effectId, name: definition.name, enabled: true, params };
  const times = job.times?.length ? job.times : [0];
  const scopeId = `effect-lab:${scope += 1}`;
  // Byte-texture effects (Memory Leak) pass the image through until their source has loaded
  // (the FFmpeg heap): wait for it, so the first rendered cell already shows the effect.
  const byteTexture = (definition as { byteTexture?: (p: typeof params, c: object) => unknown }).byteTexture;
  for (let wait = 0; byteTexture && wait < 150 && !byteTexture(params, { effectInstanceId: effect.id, width, height,
    timelineTimeSeconds: times[0], frameRate: job.frameRate ?? 30, scopeId }); wait += 1) await pause(100);
  const started = performance.now();
  let finalTexture: GPUTexture = source;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const changesBefore = pipelineChanges;
    for (const time of times) {
      const encoder = gpu.createCommandEncoder();
      const result = pipeline!.applyEffects(encoder, [effect] as never, sampler, sourceView, pingView, pingView,
        pongView, width, height, ping, pong, undefined, time, undefined, { frameRate: job.frameRate ?? 30, scopeId } as never);
      gpu.queue.submit([encoder.finish()]);
      finalTexture = result.finalView === pingView ? ping : result.finalView === pongView ? pong : source;
    }
    await gpu.queue.onSubmittedWorkDone();
    await pause(120);
    if (pipelineChanges === changesBefore && attempt > 0) break;
  }
  const png = await toPng(gpu, finalTexture, width, height);
  for (const texture of [source, ping, pong]) texture.destroy();
  return {
    png, width, height, renderMs: Math.round(performance.now() - started),
    gpuFailure: getEffectGpuFailure(job.effectId) ?? null,
    pipelineFailures: getGpuPipelineFailures().map(record => `${record.label}: ${record.message}`),
  };
}

function describe() {
  return getAllEffects().map(effect => ({
    id: effect.id, name: effect.name, category: effect.category,
    kind: (effect as { pipelineKind?: string }).pipelineKind ?? 'fullscreen',
    params: Object.fromEntries(Object.entries(effect.params ?? {}).map(([key, param]) => [key, {
      type: param.type, label: param.label, default: param.default, min: param.min, max: param.max,
      options: param.options?.map(option => option.value), hidden: param.hidden || undefined,
    }])),
  }));
}

Object.assign(window, { __effectLab: { render, describe } });
status.textContent = 'ready';
