import type { SceneLightLayer } from '../../../scene/types';
import type { StrandShadowReceiver } from '../StrandPass';
import { MAX_MESH_LIGHTS } from './constants';

/** Uniform floats of a mesh's strand shadow: light view-projection, (light index, spacing, unused, strength), range. */
const RECEIVER_FLOATS = 24;

/** Bind group 1 of the mesh shader: one strand layer's deep opacity shadow (StrandShadowSample.wgsl). */
export function createMeshStrandShadowLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({ label: 'native-scene-mesh-strand-shadow-layout', entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ] });
}

/**
 * Index of `layerId` among the direct lights the mesh shader packs (see `writeMeshLights`), or -1.
 * Strands pick their shadowing light by layer, so the two packings may differ in order.
 */
export function meshLightIndex(lights: readonly SceneLightLayer[], layerId: string): number {
  let index = 0;
  for (const light of lights) {
    const settings = light.lightSettings;
    if (settings.kind === 'environment' || index >= MAX_MESH_LIGHTS || settings.intensity <= 0) continue;
    if (light.layerId === layerId) return index;
    index++;
  }
  return -1;
}

/** The strand shadow a mesh pass binds; 1 × 1 stand-ins when no strand layer casts. */
export class MeshStrandShadowBinding {
  private fallback: { textures: GPUTexture[]; depth: GPUTextureView; opacity: GPUTextureView; sampler: GPUSampler } | null = null;

  bindGroup(device: GPUDevice, layout: GPUBindGroupLayout, receiver: StrandShadowReceiver | null | undefined,
    lights: readonly SceneLightLayer[], temporaryBuffers: GPUBuffer[]): GPUBindGroup {
    const uniforms = new Float32Array(RECEIVER_FLOATS);
    const lightIndex = receiver ? meshLightIndex(lights, receiver.lightLayerId) : -1;
    if (receiver && lightIndex >= 0) uniforms.set(receiver.uniforms.subarray(0, RECEIVER_FLOATS));
    uniforms[16] = lightIndex;
    const buffer = device.createBuffer({ label: 'native-scene-mesh-strand-shadow', size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    temporaryBuffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, uniforms);
    const maps = receiver && lightIndex >= 0 ? receiver : this.stand(device);
    return device.createBindGroup({ layout, label: 'native-scene-mesh-strand-shadow', entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: maps.depth },
      { binding: 2, resource: maps.opacity },
      { binding: 3, resource: maps.sampler },
    ] });
  }

  private stand(device: GPUDevice) {
    if (!this.fallback) {
      const texture = (format: GPUTextureFormat) => device.createTexture({ label: `native-scene-mesh-strand-shadow-empty-${format}`,
        size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING });
      const textures = [texture('depth32float'), texture('rgba16float')];
      this.fallback = { textures, depth: textures[0].createView(), opacity: textures[1].createView(),
        sampler: device.createSampler({ label: 'native-scene-mesh-strand-shadow-empty' }) };
    }
    return this.fallback;
  }

  dispose(): void {
    this.fallback?.textures.forEach(texture => texture.destroy());
    this.fallback = null;
  }
}
