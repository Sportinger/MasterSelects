import { Logger } from '../../services/logger';

const log = Logger.create('ExternalTextureSupport');
const reported = new WeakSet<GPUDevice>();

/**
 * Zero-copy video import (`importExternalTexture`, `texture_external`) is not
 * part of every WebGPU implementation: Firefox 157 exposes WebGPU without it,
 * and every shader, bind group layout or pipeline that names an external
 * texture becomes invalid there. Callers must use their copy paths instead.
 */
export function supportsExternalTextures(device: GPUDevice): boolean {
  const supported = typeof (device as Partial<GPUDevice>).importExternalTexture === 'function';
  if (!supported && !reported.has(device)) {
    reported.add(device);
    log.warn('WebGPU device has no external textures; video frames are copied into textures instead of imported zero-copy');
  }
  return supported;
}
