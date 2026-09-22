import type { SplatGraphOperation } from '../../../types/splatGraph';

/** Crops before motion can be evaluated once against immutable source centers. */
export function sourceSphereCrops(operations: SplatGraphOperation[]): number[][] {
  const crops: number[][] = [];
  for (const op of operations) {
    if (op.kind === 'particles' || (op.kind === 'noise' && op.values[0] === 0)) break;
    if (op.kind === 'sphere-crop') crops.push(op.values);
  }
  return crops;
}

/** Preserve original IDs (and therefore noise/particle seeds) and budget sampling. */
export function compactCropIndices(source: Float32Array, sourceCount: number, sampling: { count: number; offset: number; remapped: boolean }, crops: number[][]): Uint32Array {
  const ids = new Uint32Array(sampling.count);
  let kept = 0;
  for (let i = 0; i < sampling.count; i++) {
    // Match the f32 arithmetic used by the attribute shader for source selection.
    const id = sampling.remapped
      ? (Math.floor(Math.fround(Math.fround(i * sourceCount) / sampling.count)) + sampling.offset) % sourceCount : i;
    const b = id * 14;
    if (!crops.every(c => {
      const dx = source[b] - c[0], dy = source[b + 1] - c[1], dz = source[b + 2] - c[2];
      const distance2 = dx * dx + dy * dy + dz * dz;
      return c[4] > 0 && c[3] > 0 ? distance2 < c[3] * c[3] : distance2 <= c[3] * c[3];
    })) continue;
    ids[kept++] = id;
  }
  return ids.slice(0, kept);
}

interface Entry { key: string; buffer: GPUBuffer; count: number; indices: Uint32Array }
/** Runtime-only, bounded cache. Crop edits rescan; steady playback reuses GPU IDs. */
export class SplatCropCache {
  private entries = new Map<string, { source: Float32Array; items: Entry[] }>();
  private retired: GPUBuffer[] = [];
  prepare(device: GPUDevice, id: string, source: Float32Array, sourceCount: number,
    sampling: { count: number; offset: number; remapped: boolean }, operations: SplatGraphOperation[]): Entry | undefined {
    const crops = sourceSphereCrops(operations);
    if (!crops.length) return undefined;
    let cache = this.entries.get(id);
    if (!cache || cache.source !== source) {
      this.release(id); cache = { source, items: [] }; this.entries.set(id, cache);
    }
    const key = JSON.stringify([sourceCount, sampling.count, sampling.offset, sampling.remapped, crops]);
    const existing = cache.items.find(item => item.key === key);
    if (existing) return existing;
    const indices = compactCropIndices(source, sourceCount, sampling, crops);
    const buffer = device.createBuffer({ label: 'Cropped splat source indices', size: Math.max(4, indices.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (indices.length) device.queue.writeBuffer(buffer, 0, indices.buffer as ArrayBuffer);
    const entry = { key, buffer, count: indices.length, indices };
    if (cache.items.length >= 6) this.retired.push(cache.items.shift()!.buffer);
    cache.items.push(entry);
    return entry;
  }
  beginFrame() { for (const buffer of this.retired) buffer.destroy(); this.retired = []; }
  release(id: string) { for (const item of this.entries.get(id)?.items ?? []) this.retired.push(item.buffer); this.entries.delete(id); }
  dispose() { for (const id of this.entries.keys()) this.release(id); this.beginFrame(); }
}
