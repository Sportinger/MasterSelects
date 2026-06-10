export interface SplatCameraParams {
  viewMatrix: Float32Array;       // 4x4 column-major
  projectionMatrix: Float32Array; // 4x4 column-major
  viewport: { width: number; height: number };
  fov: number;
  near: number;
  far: number;
}

export const CAMERA_UNIFORM_SIZE = 224;

export interface SplatCameraUniformResource {
  buffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export function createSplatCameraUniformResource(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  index: number,
): SplatCameraUniformResource {
  const buffer = device.createBuffer({
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: `splat-camera-uniforms-${index}`,
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer } },
    ],
    label: `splat-camera-bind-group-${index}`,
  });

  return { buffer, bindGroup };
}

export function writeSplatCameraUniforms(
  device: GPUDevice,
  resource: SplatCameraUniformResource,
  camera: SplatCameraParams,
  worldMatrix: Float32Array,
  layerOpacity: number,
  depthAlphaCutoff: number,
): GPUBindGroup {
  const data = new Float32Array(CAMERA_UNIFORM_SIZE / 4);

  data.set(camera.viewMatrix, 0);
  data.set(camera.projectionMatrix, 16);

  data[32] = camera.viewport.width;
  data[33] = camera.viewport.height;

  data.set(worldMatrix, 36);

  data[52] = layerOpacity;
  data[53] = depthAlphaCutoff;

  device.queue.writeBuffer(resource.buffer, 0, data);
  return resource.bindGroup;
}
