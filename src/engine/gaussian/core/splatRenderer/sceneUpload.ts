export interface UploadableSplatData {
  splatCount: number;
  /** Canonical Float32Array: 14 floats per splat
   *  [x,y,z, sx,sy,sz, rw,rx,ry,rz, r,g,b, opacity] */
  data: Float32Array;
}

export const FLOATS_PER_SPLAT = 14;

export function getExpectedSplatFloatCount(splatCount: number): number {
  return splatCount * FLOATS_PER_SPLAT;
}

export function getSplatBufferByteSize(splatCount: number): number {
  return getExpectedSplatFloatCount(splatCount) * 4;
}

export function isUploadableSplatDataValid(data: UploadableSplatData): boolean {
  return data.splatCount > 0 && data.data.length >= getExpectedSplatFloatCount(data.splatCount);
}

export function createSplatDataBuffer(
  device: GPUDevice,
  clipId: string,
  data: UploadableSplatData,
): GPUBuffer {
  const byteLength = getSplatBufferByteSize(data.splatCount);
  const splatBuffer = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: `splat-data-${clipId}`,
  });

  device.queue.writeBuffer(splatBuffer, 0, data.data.buffer, data.data.byteOffset, byteLength);
  return splatBuffer;
}

export function createIdentityIndexBuffer(
  device: GPUDevice,
  count: number,
  clipId: string,
): GPUBuffer {
  const identityData = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    identityData[i] = i;
  }

  const buffer = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
    label: `splat-identity-indices-${clipId}`,
  });

  new Uint32Array(buffer.getMappedRange()).set(identityData);
  buffer.unmap();

  return buffer;
}

export function createSplatDataBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  dataBuffer: GPUBuffer,
  indexBuffer: GPUBuffer,
  label: string,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: dataBuffer } },
      { binding: 1, resource: { buffer: indexBuffer } },
    ],
    label,
  });
}

export interface SplatStorageBufferResource {
  buffer: GPUBuffer;
  splatCount: number;
}

export function getOrCreateEffectorStorageBuffer(
  device: GPUDevice,
  resources: Map<string, SplatStorageBufferResource>,
  clipId: string,
  splatCount: number,
): SplatStorageBufferResource {
  const existing = resources.get(clipId);
  if (existing && existing.splatCount === splatCount) {
    return existing;
  }

  if (existing) {
    existing.buffer.destroy();
  }

  const buffer = device.createBuffer({
    size: getSplatBufferByteSize(splatCount),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: `effector-output-${clipId}`,
  });

  const entry = { buffer, splatCount };
  resources.set(clipId, entry);
  return entry;
}

export function getOrCreateParticleStorageBuffer(
  device: GPUDevice,
  resources: Map<string, SplatStorageBufferResource>,
  clipId: string,
  splatCount: number,
): SplatStorageBufferResource {
  const existing = resources.get(clipId);
  if (existing && existing.splatCount === splatCount) {
    return existing;
  }

  if (existing) {
    existing.buffer.destroy();
  }

  const buffer = device.createBuffer({
    size: getSplatBufferByteSize(splatCount),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: `particle-output-${clipId}`,
  });

  const entry = { buffer, splatCount };
  resources.set(clipId, entry);
  return entry;
}

export function releaseEffectorStorageBuffer(
  resources: Map<string, SplatStorageBufferResource>,
  clipId: string,
): void {
  const entry = resources.get(clipId);
  if (entry) {
    entry.buffer.destroy();
    resources.delete(clipId);
  }
}

export function releaseParticleStorageBuffer(
  resources: Map<string, SplatStorageBufferResource>,
  clipId: string,
): void {
  const entry = resources.get(clipId);
  if (entry) {
    entry.buffer.destroy();
    resources.delete(clipId);
  }
}
