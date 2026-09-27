import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockPointRasterizer } from '../../src/engine/flock/gpu/FlockPointRasterizer';
import { RENDER_BLOCK_BYTES } from '../../src/engine/flock/gpu/flockRenderPacking';
import { LIGHT_PARAMS_FLOATS } from '../../src/engine/flock/gpu/flockLighting';

/** GPU differential test: actual sprite pipelines vs compute + scene-depth resolve. */
async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const pipelines = new FlockGpuPipelines(device);
  const rasterizer = new FlockPointRasterizer(device, pipelines);
  const size = 64, count = 512;
  const buffers: GPUBuffer[] = [], textures: GPUTexture[] = [];
  const buffer = (data: ArrayBufferView, usage: GPUBufferUsageFlags) => {
    const b = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    buffers.push(b); return b;
  };
  const texture = (format: GPUTextureFormat, usage: GPUTextureUsageFlags) => {
    const t = device.createTexture({ size: [size, size], format, usage }); textures.push(t); return t;
  };
  const states = new Float32Array(count * 16);
  const records = new ArrayBuffer(count * 16);
  const positions = new Float32Array(records), colors = new Uint32Array(records);
  for (let i = 0; i < count; i++) {
    const x = (((i * 17) % 70) + 0.625) / size * 2 - 1;
    const y = 1 - (((i * 29) % 70) + 0.625) / size * 2;
    const z = i % 11 === 0 ? -0.1 : i % 13 === 0 ? 1.1 : (i % 7 + 1) / 9;
    states.set([x, y, z, 0], i * 16);
    states[i * 16 + 12] = (i % 19) / 19;
    positions.set([x, y, z], i * 4);
    colors[i * 4 + 3] = (0xff000000 | ((i * 31) & 255) << 16 | ((i * 13) & 255) << 8 | ((i * 7) & 255)) >>> 0;
  }
  // Three exactly coincident records, ending with green: tests deterministic ties.
  for (let i = count - 3; i < count; i++) {
    states.set([0.015625, -0.015625, 0.1], i * 16);
    positions.set([0.015625, -0.015625, 0.1], i * 4);
    colors[i * 4 + 3] = i === count - 1 ? 0xff00ff00 : 0xff0000ff;
  }
  const state = buffer(states, GPUBufferUsage.STORAGE);
  const cache = buffer(new Uint8Array(records), GPUBufferUsage.STORAGE);
  const frame = new Float32Array(RENDER_BLOCK_BYTES / 4);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  frame.set(identity, 0); frame.set(identity, 16);
  frame.set([0, 0, 3, 1], 32); frame.set([1, 0, 0, 0], 36); frame.set([0, 1, 0, 1], 40);
  frame.set([size, size, count, 100, 16, 0, 1e6, size / 2], 44);
  const light = frame.length - LIGHT_PARAMS_FLOATS;
  frame.set(identity, light); frame.set([0.3, 0.4, 0.8660254, 0], light + 16);
  frame.set([0.3, 0.7, 1 / size, 0.001], light + 20);
  const frameBuffer = buffer(frame, GPUBufferUsage.UNIFORM);
  const branch = new Float32Array(64);
  branch[3] = 1; branch[16] = -1; branch[17] = -1; branch[31] = 1; branch[40] = 2; branch[42] = 1; branch[46] = 1;
  const branchBuffer = buffer(branch, GPUBufferUsage.UNIFORM);
  const pigment = texture('rgba8unorm', GPUTextureUsage.TEXTURE_BINDING);
  const shadow = texture('depth32float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
  const identityMap = buffer(new Uint32Array(count * 2 + 1), GPUBufferUsage.STORAGE);
  const frameGroup = device.createBindGroup({ layout: pipelines.frameLayout, entries: [
    { binding: 0, resource: { buffer: frameBuffer } }, { binding: 1, resource: { buffer: state } }, { binding: 2, resource: { buffer: state } },
    { binding: 3, resource: shadow.createView() }, { binding: 4, resource: device.createSampler({ compare: 'less-equal' }) },
    { binding: 5, resource: { buffer: identityMap } },
  ] });
  const branchGroup = device.createBindGroup({ layout: pipelines.getBranchLayout('points'), entries: [
    { binding: 0, resource: { buffer: branchBuffer } }, { binding: 8, resource: pigment.createView() }, { binding: 9, resource: device.createSampler() },
  ] });
  const cacheGroup = device.createBindGroup({ layout: pipelines.pointCacheRenderLayout, entries: [{ binding: 0, resource: { buffer: cache } }] });
  const groups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] = [frameGroup, branchGroup, cacheGroup];
  const target = rasterizer.ensure('test', size, size, count)!;
  // Force multiple dispatch rows without allocating tens of millions of points.
  target.dispatchWidth = 256;
  device.queue.writeBuffer(target.params, 0, new Uint32Array([size, size, count, 256]));
  const color = texture('rgba8unorm', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  const sceneDepth = texture('depth24plus', GPUTextureUsage.RENDER_ATTACHMENT);
  const shadowDepth = texture('depth32float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  const readback = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  buffers.push(readback);

  async function render(compute: boolean, shadowOnly = false, clearDepth = 1) {
    device.pushErrorScope('validation');
    device.queue.writeBuffer(branchBuffer, 0, branch);
    const encoder = device.createCommandEncoder();
    if (compute) {
      rasterizer.encode(encoder, 'clearPixels', target, groups);
      rasterizer.encode(encoder, shadowOnly ? 'shadowDepth' : 'pointDepth', target, groups);
      if (!shadowOnly) rasterizer.encode(encoder, 'pointWinner', target, groups);
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: shadowOnly ? [] : [{ view: color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.1, 0.2, 0.3, 1] }],
      depthStencilAttachment: { view: (shadowOnly ? shadowDepth : sceneDepth).createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: clearDepth },
    });
    if (compute) rasterizer.draw(pass, target, groups, shadowOnly);
    else {
      pass.setPipeline(shadowOnly ? pipelines.getShadowPipeline('points') : pipelines.getRenderPipeline('pointsCached', 'opaque'));
      pass.setBindGroup(0, frameGroup); pass.setBindGroup(1, branchGroup);
      if (!shadowOnly) pass.setBindGroup(2, cacheGroup);
      pass.draw(6, count);
    }
    pass.end();
    encoder.copyTextureToBuffer({ texture: shadowOnly ? shadowDepth : color, ...(shadowOnly ? { aspect: 'depth-only' as const } : {}) }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readback.getMappedRange()).slice(); readback.unmap();
    const error = await device.popErrorScope(); if (error) throw new Error(error.message);
    return data;
  }

  const results: Record<string, unknown>[] = [];
  try {
    for (const shape of [0, 1, 2, 3, 4]) for (const lit of [false, true]) for (const occluded of [false, true]) {
      branch[7] = 2 * 1080 / size; branch[10] = shape; branch[31] = lit ? 0 : 1;
      const direct = await render(false, false, occluded ? 0.35 : 1);
      const compute = await render(true, false, occluded ? 0.35 : 1);
      let mismatches = 0, maxDelta = 0;
      for (let i = 0; i < direct.length; i++) { const d = Math.abs(direct[i] - compute[i]); if (d > 2) mismatches++; maxDelta = Math.max(maxDelta, d); }
      if (mismatches > 0) throw new Error(`shape ${shape}, lit ${lit}, occlusion ${occluded}: ${mismatches} differing bytes, max delta ${maxDelta}`);
      if (shape === 0 && !lit) {
        const p = (32 * size + 32) * 4;
        if (compute[p] !== 0 || compute[p + 1] !== 255 || compute[p + 2] !== 0) throw new Error('Equal-depth winner was not the final green point');
      }
      results.push({ shape, lit, occluded, maxDelta });
    }
    branch[7] = 2;
    const direct = new Float32Array((await render(false, true)).buffer);
    const compute = new Float32Array((await render(true, true)).buffer);
    if (direct.some((value, index) => Math.abs(value - compute[index]) > 1e-6)) throw new Error('Compute shadows differ from parent particle sprite shadows');
    branch[7] = 2 * 1080 / size; branch[12] = 0.5; branch[10] = 0;
    const canonicalImage = await render(true);
    const reversed = new Float32Array(states.length), mapping = new Uint32Array(count * 2 + 1);
    mapping[0] = count;
    for (let i = 0; i < count; i++) {
      reversed.set(states.subarray(i * 16, i * 16 + 16), (count - 1 - i) * 16);
      mapping[1 + i] = count - 1 - i; mapping[1 + count + i] = count - 1 - i;
    }
    device.queue.writeBuffer(state, 0, reversed); device.queue.writeBuffer(identityMap, 0, mapping);
    const reorderedImage = await render(true);
    if (canonicalImage.some((v, i) => v !== reorderedImage[i])) throw new Error('Physical order changed cached point size/lighting');
    branch[7] = 2;
    const reorderedShadow = new Float32Array((await render(true, true)).buffer);
    if (compute.some((v, i) => v !== reorderedShadow[i])) throw new Error('Physical order changed parent shadows');
    await device.queue.onSubmittedWorkDone();
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: results.length + 3, cases: results, shadow: 'matched', reorderedIdentity: 'matched', adapter: adapter.info };
  } finally {
    rasterizer.dispose(); buffers.forEach(b => b.destroy()); textures.forEach(t => t.destroy()); device.destroy();
  }
}

check().then(result => {
  document.querySelector('#result')!.textContent = JSON.stringify({ success: true, ...result }, null, 2);
}).catch(error => {
  document.querySelector('#result')!.textContent = JSON.stringify({ success: false, error: String(error) });
});
