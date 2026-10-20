import { GpuUniformRing } from '../../../core/gpuUniformRing';
import { invertMat4 } from '../../../native3d/pathtrace/runtime/ptFrameUniforms';
import { shWordsPerSplat } from '../../loaders/shPacking';

/** Bind group 2 of the splat draw: packed SH, output-to-source ids and the camera in scan space. */
export function createSplatShBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'splat-sh-bind-group-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
}

/**
 * Per-draw SH state. SH is evaluated like PlayCanvas: the camera-to-splat direction in the scan's own
 * (source-local) space, without the per-splat rotation that graph operations may apply.
 */
export class SplatShBinding {
  private ring: GpuUniformRing | null = null;
  private empty: GPUBuffer | null = null;
  private device: GPUDevice | null = null;

  bind(device: GPUDevice, layout: GPUBindGroupLayout, shBuffer: GPUBuffer | null, coeffsPerChannel: number,
    sourceIds: GPUBuffer, viewMatrix: Float32Array, worldMatrix: Float32Array): GPUBindGroup {
    if (this.device !== device) { this.dispose(); this.device = device; }
    this.ring ??= new GpuUniformRing(device, { label: 'splat-sh-params', size: 32 });
    this.empty ??= device.createBuffer({ label: 'splat-sh-empty', size: 16, usage: GPUBufferUsage.STORAGE });
    const v = viewMatrix;
    const eye = [-(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]), -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]), -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14])];
    const inv = invertMat4(worldMatrix);
    const params = new ArrayBuffer(32); const f = new Float32Array(params); const u = new Uint32Array(params);
    for (let row = 0; row < 3; row += 1) f[row] = inv[row] * eye[0] + inv[4 + row] * eye[1] + inv[8 + row] * eye[2] + inv[12 + row];
    const enabled = shBuffer && coeffsPerChannel > 0;
    u[4] = enabled ? coeffsPerChannel : 0; u[5] = enabled ? shWordsPerSplat(coeffsPerChannel) : 0;
    return device.createBindGroup({ layout, label: 'splat-sh-bind-group', entries: [
      { binding: 0, resource: { buffer: enabled ? shBuffer : this.empty } },
      { binding: 1, resource: { buffer: sourceIds } },
      { binding: 2, resource: { buffer: this.ring.write(params) } },
    ] });
  }

  /** Rewind the per-draw uniform slots; call once per rendered frame. */
  beginFrame(): void { this.ring?.beginFrame(); }

  dispose(): void { this.ring?.dispose(); this.ring = null; this.empty?.destroy(); this.empty = null; this.device = null; }
}
