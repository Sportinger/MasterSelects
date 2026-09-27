import type { FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';
import { FlockGpuAssetRegistry } from '../../src/engine/flock/gpu/FlockGpuAssetRegistry';
import { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import type { FlockRuntimeStatus } from '../../src/engine/flock/runtime/flockRuntimeApi';
import type { FlockDefinition } from '../../src/types/flock';
import type { Keyframe } from '../../src/types/keyframes';
import { getFlockMesh } from '../../src/engine/flock/gpu/flockMeshes';
import type { FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';
import type { SceneCamera } from '../../src/engine/scene/types';
import { createWorkerGpuTargetSurface } from '../../src/services/render/workerGpuTargetSurface';

export interface FlockWorkerProbeInput {
  canvas: OffscreenCanvas;
  program: FlockProgram;
  pigment: ImageBitmap;
  definition: FlockDefinition;
  keyframes: Keyframe[];
}

/** Same production simulation/render classes, executed in either realm for comparison. */
export async function renderFlockProbe(input: FlockWorkerProbeInput) {
  const size = 256;
  const created = await createWorkerGpuTargetSurface({ canvas: input.canvas, format: 'rgba8unorm', size: { width: size, height: size } });
  if (!created.surface) throw new Error(JSON.stringify(created.diagnostics));
  const { device, context } = created.surface;
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  // COPY_SRC is used only by this verification probe; production need not read pixels.
  context.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const assets = new FlockGpuAssetRegistry(device);
  assets.setPigment('probe-pigment', input.pigment); input.pigment.close();
  assets.setModel('probe-model', getFlockMesh('cube'));
  const statuses = new Map<string, FlockRuntimeStatus>();
  let renderRequests = 0;
  const runtime = new FlockSimulationRuntime({
    requestRender: () => { renderRequests++; }, renderAssets: () => assets,
    audioSampler: () => () => null, audioRevision: () => 0,
    modelState: id => ({ status: assets.model(id).mesh ? 'ready' : 'missing' }),
    status: { getStatus: id => statuses.get(id), publishStatus: status => { statuses.set(status.clipId, status); }, clearStatus: id => { statuses.delete(id); } },
  });
  const renderer = runtime.getRenderer(device);
  const depth = device.createTexture({ size: [size, size], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const readback = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const world = new Float32Array([30, 0, 0, 0, 0, 30, 0, 0, 0, 0, 10, 0, 0, 0, 0.5, 1]);
  const camera: SceneCamera = { viewMatrix: identity, projectionMatrix: identity,
    cameraPosition: { x: 0, y: 0, z: 10 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 },
    fov: 45, near: 0.1, far: 100, viewport: { width: size, height: size }, projection: 'orthographic', orthographicScale: 4 };
  const temporary: GPUBuffer[] = [];
  const images: Uint8Array[] = [];
  try {
    const prepareAt = async (sourceTime: number, keyframes = input.keyframes) => {
      const layer = { clipId: 'worker-probe', worldMatrix: world, flock: {
        clipId: 'worker-probe', definition: input.definition, program: input.program, diagnostics: [],
        keyframes, sourceTime, consumer: 'preview' as const,
      } };
      for (let attempt = 0; attempt < 100; attempt++) {
        const encoder = device.createCommandEncoder();
        const plan = runtime.prepare(device, encoder, layer, { realtime: false });
        device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        if (!plan) throw new Error('Runtime did not prepare the worker layer');
        if (runtime.entries.get('worker-probe|preview')?.caughtUp) return plan;
      }
      throw new Error('Runtime did not catch up');
    };
    let plan = await prepareAt(11 / 60);
    const session = plan.session;
    const beforeSeek = await session.sampleParticles(input.program.capacity);
    await prepareAt(4 / 60); await prepareAt(17 / 60); plan = await prepareAt(11 / 60);
    const afterSeek = await session.sampleParticles(input.program.capacity);
    if (beforeSeek.some((v, i) => v !== afterSeek[i])) throw new Error('Worker timeline seek/replay changed state');
    if (plan.session !== session) throw new Error('Worker frame request recreated its session');
    const editedKeys = input.keyframes.map(key => ({ ...key, value: Number(key.value) * 0.2 }));
    await prepareAt(11 / 60, editedKeys);
    const editedState = await session.sampleParticles(input.program.capacity);
    if (!beforeSeek.some((v, i) => v !== editedState[i])) throw new Error('Worker keyframe edit did not invalidate simulation');
    plan = await prepareAt(11 / 60);
    for (let frame = 0; frame < 3; frame++) {
      if (frame === 1) assets.setModel('probe-model', getFlockMesh('tetra'));
      const encoder = device.createCommandEncoder();
      const texture = context.getCurrentTexture(), view = texture.createView();
      const clear = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
      clear.end();
      const draw: FlockDrawPlan = { ...plan, alpha: 1 };
      if (frame === 2) draw.render = { ...draw.render, branches: draw.render.branches.filter(branch => branch.spec.kind === 'points') };
      renderer.render(encoder, view, depth.createView(), [draw], camera, 'opaque', temporary);
      renderer.render(encoder, view, depth.createView(), [draw], camera, 'transparent', temporary);
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      images.push(new Uint8Array(readback.getMappedRange().slice(0))); readback.unmap();
      temporary.splice(0).forEach(buffer => buffer.destroy());
    }
    const particles = await session.sampleParticles(input.program.capacity);
    await device.queue.onSubmittedWorkDone();
    if (errors.length) throw new Error(errors.join('\n'));
    const coloredPixels = images.map(image => {
      let count = 0; for (let i = 0; i < image.length; i += 4) if (image[i] + image[i + 1] + image[i + 2] > 20) count++;
      return count;
    });
    if (coloredPixels.some(count => count < 100)) throw new Error(`No useful particle image: ${coloredPixels}`);
    let pigmentPixels = 0;
    for (let i = 0; i < images[2].length; i += 4) {
      if (images[2][i + 1] > images[2][i] * 2 && images[2][i + 1] > images[2][i + 2] * 2) pigmentPixels++;
    }
    if (pigmentPixels < 100) throw new Error(`Transferred pigment was not rendered: ${pigmentPixels}`);
    const precompute = await runtime.requestPrecompute('worker-probe', { start: 0, end: 0.5 }, { persist: true });
    const persisted = runtime.entries.get('worker-probe|preview')?.persistedSteps ?? [];
    if (!precompute.ok || persisted.length !== 2) throw new Error(`Worker precompute failed: ${JSON.stringify(precompute)}, ${persisted}`);
    const persistedCheckpoints = persisted.length;
    await runtime.clearCache('worker-probe');
    return { persistedCheckpoints, persistentSession: true, seekReplay: true, keyframeInvalidation: true, renderRequests, statusCount: statuses.size, worker: typeof document === 'undefined', step: session.step, coloredPixels, pigmentPixels, images, particles };
  } finally {
    runtime.dispose(); assets.dispose(); depth.destroy(); readback.destroy();
    temporary.forEach(buffer => buffer.destroy());
    // Leave the canvas and device alive so the final submitted frame remains visible.
  }
}
