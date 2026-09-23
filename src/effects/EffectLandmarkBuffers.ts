import { getLandmarkEffectPoints } from '../services/landmarkTracking/landmarkRuntime';

/** Device-local landmark upload ownership, independent of effect pass routing. */
export class EffectLandmarkBuffers {
  private readonly buffers = new Map<string, GPUBuffer>();

  get(device: GPUDevice, effectId: string): GPUBuffer {
    let buffer = this.buffers.get(effectId);
    if (!buffer) {
      buffer = device.createBuffer({ label: `effect-landmarks-${effectId}`,
        size: (4 + 64 * 4) * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.buffers.set(effectId, buffer);
    }
    const points = getLandmarkEffectPoints(effectId).slice(0, 64);
    const packed = new Float32Array(4 + 64 * 4);
    packed[0] = points.length;
    points.forEach((point, index) => packed.set([point.x, point.y, point.z, point.visibility ?? 1], 4 + index * 4));
    device.queue.writeBuffer(buffer, 0, packed);
    return buffer;
  }

  destroy(): void {
    for (const buffer of this.buffers.values()) buffer.destroy();
    this.buffers.clear();
  }
}
