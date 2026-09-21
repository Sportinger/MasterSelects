import common from '../../src/effects/_shared/commonShader';
import { voxelRelief } from '../../src/effects/stylize/voxel-relief';
import { VoxelPass } from '../../src/engine/native3d/passes/VoxelPass';
import { resolveRenderableSharedSceneCamera } from '../../src/engine/scene/SceneCameraUtils';
import { createDefaultVoxelGraph } from '../../src/services/operators/voxelGraph';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import type { SceneVoxelLayer } from '../../src/engine/scene/types';
import { nodeScalarSampleTap } from '../../src/services/nodePreview/NodeScalarSampleTap';
import { createPrimitiveGeometry } from '../../src/engine/native3d/passes/meshPass/primitiveGeometry';

async function checkLegacyBoxVertexParity(device: GPUDevice): Promise<void> {
  const geometry = createPrimitiveGeometry('cube')!;
  const vertices = Float32Array.from(geometry.vertices), indices = Uint32Array.from(geometry.indices);
  const vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const mismatch = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(vertexBuffer, 0, vertices); device.queue.writeBuffer(indexBuffer, 0, indices);
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> vertices: array<f32>;
    @group(0) @binding(1) var<storage, read> indices: array<u32>;
    @group(0) @binding(2) var<storage, read_write> mismatch: atomic<u32>;
    fn frame(face: u32) -> mat3x3f { switch face {
      case 0u: { return mat3x3f(vec3f(0,1,0),vec3f(0,0,1),vec3f(1,0,0)); }
      case 1u: { return mat3x3f(vec3f(0,-1,0),vec3f(0,0,1),vec3f(-1,0,0)); }
      case 2u: { return mat3x3f(vec3f(-1,0,0),vec3f(0,0,1),vec3f(0,1,0)); }
      case 3u: { return mat3x3f(vec3f(1,0,0),vec3f(0,0,1),vec3f(0,-1,0)); }
      case 4u: { return mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1)); }
      default: { return mat3x3f(vec3f(1,0,0),vec3f(0,-1,0),vec3f(0,0,-1)); }
    } }
    @compute @workgroup_size(36) fn main(@builtin(local_invocation_index) i: u32) {
      let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
      let c = corners[i % 6u];
      let oldEdge = max(abs(c.x), abs(c.y));
      let base = indices[i] * 8u; let p = vec3f(vertices[base], vertices[base+1u], vertices[base+2u]) / 0.6;
      let n = vec3f(vertices[base+3u], vertices[base+4u], vertices[base+5u]); let a = abs(n);
      var uv = p.xy + vec2f(0.5);
      if (a.x >= a.y && a.x >= a.z) { uv = p.yz + vec2f(0.5); } else if (a.y >= a.z) { uv = p.xz + vec2f(0.5); }
      let newEdge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
      let onLegacyCube = abs(abs(dot(p, n)) - 0.5) <= 0.00001 && max(abs(p.x), max(abs(p.y), abs(p.z))) <= 0.50001;
      if (!onLegacyCube || abs(length(n) - 1.0) > 0.00001 || abs(oldEdge - newEdge) > 0.00001) { atomicAdd(&mismatch, 1u); }
    }` });
  const info = await module.getCompilationInfo(); const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`Box parity shader: ${errors.map(error => error.message).join('; ')}`);
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: vertexBuffer } }, { binding: 1, resource: { buffer: indexBuffer } }, { binding: 2, resource: { buffer: mismatch } },
  ] });
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(1); pass.end();
  encoder.copyBufferToBuffer(mismatch, 0, readback, 0, 4); device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
  const count = new Uint32Array(readback.getMappedRange())[0]; readback.unmap();
  vertexBuffer.destroy(); indexBuffer.destroy(); mismatch.destroy(); readback.destroy();
  if (count !== 0) throw new Error(`Default Box differs from legacy GPU geometry/edge inputs at ${count} vertices`);
}

/** Actual production shaders and uniform packers, with isolated synthetic pixels. */
export async function checkVoxelGpu(canvas: HTMLCanvasElement): Promise<string> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  await checkLegacyBoxVertexParity(device);
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  device.pushErrorScope('validation');
  const size = 128;
  const source = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([x * 2, y * 2, 255 - x, 255], (y * size + x) * 4);
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size]);
  const target = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size: [size, size], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const buffer = device.createBuffer({ size: size * size * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const module = device.createShaderModule({ code: common + '\n' + voxelRelief.shader });
  const diagnostics = await module.getCompilationInfo();
  const compilationErrors = diagnostics.messages.filter(message => message.type === 'error');
  if (compilationErrors.length) throw new Error(compilationErrors.map(error => `${error.lineNum}: ${error.message}`).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: voxelRelief.entryPoint, targets: [{ format: 'rgba8unorm' }] } });
  const native = new VoxelPass(); native.initialize(device);
  const camera = resolveRenderableSharedSceneCamera({ width: size, height: size }, 0, { previewCameraOverride: {
    position: { x: 1, y: 1, z: 3 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
    fov: 50, near: 0.1, far: 100, applyDefaultDistance: false, projection: 'perspective',
  } } as never);
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const base = { columns: 12, height: 0.7, tilt: 50, yaw: 20, floorBrightness: 0, temporalBlend: 0, reset: true, maxSteps: 128 };
  const inverted = createDefaultVoxelGraph();
  inverted.nodes.push({ id: 'invert', operator: 'math.subtract', bindings: { a: 'one' } });
  inverted.layout.invert = { x: 0, y: 0 };
  inverted.edges.push({ id: 'invert-input', from: 'clamp', output: 'value', to: 'invert', input: 'b' });
  inverted.edges = connectEffectGraph(inverted, { id: 'invert-output', from: 'invert', output: 'value', to: 'contrast', input: 'a' }).edges;
  const muted = createDefaultVoxelGraph(); muted.nodes.find(node => node.id === 'render')!.bypassed = true;
  const sphere = createDefaultVoxelGraph(); sphere.nodes.find(node => node.id === 'box')!.operator = 'geometry.sphere';
  const cylinder = createDefaultVoxelGraph(); cylinder.nodes.find(node => node.id === 'box')!.operator = 'geometry.cylinder';
  const variants = [base, { ...base, height: 0.15 }, { ...base, operatorGraph: JSON.stringify(inverted), one: 1 },
    { ...base, voxel_material_red: 0.1, voxel_uv_offsetU: 0.25, voxel_box_width: 0.5 }, { ...base, operatorGraph: JSON.stringify(muted) },
    { ...base, operatorGraph: JSON.stringify(sphere) }, { ...base, operatorGraph: JSON.stringify(cylinder) }];
  const results: string[] = [];
  try {
    for (const mode of ['2D', '3D']) {
      const hashes: number[] = [];
      for (let i = 0; i < variants.length; i++) {
        const params = variants[i], temporary: GPUBuffer[] = [];
        const sample = i === 0 ? nodeScalarSampleTap.request(mode === '2D' ? 'voxel-effect:gpu' : 'voxel-scene:fixture', 'fixture', mode, [1, 1, 0, 0], 12, mode === '3D') : undefined;
        const encoder = device.createCommandEncoder();
        if (mode === '2D') {
          if (sample) nodeScalarSampleTap.capture('voxel-effect:gpu', device, encoder, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), source.createView());
          const uniforms = voxelRelief.packUniforms(params, size, size)!;
          const uniform = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); temporary.push(uniform);
          device.queue.writeBuffer(uniform, 0, uniforms as Float32Array<ArrayBuffer>);
          const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
            { binding: 1, resource: source.createView() }, { binding: 2, resource: { buffer: uniform } }, { binding: 3, resource: source.createView() },
          ] });
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
          pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
        } else {
          const clear = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
            depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } }); clear.end();
          const layer: SceneVoxelLayer = { kind: 'voxel', layerId: 'fixture', clipId: 'fixture', opacity: 1, blendMode: 'normal', sourceWidth: size, sourceHeight: size, worldMatrix: identity, voxelParams: params };
          native.render(device, encoder, target.createView(), depth.createView(), [{ layer, textureView: source.createView() }], camera, temporary);
        }
        encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: size * 4 }, [size, size]);
        device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
        if (sample) { const rgba = await sample; if (!rgba || rgba[3] !== 1 || rgba.slice(0, 3).some(value => value <= 0 || value >= 1)) throw new Error(`${mode}: live numeric sample failed`); }
        const data = new Uint8ClampedArray(buffer.getMappedRange().slice(0)); buffer.unmap();
        let hash = 2166136261, alpha = 0;
        data.forEach((value, index) => { hash = Math.imul(hash ^ value, 16777619); if (index % 4 === 3) alpha += value; });
        hashes.push(hash >>> 0);
        if (i === 4 ? alpha !== 0 : alpha === 0) throw new Error(`${mode} variant ${i}: unexpected alpha ${alpha}`);
        if (i === 0) canvas.getContext('2d')!.putImageData(new ImageData(data, size, size), mode === '2D' ? 0 : size, 0);
        temporary.forEach(resource => resource.destroy());
      }
      if (new Set(hashes).size !== variants.length) throw new Error(`${mode}: a graph change did not change rendered pixels`);
      results.push(`${mode}: ${variants.length} pixel checks passed (${hashes.join(', ')})`);
    }
    const validation = await device.popErrorScope();
    if (validation || errors.length) throw new Error(validation?.message ?? errors.join('\n'));
    return results.join('\n');
  } finally { native.dispose(); buffer.destroy(); source.destroy(); target.destroy(); depth.destroy(); device.destroy(); }
}

/** A real GPU source for inline field readouts in this fixture only. */
export async function startVoxelProbeSource(): Promise<() => void> {
  const adapter = await navigator.gpu?.requestAdapter(); if (!adapter) return () => {};
  const device = await adapter.requestDevice();
  const source = device.createTexture({ size: [128, 128], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) pixels.set([x * 2, y * 2, 255 - x, 255], (y * 128 + x) * 4);
  device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: 512 }, [128, 128]);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const timer = setInterval(() => {
    if (!nodeScalarSampleTap.has('voxel-effect:relief')) return;
    const encoder = device.createCommandEncoder();
    nodeScalarSampleTap.capture('voxel-effect:relief', device, encoder, sampler, source.createView()); device.queue.submit([encoder.finish()]);
  }, 30);
  return () => { clearInterval(timer); source.destroy(); device.destroy(); };
}
