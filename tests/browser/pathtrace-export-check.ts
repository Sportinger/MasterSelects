// The app enters the scene runtime through NativeSceneRenderer; importing it first keeps that module order.
import '../../src/engine/native3d/NativeSceneRenderer';
import { NativeSceneRuntime } from '../../src/engine/native3d/NativeSceneRuntime';
import { proceduralSkyHdr, referenceScenes } from './pathtraceScenes';
import { DEFAULT_COMPOSITION_RENDER_SETTINGS, DEFAULT_EXPORT_RENDER_QUALITY, type ExportRenderQuality } from '../../src/engine/native3d/pathtrace/contracts/ptTypes';
import { getNativeSceneExportProgress } from '../../src/engine/native3d/sceneRenderer/sceneExportProgress';
import type { NativeSceneExportFrame } from '../../src/engine/native3d/sceneRenderer/renderOptions';

/**
 * Path traced export against plan section 3: one 1080p frame at the export quality (256 spp + OIDN
 * "standard" by default), rendered the way the exporter drives it (calls until the scene reports the
 * frame complete), twice with fresh runtimes; the display images must match byte for byte. Reports
 * the time per frame. Query: ?scene=knit-form&spp=256&denoise=1&adaptive=0
 */
const WIDTH = 1920, HEIGHT = 1080;
const query = new URLSearchParams(location.search);
const SCENE = query.get('scene') ?? 'knit-form';
const QUALITY: ExportRenderQuality = { ...DEFAULT_EXPORT_RENDER_QUALITY, engine: 'path-traced', samplesPerPixel: Number(query.get('spp') ?? 256),
  denoise: query.get('denoise') !== '0', adaptiveThreshold: Number(query.get('adaptive') ?? 0) };

async function renderOnce(device: GPUDevice, hdrUrl: string): Promise<{ bytes: Uint8Array; ms: number; calls: number; samples: number }> {
  const scene = referenceScenes(WIDTH, HEIGHT, hdrUrl).find(item => item.id === SCENE)!;
  const runtime = new NativeSceneRuntime({ flockRuntime: () => { throw new Error('no flock'); }, isRealtime: () => false, sourceFingerprint: () => undefined });
  await runtime.initialize(WIDTH, HEIGHT);
  const exportFrame: NativeSceneExportFrame = { frameIndex: 7, quality: QUALITY, frameDuration: 1 / 30 };
  const settings = { ...DEFAULT_COMPOSITION_RENDER_SETTINGS, engine: 'path-traced' as const };
  const started = performance.now();
  let view: GPUTextureView | null = null, calls = 0;
  for (;;) {
    view = runtime.renderScene(device, scene.layers, scene.camera, [], false, null, null, 'main', undefined, { renderSettings: settings, exportFrame });
    calls++;
    const progress = getNativeSceneExportProgress(exportFrame.frameIndex);
    await (progress?.gpuDone ?? device.queue.onSubmittedWorkDone());
    if (!progress || progress.complete) break;
    // The exporter's gap between batches (ExportRenderSessionImpl), so the system stays responsive.
    await new Promise(resolve => setTimeout(resolve, 4));
    if (performance.now() - started > 300_000) throw new Error('export frame did not complete within 5 minutes');
  }
  const ms = performance.now() - started;
  const samples = getNativeSceneExportProgress(exportFrame.frameIndex)?.samples ?? 0;
  // Read the HDR scene color (rgba16float, what the tone map and compositor receive).
  const target = (runtime as unknown as { sceneTexture: GPUTexture }).sceneTexture;
  const bytesPerRow = Math.ceil(WIDTH * 8 / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [WIDTH, HEIGHT]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(buffer.getMappedRange().slice(0));
  buffer.destroy();
  runtime.dispose();
  return { bytes, ms, calls, samples };
}

async function run() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({ requiredFeatures: (['timestamp-query', 'shader-f16'] as GPUFeatureName[]).filter(f => adapter.features.has(f)),
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const hdrUrl = URL.createObjectURL(proceduralSkyHdr());
  try {
    const first = await renderOnce(device, hdrUrl);
    const second = await renderOnce(device, hdrUrl);
    let differing = 0, maxDelta = 0;
    for (let i = 0; i < first.bytes.length; i++) {
      const delta = Math.abs(first.bytes[i] - second.bytes[i]);
      if (delta) { differing++; maxDelta = Math.max(maxDelta, delta); }
    }
    // Alpha is the fourth half float of each pixel.
    let lit = 0;
    const halves = new Uint16Array(first.bytes.buffer);
    for (let i = 3; i < halves.length; i += 4) if (halves[i] !== 0) lit++;
    if (errors.length) throw new Error(errors.join('\n'));
    return { scene: SCENE, quality: QUALITY, first: { seconds: (first.ms / 1000).toFixed(2), calls: first.calls, samples: first.samples },
      second: { seconds: (second.ms / 1000).toFixed(2), calls: second.calls, samples: second.samples },
      coveredPixels: lit, bitIdentical: differing === 0, differingBytes: differing, maxDelta };
  } finally {
    URL.revokeObjectURL(hdrUrl);
    device.destroy();
  }
}

run().then(result => {
  document.querySelector('#result')!.textContent = `${result.bitIdentical && result.coveredPixels > 0 ? 'PASS' : 'FAIL'}\n${JSON.stringify(result, null, 2)}`;
}).catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
