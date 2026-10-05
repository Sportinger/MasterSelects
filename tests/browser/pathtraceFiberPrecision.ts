import { PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL } from '../../src/engine/native3d/pathtrace/contracts/ptBindings';
import traverse from '../../src/engine/native3d/pathtrace/bvh/PtTraverse.wgsl?raw';
import surface from '../../src/engine/native3d/pathtrace/materials/PtSurfaceTexture.wgsl?raw';

/** Analytic cylinder/cap hits: subpixel radii must survive distant camera origins. */
export async function checkFiberPrecision(device: GPUDevice) {
  const code = [PT_COMMON_WGSL, PT_SCENE_BINDINGS_WGSL, surface, traverse, `
    @group(0) @binding(2) var<storage, read_write> distances: array<f32>;
    @compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id: vec3u) {
      let far = id.x >= 3u;
      let kind = id.x % 3u;
      let origin = vec3f(select(0.0, 0.004, kind == 1u), select(0.0, 0.052, kind == 2u), select(3.0, 1000.0, far));
      distances[id.x] = ptIntersectRoundCone(origin, vec3f(0.0, 0.0, -1.0),
        vec3f(0.0, -0.05, 0.0), vec3f(0.0, 0.05, 0.0), 0.003, 0.003).x;
    }`].join('\n');
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'probe' } });
  const output = device.createBuffer({ size: 24, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 24, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 2, resource: { buffer: output } }] }));
    pass.dispatchWorkgroups(6); pass.end(); encoder.copyBufferToBuffer(output, 0, readback, 0, 24); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange()));
    const expected = [2.997, -1, 3 - Math.sqrt(.003 ** 2 - .002 ** 2), 999.997, -1, 1000 - Math.sqrt(.003 ** 2 - .002 ** 2)];
    actual.forEach((value, i) => {
      if (!Number.isFinite(value) || Math.abs(value - expected[i]) > (i < 3 ? 2e-6 : 7e-5)) throw new Error(`Thin-fiber hit ${i}: ${value}, expected ${expected[i]}`);
    });
    return { passed: true, actual, expected };
  } finally { output.destroy(); readback.destroy(); }
}
