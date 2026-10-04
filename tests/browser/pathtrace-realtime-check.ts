// The app enters the scene runtime through NativeSceneRenderer; importing it first keeps that module order.
import '../../src/engine/native3d/NativeSceneRenderer';
import { NativeSceneRuntime } from '../../src/engine/native3d/NativeSceneRuntime';
import { proceduralSkyHdr, referenceCamera, referenceScenes } from './pathtraceScenes';
import { DEFAULT_COMPOSITION_RENDER_SETTINGS, type CompositionRenderSettings } from '../../src/engine/native3d/pathtrace/contracts/ptTypes';
import { getPtStatus } from '../../src/engine/native3d/pathtrace/runtime/ptStatus';
import { getPtProfile, setPtProfiling, PT_PROFILE_STAGES } from '../../src/engine/native3d/pathtrace/runtime/ptPassProfiler';

/**
 * Path tracing preview against plan section 3: a camera flight around the reference scenes in the
 * realtime path (every frame changes the camera) at render scale 0.5 and 0.67 with 1080p output,
 * frame times measured to queue completion; then the camera holds still and the time until the
 * still image converges (and is denoised) is measured. Shows the last realtime frame and the still result.
 */
const WIDTH = 1920, HEIGHT = 1080, FRAMES = 90, WARMUP = 10, PREVIEW_WIDTH = 480, STILL_TIMEOUT_MS = 60_000;
const SCENES = (new URLSearchParams(location.search).get('scenes') ?? 'knit-form,standard-weave').split(',');
const SCALES = (new URLSearchParams(location.search).get('scales') ?? '0.5,0.67').split(',').map(Number);
const STILL = new URLSearchParams(location.search).get('still') !== '0';
/** animate=1: the yarn turns (geometry changes every frame, like animated yarn) instead of the camera. */
const ANIMATE = new URLSearchParams(location.search).get('animate') === '1';

const BLIT = /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}
@fragment fn fs(in: Out) -> @location(0) vec4f { return clamp(textureSample(source, linearSampler, in.uv), vec4f(0.0), vec4f(1.0)); }`;

const percentile = (values: number[], p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
};

async function run() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice({ requiredFeatures: (['timestamp-query', 'shader-f16'] as GPUFeatureName[]).filter(f => adapter.features.has(f)),
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  let phase = 'start';
  void device.lost.then(info => {
    if (info.reason === 'destroyed') return;
    const text = `device lost during ${phase}: ${info.reason} ${info.message}`;
    console.error(text);
    document.querySelector('#result')!.textContent = `FAIL: ${text}`;
  });
  const hdrUrl = URL.createObjectURL(proceduralSkyHdr());
  const previewHeight = Math.round(PREVIEW_WIDTH * HEIGHT / WIDTH);
  const blitModule = device.createShaderModule({ code: BLIT });
  const blit = device.createRenderPipeline({ layout: 'auto', vertex: { module: blitModule, entryPoint: 'vs' },
    fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const show = async (view: GPUTextureView, label: string, background: readonly number[]) => {
    const preview = device.createTexture({ size: [PREVIEW_WIDTH, previewHeight], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bytesPerRow = Math.ceil(PREVIEW_WIDTH * 4 / 256) * 256;
    const pixels = device.createBuffer({ size: bytesPerRow * previewHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: preview.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(blit);
    pass.setBindGroup(0, device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }, { binding: 1, resource: sampler }] }));
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: preview }, { buffer: pixels, bytesPerRow }, [PREVIEW_WIDTH, previewHeight]);
    device.queue.submit([encoder.finish()]);
    await pixels.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(pixels.getMappedRange());
    const image = new ImageData(PREVIEW_WIDTH, previewHeight);
    for (let y = 0; y < previewHeight; y++) for (let x = 0; x < PREVIEW_WIDTH; x++) {
      const source = y * bytesPerRow + x * 4, target = (y * PREVIEW_WIDTH + x) * 4, alpha = mapped[source + 3] / 255;
      for (let c = 0; c < 3; c++) image.data[target + c] = Math.round(mapped[source + c] + background[c] * 255 * (1 - alpha));
      image.data[target + 3] = 255;
    }
    pixels.unmap(); pixels.destroy(); preview.destroy();
    const figure = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption');
    canvas.width = PREVIEW_WIDTH; canvas.height = previewHeight; canvas.getContext('2d')!.putImageData(image, 0, 0);
    caption.textContent = label;
    figure.append(canvas, caption);
    document.querySelector('#frames')!.append(figure);
  };
  const rows: Record<string, string | number>[] = [];
  try {
    for (const scene of referenceScenes(WIDTH, HEIGHT, hdrUrl).filter(item => SCENES.includes(item.id))) {
      for (const scale of SCALES) {
        const runtime = new NativeSceneRuntime({ flockRuntime: () => { throw new Error('no flock in reference scenes'); }, isRealtime: () => false,
          sourceFingerprint: () => undefined });
        await runtime.initialize(WIDTH, HEIGHT);
        const settings: CompositionRenderSettings = { ...DEFAULT_COMPOSITION_RENDER_SETTINGS, engine: 'path-traced', renderScale: scale as CompositionRenderSettings['renderScale'] };
        const eye = [scene.camera.cameraPosition.x, scene.camera.cameraPosition.y, scene.camera.cameraPosition.z] as const;
        const target = [scene.camera.cameraTarget.x, scene.camera.cameraTarget.y, scene.camera.cameraTarget.z] as [number, number, number];
        const radius = Math.hypot(eye[0] - target[0], eye[2] - target[2]), start = Math.atan2(eye[0] - target[0], eye[2] - target[2]);
        const frames: number[] = [];
        const stages: Record<string, number[]> = {};
        // Every third frame is profiled per stage (profiled frames skip the budget's timestamps).
        let profiled = 0;
        phase = `${scene.id} ${scale} realtime`;
        let view: GPUTextureView | null = null;
        for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
          // A slow orbit: 0.4° per frame, like a camera move in the preview (or the yarn turning by as much).
          const angle = start + (ANIMATE ? 0 : frame * 0.007);
          const camera = referenceCamera(WIDTH, HEIGHT, [target[0] + Math.sin(angle) * radius, eye[1], target[2] + Math.cos(angle) * radius], target);
          if (ANIMATE) {
            const turn = frame * 0.007, c = Math.cos(turn), s = Math.sin(turn);
            const world = Float32Array.of(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1);
            scene.layers = scene.layers.map(layer => layer.kind === 'strands' ? { ...layer, worldMatrix: world } : layer);
          }
          setPtProfiling(frame >= WARMUP && frame % 3 === 0);
          const started = performance.now();
          view = runtime.renderScene(device, scene.layers, camera, [], false, null, null, 'main', undefined, { renderSettings: settings });
          await device.queue.onSubmittedWorkDone();
          if (frame >= WARMUP) frames.push(performance.now() - started);
          await new Promise(resolve => setTimeout(resolve, 0));
          const profile = getPtProfile();
          if (frame >= WARMUP && frame % 3 === 1 && Object.keys(profile).length) {
            profiled++;
            for (const stage of PT_PROFILE_STAGES) (stages[stage] ??= []).push(profile[stage] ?? 0);
          }
        }
        setPtProfiling(false);
        const moving = getPtStatus('main');
        await show(view!, `${scene.label} — realtime, scale ${scale}`, scene.background);
        // Hold still: accumulate until the target is reached and OIDN finished.
        const last = referenceCamera(WIDTH, HEIGHT, [target[0] + Math.sin(start + (WARMUP + FRAMES - 1) * 0.007) * radius, eye[1],
          target[2] + Math.cos(start + (WARMUP + FRAMES - 1) * 0.007) * radius], target);
        phase = `${scene.id} ${scale} still`;
        const stillStarted = performance.now();
        let visibleMs = 0, convergedMs = 0, firstDenoiseMs = 0, stillFrame = 0, lastSamples = 0, profiledSamples = 0;
        const stillCosts: number[] = [];
        let shownAtTwoSeconds = false;
        while (STILL && performance.now() - stillStarted < STILL_TIMEOUT_MS) {
          // Every fourth still frame measures the integrator's GPU time per pixel sample.
          const profileFrame = stillFrame++ % 4 === 0;
          setPtProfiling(profileFrame);
          view = runtime.renderScene(device, scene.layers, last, [], false, null, null, 'main', undefined, { renderSettings: settings });
          await device.queue.onSubmittedWorkDone();
          setPtProfiling(false);
          const status = getPtStatus('main');
          if (profileFrame) profiledSamples = (status?.samples ?? 0) - lastSamples;
          else if (profiledSamples > 0 && getPtProfile().integrate) {
            stillCosts.push(getPtProfile().integrate! * 1e6 / (profiledSamples * status!.renderSize.width * status!.renderSize.height));
            profiledSamples = 0;
          }
          lastSamples = status?.samples ?? 0;
          if (!shownAtTwoSeconds && performance.now() - stillStarted >= 2000) {
            shownAtTwoSeconds = true;
            await show(view!, `${scene.label} — 2 s after stopping, scale ${scale}, ${status?.samples} spp${(status?.denoisedSamples ?? 0) > 0 ? ' + OIDN' : ' (realtime warm-up)'}`,
              scene.background);
          }
          if (!visibleMs && status && status.samples >= 48) visibleMs = performance.now() - stillStarted;
          if (!firstDenoiseMs && (status?.denoisedSamples ?? 0) > 0) firstDenoiseMs = performance.now() - stillStarted;
          if (status?.state === 'converged') { convergedMs = performance.now() - stillStarted; break; }
          // OIDN runs asynchronously (tiles per animation frame); give it time between frames.
          if (status?.state === 'denoising' || (status?.denoisedSamples ?? 0) === 0) await new Promise(resolve => setTimeout(resolve, 4));
        }
        const still = getPtStatus('main');
        await show(view!, `${scene.label} — still, scale ${scale}, ${still?.samples} spp`, scene.background);
        const median = percentile(frames, 0.5);
        rows.push({ scene: scene.label, scale, 'render size': `${moving?.renderSize.width}x${moving?.renderSize.height}`,
          'frame ms median': median.toFixed(1), 'frame ms p95': percentile(frames, 0.95).toFixed(1), fps: (1000 / median).toFixed(1),
          'realtime ns/pixel': (moving?.nsPerSample ?? 0).toFixed(0),
          'GPU ms integrate / restir / cache / denoise': profiled ? PT_PROFILE_STAGES.map(stage => percentile(stages[stage] ?? [], 0.5).toFixed(1)).join(' / ') : 'n/a', 'still first OIDN s': (firstDenoiseMs / 1000).toFixed(2), 'still 48 spp s': (visibleMs / 1000).toFixed(2),
          'still converged + OIDN s': (convergedMs / 1000).toFixed(2), 'still ns/sample (budget / measured)': `${(still?.nsPerSample ?? 0).toFixed(0)} / ${percentile(stillCosts, 0.5).toFixed(0)}`,
          'GPU MB': ((still?.gpuBytes ?? 0) / 1048576).toFixed(0) });
        document.querySelector('#table')!.innerHTML = renderTable(rows);
        runtime.dispose();
      }
    }
  } finally {
    URL.revokeObjectURL(hdrUrl);
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { adapter: `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim(), rows };
}

function renderTable(rows: Record<string, string | number>[]) {
  const columns = Object.keys(rows[0] ?? {});
  return `<table><tr>${columns.map(column => `<th>${column}</th>`).join('')}</tr>${rows.map(row =>
    `<tr>${columns.map(column => `<td>${row[column]}</td>`).join('')}</tr>`).join('')}</table>`;
}

run().then(result => {
  document.querySelector('#result')!.textContent = `PASS\n${JSON.stringify(result, null, 2)}`;
}).catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
