import { neighborFixture } from '../fixtures/flockNeighborFixtures';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';

export async function checkNeighborLayouts(device: GPUDevice) {
  const pipelines = new FlockGpuPipelines(device), context = { keyframesByProperty: indexFlockKeyframes([]) };
  const plain = new FlockGpuSession(device, pipelines, neighborFixture('none'), context);
  const rules = new FlockGpuSession(device, pipelines, neighborFixture('rules'), context);
  const links = new FlockGpuSession(device, pipelines, neighborFixture('links'), context);
  try {
    if (plain.hasNeighborGrid || !rules.hasNeighborGrid || !links.hasNeighborGrid) throw new Error('Wrong neighbor storage demand');
    for (const session of [plain, rules, links]) session.advanceTo(5, 5);
    const expected = await plain.sampleParticles(257);
    for (const session of [rules, links]) {
      const actual = await session.sampleParticles(257);
      for (let i = 0; i < 257; i++) for (let axis = 0; axis < 7; axis++) {
        const offset = i * 16 + axis;
        if (!Number.isFinite(actual[offset]) || Math.abs(actual[offset] - expected[offset]) > 1e-5) throw new Error(`Neighbor layout changed fluid state at ${offset}`);
      }
    }
    const encoder = device.createCommandEncoder();
    const linked = links.encodeLinks(encoder, { branchIndex: 0, radius: 3, perParticle: 2, fraction: 1, salt: 211 });
    const copy = device.createBuffer({ size: linked.buffer.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { entryPoint: 'copyLinks', module: device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read> source: array<u32>;
      @group(0) @binding(1) var<storage, read_write> copied: array<u32>;
      @compute @workgroup_size(64) fn copyLinks(@builtin(global_invocation_id) id: vec3u) {
        if (id.x < arrayLength(&source)) { copied[id.x] = source[id.x]; }
      }` }) } });
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: linked.buffer } }, { binding: 1, resource: { buffer: copy } },
    ] }));
    pass.dispatchWorkgroups(Math.ceil(linked.buffer.size / 4 / 64)); pass.end();
    const readback = device.createBuffer({ size: linked.buffer.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      encoder.copyBufferToBuffer(copy, 0, readback, 0, linked.buffer.size);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(readback.getMappedRange());
      if (!values.some(value => value < 257)) throw new Error('No neighbors rendered in link-only graph');
    } finally { readback.destroy(); copy.destroy(); }
    return { neighborLayouts: 'matched', fluidOnlyBytes: plain.stats.gpuBytes, withRulesBytes: rules.stats.gpuBytes, linksWithoutRules: true };
  } finally { plain.dispose(); rules.dispose(); links.dispose(); }
}
