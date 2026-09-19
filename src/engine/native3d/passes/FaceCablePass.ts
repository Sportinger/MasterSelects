import type { SceneCamera, SceneFaceCableLayer, SceneLightLayer, ScenePlaneLayer } from '../../scene/types';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { decodeCableScene } from '../../../services/faceCables/cableSceneData';
import { buildCableSceneGeometry } from './faceCablePass/geometry';
import { cableSceneLights } from './faceCablePass/lighting';
import { createCableSceneResources, CABLE_SCENE_UNIFORM_FLOATS } from './faceCablePass/resources';
import { Logger } from '../../../services/logger';

interface GeometryCache {
  data: unknown; frame: number; vertices: GPUBuffer; indices: GPUBuffer;
  geometry: NonNullable<ReturnType<typeof buildCableSceneGeometry>>;
}
/** Native scene geometry, depth-tested against other objects; light maps refresh independently of the physics bake. */
export class FaceCablePass {
  private resources?: ReturnType<typeof createCableSceneResources>;
  private device?: GPUDevice;
  private geometry = new Map<string, GeometryCache>();
  private shadows = new Map<string, GPUTexture>();
  private lastInvalid = '';
  dispose() {
    this.geometry.forEach(g => { g.vertices.destroy(); g.indices.destroy(); }); this.geometry.clear();
    this.shadows.forEach(t => t.destroy()); this.shadows.clear(); this.resources = undefined; this.device = undefined;
  }
  releaseTarget(key: string) {
    for (const [id, g] of this.geometry) if (id.startsWith(`${key}:`)) { g.vertices.destroy(); g.indices.destroy(); this.geometry.delete(id); }
    for (const [id, texture] of this.shadows) if (id.startsWith(`${key}:`)) { texture.destroy(); this.shadows.delete(id); }
  }
  render(device: GPUDevice, encoder: GPUCommandEncoder, color: GPUTextureView, depth: GPUTextureView,
    layers: SceneFaceCableLayer[], lights: SceneLightLayer[], camera: SceneCamera, target: string,
    resolveTexture: (layer: ScenePlaneLayer) => GPUTextureView | null, temporary: GPUBuffer[]) {
    if (!layers.length) { this.releaseTarget(target); return true; }
    if (this.device !== device) { this.dispose(); this.device = device; }
    this.resources ??= createCableSceneResources(device);
    const r = this.resources;
    const active = new Set(layers.map(l => `${target}:${l.layerId}`));
    for (const [id, g] of this.geometry) if (id.startsWith(`${target}:`) && !active.has(id)) {
      g.vertices.destroy(); g.indices.destroy(); this.geometry.delete(id); this.shadows.get(id)?.destroy(); this.shadows.delete(id);
    }
    const upload = (data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags, retained = false) => {
      const buffer = device.createBuffer({ size: Math.max(4, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
      if (!retained) temporary.push(buffer);
      return buffer;
    };
    for (const layer of layers) {
      const bake = decodeCableScene(layer.cableParams.sceneData), time = Number(layer.cableParams.cableTime);
      if (!bake || !Number.isFinite(time) || time < 0 || time >= bake.duration) {
        const invalid = `${layer.layerId}:${!!bake}:${time}`;
        if (invalid !== this.lastInvalid) Logger.create('FaceCablePass').warn('No valid 3D cable frame', { validBake: !!bake, time, dataLength: String(layer.cableParams.sceneData ?? '').length });
        this.lastInvalid = invalid; continue;
      }
      const texture = resolveTexture({ ...layer, kind: 'plane' });
      if (!texture) return false;
      const id = `${target}:${layer.layerId}`, frame = Math.floor(time * bake.fps + 1e-5);
      let cached = this.geometry.get(id);
      if (!cached || cached.data !== bake || cached.frame !== frame) {
        const geometry = buildCableSceneGeometry(bake, time);
        if (!geometry) continue;
        if (cached) { const old = cached; void device.queue.onSubmittedWorkDone().then(() => { old.vertices.destroy(); old.indices.destroy(); }).catch(() => {}); }
        cached = { data: bake, frame, geometry, vertices: upload(geometry.vertices, GPUBufferUsage.VERTEX, true), indices: upload(geometry.indices, GPUBufferUsage.INDEX, true) };
        this.geometry.set(id, cached);
      }
      let shadow = this.shadows.get(id);
      if (!shadow) {
        shadow = device.createTexture({ size: [2048, 2048, 4], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.shadows.set(id, shadow);
      }
      // Aim the light shadow frustum at the face, in the same world coordinates as scene lights.
      const m = layer.worldMatrix, vertex = cached.geometry.vertices;
      const c = vertex.length >= 60 ? [vertex[48], vertex[49], vertex[50]] : [0, 0, 0];
      const center = [0, 1, 2].map(i => m[i] * c[0] + m[4 + i] * c[1] + m[8 + i] * c[2] + m[12 + i]);
      const lighting = cableSceneLights(lights, center);
      for (let i = 0; i < 4; i++) {
        const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
          view: shadow.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        if (lighting[i]?.shadows) {
          const uniform = upload(multiplyMat4(lighting[i].projection, m), GPUBufferUsage.UNIFORM);
          pass.setPipeline(r.shadowPipeline); pass.setBindGroup(0, device.createBindGroup({ layout: r.shadowLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] }));
          pass.setVertexBuffer(0, cached.vertices); pass.setIndexBuffer(cached.indices, 'uint32');
          pass.drawIndexed(cached.geometry.indices.length - cached.geometry.casterStart, 1, cached.geometry.casterStart);
        }
        pass.end();
      }
      const uniforms = new Float32Array(CABLE_SCENE_UNIFORM_FLOATS);
      uniforms.set(multiplyMat4(multiplyMat4(camera.projectionMatrix, camera.viewMatrix), m)); uniforms.set(m, 16);
      lighting.forEach((l, i) => uniforms.set(l.data, 32 + i * 32));
      uniforms.set([lighting.length, layer.opacity, cached.geometry.outline.length / 4, (layer.videoRotation ?? 0) / 90], 160);
      uniforms.set(cached.geometry.outline, 164);
      const uniform = upload(uniforms, GPUBufferUsage.UNIFORM);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' }, label: 'native-face-cables-scene' });
      pass.setPipeline(r.pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: r.layout, entries: [
        { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: r.sampler }, { binding: 2, resource: texture },
        { binding: 3, resource: r.shadowSampler }, { binding: 4, resource: shadow.createView({ dimension: '2d-array' }) },
      ] }));
      pass.setVertexBuffer(0, cached.vertices); pass.setIndexBuffer(cached.indices, 'uint32'); pass.drawIndexed(cached.geometry.indices.length); pass.end();
    }
    return true;
  }
}
