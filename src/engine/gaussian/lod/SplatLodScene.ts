import { Logger } from '../../../services/logger';
import type { SplatGraphBranch } from '../../../types/splatGraph';
import { invertMat4 } from '../../native3d/pathtrace/runtime/ptFrameUniforms';
import { createIdentityIndexBuffer, createSplatDataBindGroup } from '../core/splatRenderer/sceneUpload';
import type { SplatSceneGpuResources } from '../core/splatRenderer/sceneResources';
import { lodShWords, readLodChunk, type LodPackage } from './lodPackage';
import { displaceLodPoint, localCamera, lodLeafDistance, selectLodLevels } from './lodSelection';

const log = Logger.create('SplatLod');

/** Pool page size in splats; chunks occupy whole pages, which need not be contiguous. */
export const LOD_PAGE = 4096;
/** Default splat budget, as in SuperSplat's streamed LOD viewer. */
export const DEFAULT_LOD_BUDGET = 4_000_000;
const MAX_PARALLEL_LOADS = 3;

interface Resident { pages: number[]; count: number; ready: boolean; lastUsed: number }

/**
 * A streamed LOD scene: a fixed GPU pool of pages holding the leaf chunks of the levels in use, plus
 * the list of pool slots currently drawn. The coarsest level of every leaf is loaded first and stays
 * resident, so a leaf always has something to show; finer levels stream in near the camera, replace the
 * coarser one only once they are uploaded, and are evicted (least recently used) when the pool runs
 * full. Drawing goes through the graph compute with `indices` as its source list.
 */
export class SplatLodScene {
  readonly scene: SplatSceneGpuResources;
  private readonly indexBuffer: GPUBuffer;
  private readonly capacityPages: number;
  private readonly freePages: number[] = [];
  private readonly resident = new Map<number, Resident>();
  private readonly shown: Int8Array;
  private readonly centers: [number, number, number][];
  private readonly radii: number[];
  private loading = 0;
  private queue: { leaf: number; level: number }[] = [];
  private frame = 0;
  private lastFrameKey = '';
  private drawCount = 0;
  private list?: Uint32Array;
  private listDirty = true;
  private warned = new Set<string>();
  private disposed = false;

  private readonly device: GPUDevice;
  private readonly key: string;
  private readonly pkg: LodPackage;
  private readonly budget: number;
  private readonly onChunk: () => void;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, key: string, pkg: LodPackage, budget: number, onChunk: () => void) {
    this.device = device; this.key = key; this.pkg = pkg; this.budget = budget; this.onChunk = onChunk;
    const coarsest = pkg.counts[pkg.levels - 1] ?? 0;
    const maxSplats = Math.floor(device.limits.maxStorageBufferBindingSize / 56);
    const wanted = Math.ceil((budget * 1.25 + coarsest) / LOD_PAGE) + pkg.leaves.length;
    this.capacityPages = Math.min(wanted, Math.floor(maxSplats / LOD_PAGE));
    if (this.capacityPages < wanted) this.warn('pool', `LOD pool clamped to ${this.capacityPages * LOD_PAGE} splats by the GPU storage limit.`);
    const capacity = this.capacityPages * LOD_PAGE;
    for (let page = this.capacityPages - 1; page >= 0; page -= 1) this.freePages.push(page);
    const splatBuffer = device.createBuffer({ label: `splat-lod-data-${key}`, size: capacity * 56, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const words = lodShWords(pkg);
    const shBuffer = words > 0 ? device.createBuffer({ label: `splat-lod-sh-${key}`, size: capacity * words * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }) : null;
    const identityIndexBuffer = createIdentityIndexBuffer(device, capacity, key);
    this.indexBuffer = device.createBuffer({ label: `splat-lod-active-${key}`, size: capacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.scene = { splatBuffer, splatCount: capacity, shBuffer, shCoeffsPerChannel: shBuffer ? pkg.shCoeffsPerChannel : 0, identityIndexBuffer,
      bindGroup: createSplatDataBindGroup(device, layout, splatBuffer, identityIndexBuffer, `splat-lod-bind-group-${key}`),
      framesSinceSort: 0, workerSorter: null, workerSortedBindGroup: null, activeWorkerSortedBindGroup: null };
    this.shown = new Int8Array(pkg.leaves.length).fill(-1);
    this.centers = pkg.leaves.map(leaf => [0, 1, 2].map(a => (leaf.min[a] + leaf.max[a]) / 2) as [number, number, number]);
    this.radii = pkg.leaves.map(leaf => Math.hypot(leaf.max[0] - leaf.min[0], leaf.max[1] - leaf.min[1], leaf.max[2] - leaf.min[2]) / 2);
  }

  /** Load the coarsest level of every leaf; resolves once the whole scene is drawable. */
  async loadBase(): Promise<void> {
    const level = this.pkg.levels - 1;
    await Promise.all(this.pkg.leaves.map(async (_, leaf) => {
      await this.load(leaf, level);
      if (this.resident.get(this.chunkKey(leaf, level))?.ready) this.shown[leaf] = level;
    }));
    this.listDirty = true;
  }

  /** Choose levels for this camera, start missing loads and return the slots to draw this frame. */
  prepare(viewMatrix: Float32Array, worldMatrix: Float32Array, branch: SplatGraphBranch | undefined, time: number, budgetOverride: number) {
    const operations = branch?.operations ?? [];
    const budget = budgetOverride > 0 ? budgetOverride : this.budget;
    const frameKey = JSON.stringify([Array.from(viewMatrix), Array.from(worldMatrix), operations, time, budget]);
    if (frameKey !== this.lastFrameKey) {
      this.lastFrameKey = frameKey; this.frame += 1;
      const camera = localCamera(viewMatrix, invertMat4(worldMatrix));
      const views = this.pkg.leaves.map((leaf, i) => ({
        distance: lodLeafDistance(displaceLodPoint(this.centers[i], operations, time), this.radii[i], camera),
        counts: leaf.lods.map(range => range?.count ?? 0),
      }));
      const choice = selectLodLevels(views, this.pkg.levels, budget);
      if (choice.overBudget) this.warn('budget', `Splat LOD budget ${budget} is below the coarsest level (${choice.splats} splats); drawing the coarsest level.`);
      const order = views.map((view, leaf) => ({ leaf, distance: view.distance })).toSorted((a, b) => a.distance - b.distance);
      this.queue = [];
      for (const { leaf } of order) this.want(leaf, this.availableLevel(leaf, choice.levels[leaf]));
      this.pump();
    }
    if (this.listDirty) this.writeList();
    return { indices: this.indexBuffer, count: this.drawCount };
  }

  /** True while chunks for the last selected view are still streaming in. */
  get pending(): boolean { return this.loading > 0 || this.queue.length > 0; }

  /** Resolves once every chunk requested by the last selection is resident (or failed). */
  async whenIdle(timeoutMs = 30000): Promise<boolean> {
    const until = performance.now() + timeoutMs;
    while (this.pending && !this.disposed) {
      if (performance.now() > until) return false;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return true;
  }

  /** Stop streaming and free the draw list; the pool buffers are released with `scene`. */
  dispose(): void { this.disposed = true; this.indexBuffer.destroy(); }

  private chunkKey(leaf: number, level: number) { return leaf * 32 + level; }

  /** The wanted level, or the next coarser level that exists for this leaf. */
  private availableLevel(leaf: number, level: number) {
    for (let l = level; l < this.pkg.levels; l += 1) if (this.pkg.leaves[leaf].lods[l]) return l;
    return this.pkg.levels - 1;
  }

  private want(leaf: number, level: number) {
    const entry = this.resident.get(this.chunkKey(leaf, level));
    if (entry?.ready) {
      entry.lastUsed = this.frame;
      if (this.shown[leaf] !== level) { this.shown[leaf] = level; this.listDirty = true; }
      const shown = this.resident.get(this.chunkKey(leaf, this.shown[leaf])); if (shown) shown.lastUsed = this.frame;
      return;
    }
    const range = this.pkg.leaves[leaf].lods[level];
    if (level > this.shown[leaf] && range && this.freePages.length < Math.ceil(range.count / LOD_PAGE)) {
      // Pool pressure: a leaf moving away drops to the nearest coarser level already resident, so its finer
      // chunk can be evicted to make room (otherwise shown finer chunks could block every load).
      for (let l = level + 1; l < this.pkg.levels; l += 1) {
        if (!this.resident.get(this.chunkKey(leaf, l))?.ready) continue;
        this.shown[leaf] = l; this.listDirty = true; this.resident.get(this.chunkKey(leaf, l))!.lastUsed = this.frame;
        break;
      }
    } else {
      const shown = this.resident.get(this.chunkKey(leaf, this.shown[leaf])); if (shown) shown.lastUsed = this.frame;
    }
    if (!entry) this.queue.push({ leaf, level });
  }

  /** Start queued loads, nearest leaves first, keeping a few reads in flight. */
  private pump() {
    while (this.loading < MAX_PARALLEL_LOADS && this.queue.length && !this.disposed) {
      const { leaf, level } = this.queue.shift()!;
      if (this.resident.has(this.chunkKey(leaf, level))) continue;
      const started = this.load(leaf, level);
      if (!this.resident.has(this.chunkKey(leaf, level))) { this.queue = []; break; } // pool full: retry on the next selection
      void started.then(() => { this.onChunk(); this.pump(); });
    }
  }

  private async load(leaf: number, level: number): Promise<void> {
    const range = this.pkg.leaves[leaf].lods[level]; const key = this.chunkKey(leaf, level);
    if (!range || this.resident.has(key)) return;
    const pages = this.allocate(Math.ceil(range.count / LOD_PAGE));
    if (!pages) { this.warn('full', 'Splat LOD pool is full; finer levels wait until coarser chunks can be evicted.'); return; }
    const entry: Resident = { pages, count: range.count, ready: false, lastUsed: this.frame };
    this.resident.set(key, entry); this.loading += 1;
    try {
      const chunk = await readLodChunk(this.pkg, level, range);
      if (this.disposed) return;
      const words = lodShWords(this.pkg);
      pages.forEach((page, i) => {
        const from = i * LOD_PAGE; const n = Math.min(LOD_PAGE, range.count - from);
        this.device.queue.writeBuffer(this.scene.splatBuffer, page * LOD_PAGE * 56, chunk.data.buffer, from * 56, n * 56);
        if (chunk.sh && this.scene.shBuffer) this.device.queue.writeBuffer(this.scene.shBuffer, page * LOD_PAGE * words * 4, chunk.sh.buffer, from * words * 4, n * words * 4);
      });
      entry.ready = true; this.lastFrameKey = ''; // re-select on the next draw, also while paused
    } catch (error) {
      this.resident.delete(key); this.freePages.push(...pages);
      this.warn(`read-${key}`, `Failed to stream splat LOD chunk (leaf ${leaf}, level ${level}): ${error instanceof Error ? error.message : String(error)}`);
    } finally { this.loading -= 1; }
  }

  /** Free pages, evicting least recently used chunks that are neither shown nor the pinned base level. */
  private allocate(count: number): number[] | null {
    if (this.freePages.length < count) {
      const evictable = [...this.resident.entries()]
        .filter(([key, entry]) => entry.ready && key % 32 !== this.pkg.levels - 1 && this.shown[Math.floor(key / 32)] !== key % 32 && entry.lastUsed < this.frame)
        .toSorted((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [key, entry] of evictable) {
        if (this.freePages.length >= count) break;
        this.resident.delete(key); this.freePages.push(...entry.pages);
      }
    }
    return this.freePages.length >= count ? this.freePages.splice(this.freePages.length - count, count) : null;
  }

  private writeList() {
    const list = this.list ??= new Uint32Array(this.capacityPages * LOD_PAGE);
    let count = 0;
    this.shown.forEach((level, leaf) => {
      const entry = level >= 0 ? this.resident.get(this.chunkKey(leaf, level)) : undefined;
      if (!entry?.ready) return;
      entry.pages.forEach((page, i) => {
        const n = Math.min(LOD_PAGE, entry.count - i * LOD_PAGE);
        for (let j = 0; j < n; j += 1) list[count++] = page * LOD_PAGE + j;
      });
    });
    if (count) this.device.queue.writeBuffer(this.indexBuffer, 0, list.buffer, 0, count * 4);
    this.drawCount = count; this.listDirty = false;
    const perLevel = Array.from({ length: this.pkg.levels }, (_, level) => this.shown.reduce((n, l) => n + (l === level ? 1 : 0), 0));
    log.debug('LOD draw list', { scene: this.key, splats: count, leavesPerLevel: perLevel, resident: this.resident.size, freePages: this.freePages.length });
  }

  private warn(id: string, message: string) {
    if (this.warned.has(id)) return; this.warned.add(id); log.warn(message, { scene: this.key });
  }
}
