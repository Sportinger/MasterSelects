import { NativeSceneRuntime } from '../../src/engine/native3d/NativeSceneRuntime';
import { createCompositeResources } from '../../src/engine/native3d/sceneRenderer/pipelineResources';
import type { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import type { SceneCamera, SceneFlockLayer, ScenePrimitiveLayer } from '../../src/engine/scene/types';

/** Actual shared scene graph: move a native cube from in front of to behind the particles. */
export async function renderNativeSceneProbe(
  device: GPUDevice, context: GPUCanvasContext, runtime: FlockSimulationRuntime,
  layer: SceneFlockLayer, camera: SceneCamera,
): Promise<Uint8Array[]> {
  // Isolate pigment points for the depth assertion; the preceding probe already
  // covers model instances, which otherwise hide the points at the same positions.
  if (!layer.flock.program) throw new Error('Missing scene probe program');
  layer = { ...layer, flock: { ...layer.flock, program: { ...layer.flock.program,
    branches: layer.flock.program.branches.filter(branch => branch.kind === 'points'),
  } } };
  const scene = new NativeSceneRuntime({ flockRuntime: () => runtime,
    isRealtime: () => false, sourceFingerprint: () => undefined });
  await scene.initialize(camera.viewport.width, camera.viewport.height);
  const composite = createCompositeResources(device);
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, new Float32Array([1, 0, 0, 0]));
  const size = camera.viewport.width;
  const readback = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const cube: ScenePrimitiveLayer = { kind: 'primitive', meshType: 'cube', layerId: 'depth-cube', clipId: 'depth-cube',
    sourceWidth: size, sourceHeight: size, opacity: 1, blendMode: 'normal',
    worldMatrix: new Float32Array([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.12, 1]) };
  const images: Uint8Array[] = [];
  try {
    for (let frame = 0; frame < 3; frame++) {
      if (frame === 2) cube.worldMatrix[14] = 0.85;
      const view = scene.renderScene(device, frame ? [layer, cube] : [layer], camera, [], false);
      if (!view) throw new Error('Shared native scene did not render');
      const encoder = device.createCommandEncoder(), texture = context.getCurrentTexture();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(composite.pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: composite.bindGroupLayout, entries: [
        { binding: 0, resource: composite.sampler }, { binding: 1, resource: view },
        { binding: 2, resource: { buffer: uniform } },
      ] }));
      pass.draw(6); pass.end();
      encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      images.push(new Uint8Array(readback.getMappedRange().slice(0))); readback.unmap();
    }
    const green = images.map(pixels => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 20
        && pixels[i + 1] > pixels[i] * 2 && pixels[i + 1] > pixels[i + 2] * 2) count++;
      return count;
    });
    if (green[0] < 100 || green[1] !== 0 || green[2] !== green[0]) {
      throw new Error(`Shared cube/particle depth failed: ${green}`);
    }
    if (!images[1].some((value, i) => i % 4 !== 3 && value > 20)) throw new Error('Occluder was not visible');
    return images;
  } finally {
    await device.queue.onSubmittedWorkDone();
    scene.dispose(); uniform.destroy(); readback.destroy();
  }
}
