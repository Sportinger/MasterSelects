import type { PtSceneFrame } from '../scene/ptSceneBuilder';

/** Versioned little-endian transport. GPU handles never enter project state or the helper protocol. */
export const PT_NATIVE_MAGIC = 0x5850534d;
export function packNativeSnapshot(frame: ArrayBuffer, lights: Float32Array, materials: Float32Array, records: ArrayBuffer[]): Blob {
  if (frame.byteLength !== 416 || records.length !== 3) throw new Error('Invalid native snapshot records');
  const chunks = [frame, lights.slice().buffer, materials.slice().buffer, ...records];
  const bytes = 64 + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (bytes > 1024 ** 3) throw new Error('Native snapshot exceeds 1 GiB');
  const header = new Uint32Array(16);
  header.set([PT_NATIVE_MAGIC, 1, ...chunks.map(chunk => chunk.byteLength)]);
  return new Blob([header, ...chunks], { type: 'application/octet-stream' });
}

/** Copy immediately on the same GPU queue, before any asynchronous wait can change the scene. */
export async function captureNativeSnapshot(device: GPUDevice, scene: PtSceneFrame, frame: ArrayBuffer, lights: Float32Array): Promise<Blob> {
  const encoder = device.createCommandEncoder({ label: 'optix-snapshot' });
  const capture = prepareNativeSnapshot(device, encoder, scene, frame, lights);
  device.queue.submit([encoder.finish()]);
  return capture.read();
}

/** Encode after geometry writes in the caller's command buffer; read only after it is submitted. */
export function prepareNativeSnapshot(device: GPUDevice, encoder: GPUCommandEncoder, scene: PtSceneFrame, frame: ArrayBuffer, lights: Float32Array) {
  const sources = [scene.objects, ...scene.fiberPages];
  const sizes = [scene.instanceCount * 128, ...scene.fiberPages.map(buffer => buffer.usage & GPUBufferUsage.COPY_SRC ? buffer.size : 0)];
  if (64 + frame.byteLength + lights.byteLength + scene.materials.byteLength + sizes.reduce((sum, bytes) => sum + bytes, 0) > 1024 ** 3) {
    throw new Error('Native snapshot exceeds 1 GiB');
  }
  const readbacks: GPUBuffer[] = [];
  const frozenFrame = frame.slice(0), frozenLights = lights.slice(), frozenMaterials = scene.materials.slice();
  const cancel = () => readbacks.forEach(buffer => buffer.destroy());
  try {
    sources.forEach((source, i) => {
      const staging = device.createBuffer({ size: Math.max(16, sizes[i]), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      readbacks.push(staging);
      if (sizes[i]) encoder.copyBufferToBuffer(source, 0, staging, 0, sizes[i]);
    });
    return { cancel, read: async () => {
      try {
        const records = await Promise.all(readbacks.map(async (buffer, i) => {
          await buffer.mapAsync(GPUMapMode.READ); return buffer.getMappedRange().slice(0, sizes[i]);
        }));
        return packNativeSnapshot(frozenFrame, frozenLights, frozenMaterials, records);
      } finally { cancel(); }
    } };
  } catch (error) { cancel(); throw error; }
}
