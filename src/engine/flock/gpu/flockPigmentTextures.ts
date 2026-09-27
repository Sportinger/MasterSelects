import { useMediaStore } from '../../../stores/mediaStore';
import { loadFlockPigmentBitmap } from './flockPigmentBitmap';

/**
 * Image assets sampled by render branches in `image` color mode ("data
 * pigments"): every particle keeps the color of the source pixel it was born
 * on. Textures are device-owned runtime handles and never enter project data.
 */

interface PigmentEntry {
  status: 'loading' | 'ready' | 'failed';
  texture?: GPUTexture;
  view?: GPUTextureView;
}

interface DevicePigments {
  entries: Map<string, PigmentEntry>;
  fallbackView: GPUTextureView;
  sampler: GPUSampler;
}

const byDevice = new WeakMap<GPUDevice, DevicePigments>();

function devicePigments(device: GPUDevice): DevicePigments {
  let state = byDevice.get(device);
  if (!state) {
    const fallback = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'flock-pigment-fallback',
    });
    device.queue.writeTexture({ texture: fallback }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    state = {
      entries: new Map(),
      fallbackView: fallback.createView(),
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', label: 'flock-pigment-sampler' }),
    };
    byDevice.set(device, state);
  }
  return state;
}

/** Texture view and sampler for an image media file id; a white 1x1 texture until it is loaded. */
export function getFlockPigmentBinding(
  device: GPUDevice,
  mediaFileId: string,
  onChange: () => void,
): { view: GPUTextureView; sampler: GPUSampler } {
  const state = devicePigments(device);
  const fallback = { view: state.fallbackView, sampler: state.sampler };
  if (!mediaFileId) return fallback;
  const file = useMediaStore.getState().files.find((candidate) => candidate.id === mediaFileId);
  if (!file?.url || file.type !== 'image') return fallback;
  const key = `${mediaFileId}|${file.url}`;
  const existing = state.entries.get(key);
  if (existing) return existing.view ? { view: existing.view, sampler: state.sampler } : fallback;
  state.entries.set(key, { status: 'loading' });
  void loadFlockPigmentBitmap(file.url).then((bitmap) => {
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: `flock-pigment-${file.name}`,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    bitmap.close();
    state.entries.set(key, { status: 'ready', texture, view: texture.createView() });
    onChange();
  }).catch(() => {
    state.entries.set(key, { status: 'failed' });
    onChange();
  });
  return fallback;
}
