import { reconstructSplatMesh } from './splatMesh';
import type { SplatGraphBranch } from '../../../types/splatGraph';
import type { SplatRenderOptions } from '../core/splatRenderer/renderParams';
import type { SplatCameraParams } from '../core/splatRenderer/cameraUniforms';

const shader = `
struct Settings { projection: mat4x4f, view: mat4x4f, world: mat4x4f, alpha: vec4f }
@group(0) @binding(0) var<uniform> s: Settings;
struct Output { @builtin(position) position: vec4f, @location(0) color: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) color: vec3f) -> Output {
  var o: Output; o.position = s.projection * s.view * s.world * vec4f(p, 1); o.color = color; return o;
}
@fragment fn fs(i: Output) -> @location(0) vec4f { return vec4f(i.color * s.alpha.yzw * s.alpha.x, s.alpha.x); }
`;
interface Mesh { vertices: GPUBuffer; indices: GPUBuffer; count: number }
/** Cache is per uploaded source; no independent re-centering or coordinate conversion. */
export class SplatMeshPass {
  private sources = new Map<string, { data: Float32Array; count: number; meshes: Map<string, Mesh> }>();
  private pipelines = new Map<string, GPURenderPipeline>();
  private uniforms: GPUBuffer[] = [];
  private cursor = 0;
  private retired: GPUBuffer[] = [];
  upload(id: string, data: Float32Array, count: number) { this.release(id); this.sources.set(id, { data, count, meshes: new Map() }); }
  getSource(id: string): Float32Array | undefined { return this.sources.get(id)?.data; }
  beginFrame() { this.cursor = 0; for (const b of this.retired) b.destroy(); this.retired = []; }
  render(device: GPUDevice, encoder: GPUCommandEncoder, id: string, mesh: NonNullable<SplatGraphBranch['mesh']>, camera: SplatCameraParams,
    world: Float32Array, view: GPUTextureView, options: SplatRenderOptions): GPUTextureView {
    // Wireframes contribute color without obstructing transparent scene depth.
    if (options.colorWrite === false) return view;
    const source = this.sources.get(id); if (!source) return view;
    const key = JSON.stringify([mesh.resolution, mesh.threshold, mesh.radius, mesh.crops ?? []]);
    let geometry = source.meshes.get(key);
    if (!geometry) {
      const cpu = reconstructSplatMesh(source.data, source.count, mesh);
      geometry = { vertices: device.createBuffer({ size: Math.max(24, cpu.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
        indices: device.createBuffer({ size: Math.max(4, cpu.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }), count: cpu.indices.length };
      if (cpu.vertices.length) device.queue.writeBuffer(geometry.vertices, 0, cpu.vertices.buffer as ArrayBuffer);
      if (cpu.indices.length) device.queue.writeBuffer(geometry.indices, 0, cpu.indices.buffer as ArrayBuffer);
      // Small LRU per source keeps interactive parameter editing bounded.
      if (source.meshes.size >= 4) { const first = source.meshes.keys().next().value!; const old = source.meshes.get(first)!; this.retired.push(old.vertices, old.indices); source.meshes.delete(first); }
      source.meshes.set(key, geometry);
    }
    const pipelineKey = options.depthView ? 'depth' : 'flat';
    let pipeline = this.pipelines.get(pipelineKey);
    if (!pipeline) {
      const module = device.createShaderModule({ code: shader });
      pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ] }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      } }] }, primitive: { topology: 'line-list' }, ...(options.depthView ? { depthStencil: { format: 'depth24plus' as const, depthWriteEnabled: false, depthCompare: 'less-equal' as const } } : {}) });
      this.pipelines.set(pipelineKey, pipeline);
    }
    const index = this.cursor++; const uniform = this.uniforms[index] ??= device.createBuffer({ size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const values = new Float32Array(52); values.set(camera.projectionMatrix); values.set(camera.viewMatrix, 16); values.set(world, 32); values.set(mesh.tint ?? [1, 1, 1], 49); values[48] = mesh.opacity * (options.layerOpacity ?? 1);
    device.queue.writeBuffer(uniform, 0, values);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: options.colorLoadOp ?? 'load', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      ...(options.depthView ? { depthStencilAttachment: { view: options.depthView, depthLoadOp: 'load' as const, depthStoreOp: 'store' as const } } : {}) });
    pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] }));
    pass.setVertexBuffer(0, geometry.vertices); pass.setIndexBuffer(geometry.indices, 'uint32'); pass.drawIndexed(geometry.count); pass.end(); return view;
  }
  release(id: string) { const source = this.sources.get(id); for (const m of source?.meshes.values() ?? []) { m.vertices.destroy(); m.indices.destroy(); } this.sources.delete(id); }
  dispose() { for (const id of this.sources.keys()) this.release(id); for (const u of this.uniforms) u.destroy(); this.uniforms = []; for (const b of this.retired) b.destroy(); this.retired = []; this.pipelines.clear(); this.cursor = 0; }
}
