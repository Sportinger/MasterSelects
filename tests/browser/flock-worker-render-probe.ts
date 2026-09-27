import { FlockBranchRenderer, type FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';
import { FlockGpuAssetRegistry } from '../../src/engine/flock/gpu/FlockGpuAssetRegistry';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';
import { getFlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { getFlockMesh } from '../../src/engine/flock/gpu/flockMeshes';
import { resolveFlockRender } from '../../src/services/flock/compiler/flockParamEvaluation';
import type { FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';
import type { SceneCamera } from '../../src/engine/scene/types';
import { createWorkerGpuTargetSurface } from '../../src/services/render/workerGpuTargetSurface';

export interface FlockWorkerProbeInput {
  canvas: OffscreenCanvas;
  program: FlockProgram;
  pigment: ImageBitmap;
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
  const pipelines = getFlockGpuPipelines(device), evaluation = { keyframesByProperty: new Map() };
  const assets = new FlockGpuAssetRegistry(device);
  assets.setPigment('probe-pigment', input.pigment); input.pigment.close();
  assets.setModel('probe-model', getFlockMesh('cube'));
  const renderer = new FlockBranchRenderer(device, pipelines, assets);
  const session = new FlockGpuSession(device, pipelines, input.program, evaluation);
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
    // Birth, multiple APIC steps and cached shadows all run in the owning realm.
    for (let step = 4; step <= 12; step += 4) {
      session.advanceTo(step, 4);
      await device.queue.onSubmittedWorkDone();
    }
    for (let frame = 0; frame < 3; frame++) {
      if (frame === 1) assets.setModel('probe-model', getFlockMesh('tetra'));
      const encoder = device.createCommandEncoder();
      const texture = context.getCurrentTexture(), view = texture.createView();
      const clear = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
      clear.end();
      const plan: FlockDrawPlan = { layer: { clipId: 'worker-probe', worldMatrix: world }, session, program: input.program,
        render: resolveFlockRender(input.program, session.step / input.program.stepRate, evaluation), alpha: 1, links: new Map() };
      if (frame === 2) plan.render = { ...plan.render, branches: plan.render.branches.filter(branch => branch.spec.kind === 'points') };
      renderer.render(encoder, view, depth.createView(), [plan], camera, 'opaque', temporary);
      renderer.render(encoder, view, depth.createView(), [plan], camera, 'transparent', temporary);
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
    return { worker: typeof document === 'undefined', step: session.step, coloredPixels, pigmentPixels, images, particles };
  } finally {
    renderer.dispose(); session.dispose(); assets.dispose(); depth.destroy(); readback.destroy();
    temporary.forEach(buffer => buffer.destroy());
    // Leave the canvas and device alive so the final submitted frame remains visible.
  }
}
