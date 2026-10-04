import type { SceneLightLayer } from '../../../scene/types';
import { ptLog } from '../ptCompute';

/** Widest environment map kept on the GPU; larger maps are box-filtered down. */
const MAX_WIDTH = 2048;

export interface PtEnvironmentImage { width: number; height: number; rgba: Float32Array }

/** Radiance RGBE (.hdr) with flat or new-style run-length scanlines. */
export function parseRadianceHdr(bytes: Uint8Array): PtEnvironmentImage {
  let offset = 0, line = '';
  const readLine = () => {
    line = '';
    while (offset < bytes.length && bytes[offset] !== 0x0a) line += String.fromCharCode(bytes[offset++]);
    offset++;
    return line;
  };
  if (!readLine().startsWith('#?')) throw new Error('Not a Radiance HDR file');
  while (readLine().length) { /* header lines up to the blank line */ }
  const size = /^-Y (\d+) \+X (\d+)$/.exec(readLine().trim());
  if (!size) throw new Error('Unsupported HDR orientation');
  const height = Number(size[1]), width = Number(size[2]);
  const rgba = new Float32Array(width * height * 4), scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 0x8000 && bytes[offset] === 2 && bytes[offset + 1] === 2 && ((bytes[offset + 2] << 8) | bytes[offset + 3]) === width) {
      offset += 4;
      for (let channel = 0; channel < 4; channel++) {
        for (let x = 0; x < width;) {
          let count = bytes[offset++];
          if (count > 128) {
            count -= 128;
            const value = bytes[offset++];
            for (let i = 0; i < count; i++) scan[(x++) * 4 + channel] = value;
          } else {
            for (let i = 0; i < count; i++) scan[(x++) * 4 + channel] = bytes[offset++];
          }
        }
      }
    } else {
      scan.set(bytes.subarray(offset, offset + width * 4));
      offset += width * 4;
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], scale = e ? 2 ** (e - 136) : 0, index = (y * width + x) * 4;
      rgba[index] = scan[x * 4] * scale; rgba[index + 1] = scan[x * 4 + 1] * scale; rgba[index + 2] = scan[x * 4 + 2] * scale; rgba[index + 3] = 1;
    }
  }
  return { width, height, rgba };
}

/** An LDR image file as linear radiance. */
export async function decodeImage(blob: Blob): Promise<PtEnvironmentImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const rgba = new Float32Array(pixels.length);
  const linear = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  for (let i = 0; i < pixels.length; i += 4) { rgba[i] = linear(pixels[i]); rgba[i + 1] = linear(pixels[i + 1]); rgba[i + 2] = linear(pixels[i + 2]); rgba[i + 3] = 1; }
  bitmap.close();
  return { width: bitmap.width, height: bitmap.height, rgba };
}

export function downsample(image: PtEnvironmentImage): PtEnvironmentImage {
  const factor = Math.ceil(image.width / MAX_WIDTH);
  if (factor <= 1) return image;
  const width = Math.floor(image.width / factor), height = Math.floor(image.height / factor), rgba = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const source = ((y * factor + dy) * image.width + x * factor + dx) * 4, target = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[target + c] += image.rgba[source + c] / (factor * factor);
    }
    rgba[(y * width + x) * 4 + 3] = 1;
  }
  return { width, height, rgba };
}

/**
 * Alias table (Vose) over texels weighted by luminance · sin θ, packed per texel as (threshold,
 * alias index, texel pmf, 0); PtLights.wgsl samples and evaluates it.
 */
export function buildEnvironmentAlias(image: PtEnvironmentImage): { table: Float32Array<ArrayBuffer>; averageLuminance: number } {
  const { width, height, rgba } = image, count = width * height;
  const weights = new Float64Array(count);
  let total = 0, luminanceSum = 0;
  for (let y = 0; y < height; y++) {
    const sinTheta = Math.sin(Math.PI * (y + 0.5) / height);
    for (let x = 0; x < width; x++) {
      const i = y * width + x, lum = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
      weights[i] = Math.max(lum, 0) * sinTheta + 1e-9;
      total += weights[i];
      luminanceSum += Math.max(lum, 0) * sinTheta;
    }
  }
  const table = new Float32Array(count * 4), scaled = new Float64Array(count), small: number[] = [], large: number[] = [];
  for (let i = 0; i < count; i++) {
    table[i * 4 + 2] = weights[i] / total;
    scaled[i] = weights[i] / total * count;
    (scaled[i] < 1 ? small : large).push(i);
  }
  while (small.length && large.length) {
    const s = small.pop()!, l = large.pop()!;
    table[s * 4] = scaled[s]; table[s * 4 + 1] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  for (const i of [...small, ...large]) { table[i * 4] = 1; table[i * 4 + 1] = i; }
  // Mean radiance over the sphere: Σ L sinθ ΔθΔφ / 4π with Δθ = π / H, Δφ = 2π / W.
  const averageLuminance = luminanceSum * (Math.PI / height) * (2 * Math.PI / width) / (4 * Math.PI);
  return { table, averageLuminance };
}

interface Entry {
  status: 'loading' | 'ready' | 'failed';
  texture?: GPUTexture;
  alias?: GPUTexture;
  averageLuminance: number;
}

/**
 * HDRIs of environment light clips, loaded once per URL and device. `requestRender` is called when
 * a map arrives so a paused preview picks it up; until then the light uses its color.
 */
export class PtEnvironmentCache {
  private readonly entries = new Map<string, Entry>();
  private device: GPUDevice | null = null;
  private fallback: { texture: GPUTexture; alias: GPUTexture } | null = null;

  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  private key(light: SceneLightLayer): string | null {
    return light.lightSettings.environmentMapUrl ?? null;
  }

  lookup(device: GPUDevice, light: SceneLightLayer): { averageLuminance: number } | null {
    if (this.device !== device) { this.dispose(); this.device = device; }
    const url = this.key(light);
    if (!url) return null;
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { status: 'loading', averageLuminance: 1 };
      this.entries.set(url, entry);
      void this.load(device, url, light.lightSettings.environmentMapFileName ?? url, entry);
    }
    return entry.status === 'ready' ? { averageLuminance: entry.averageLuminance } : null;
  }

  /** Map and alias textures of the bound environment light, or 1 × 1 placeholders. */
  textures(device: GPUDevice, light: SceneLightLayer | null): { map: GPUTextureView; alias: GPUTextureView } {
    const entry = light ? this.entries.get(this.key(light) ?? '') : undefined;
    if (entry?.status === 'ready' && entry.texture && entry.alias) return { map: entry.texture.createView(), alias: entry.alias.createView() };
    this.fallback ??= {
      texture: device.createTexture({ label: 'pt-environment-none', size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }),
      alias: device.createTexture({ label: 'pt-environment-alias-none', size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }),
    };
    return { map: this.fallback.texture.createView(), alias: this.fallback.alias.createView() };
  }

  private async load(device: GPUDevice, url: string, name: string, entry: Entry): Promise<void> {
    try {
      const blob = await (await fetch(url)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const isHdr = /\.hdr$/i.test(name) || (bytes[0] === 0x23 && bytes[1] === 0x3f);
      if (/\.exr$/i.test(name)) throw new Error('OpenEXR environment maps are not supported yet; use .hdr or an image');
      const image = downsample(isHdr ? parseRadianceHdr(bytes) : await decodeImage(blob));
      const { table, averageLuminance } = buildEnvironmentAlias(image);
      const upload = (data: Float32Array, label: string) => {
        const texture = device.createTexture({ label, size: [image.width, image.height], format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture }, data as Float32Array<ArrayBuffer>, { bytesPerRow: image.width * 16 }, [image.width, image.height]);
        return texture;
      };
      if (this.device !== device) return;
      entry.texture = upload(image.rgba, `pt-environment-${name}`);
      entry.alias = upload(table, `pt-environment-alias-${name}`);
      entry.averageLuminance = averageLuminance;
      entry.status = 'ready';
      this.requestRender();
    } catch (error) {
      entry.status = 'failed';
      ptLog.warn('Environment map could not be loaded; the light keeps its color', { name, error: String(error) });
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) { entry.texture?.destroy(); entry.alias?.destroy(); }
    this.entries.clear();
    this.fallback?.texture.destroy(); this.fallback?.alias.destroy();
    this.fallback = null;
    this.device = null;
  }
}
