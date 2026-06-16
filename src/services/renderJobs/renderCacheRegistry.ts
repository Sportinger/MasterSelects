export type RenderCacheOwner =
  | 'source-frame'
  | 'hold-frame'
  | 'composite-frame'
  | 'subcomp-output'
  | 'mask-texture'
  | 'effect-plan'
  | 'target-surface'
  | 'bake-artifact'
  | 'thumbnail'
  | 'export-frame';

export type RenderCacheResourceKind =
  | 'runtime-texture'
  | 'runtime-frame'
  | 'runtime-descriptor'
  | 'durable-artifact'
  | 'software-pixels';

export interface RenderCacheEntry {
  readonly id: string;
  readonly owner: RenderCacheOwner;
  readonly key: string;
  readonly resourceKind: RenderCacheResourceKind;
  readonly durable: boolean;
  readonly bytes: number;
  readonly invalidationSource: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

export interface RenderCacheCounters {
  allocations: number;
  reuses: number;
  evictions: number;
  transfers: number;
  releases: number;
  leakChecks: number;
}

export interface RenderCacheRegistrySnapshot {
  readonly entries: number;
  readonly bytes: number;
  readonly bytesByOwner: Readonly<Record<RenderCacheOwner, number>>;
  readonly counters: Readonly<RenderCacheCounters>;
}

function createCounters(): RenderCacheCounters {
  return {
    allocations: 0,
    reuses: 0,
    evictions: 0,
    transfers: 0,
    releases: 0,
    leakChecks: 0,
  };
}

function emptyOwnerBytes(): Record<RenderCacheOwner, number> {
  return {
    'source-frame': 0,
    'hold-frame': 0,
    'composite-frame': 0,
    'subcomp-output': 0,
    'mask-texture': 0,
    'effect-plan': 0,
    'target-surface': 0,
    'bake-artifact': 0,
    thumbnail: 0,
    'export-frame': 0,
  };
}

export class RenderCacheRegistry {
  private readonly entries = new Map<string, RenderCacheEntry>();
  private readonly counters = createCounters();

  allocate(entry: RenderCacheEntry): RenderCacheEntry {
    if (this.entries.has(entry.id)) {
      this.counters.reuses += 1;
    } else {
      this.counters.allocations += 1;
    }
    this.entries.set(entry.id, entry);
    return entry;
  }

  touch(id: string, lastUsedAt: number): RenderCacheEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const touched = { ...entry, lastUsedAt };
    this.entries.set(id, touched);
    this.counters.reuses += 1;
    return touched;
  }

  transfer(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.counters.transfers += 1;
    return true;
  }

  release(id: string): boolean {
    const released = this.entries.delete(id);
    if (released) this.counters.releases += 1;
    return released;
  }

  evictByOwner(owner: RenderCacheOwner): number {
    let evicted = 0;
    for (const entry of this.entries.values()) {
      if (entry.owner !== owner) continue;
      this.entries.delete(entry.id);
      evicted += 1;
    }
    this.counters.evictions += evicted;
    return evicted;
  }

  releaseByInvalidationSource(invalidationSource: string): number {
    let released = 0;
    for (const entry of this.entries.values()) {
      if (entry.invalidationSource !== invalidationSource) continue;
      this.entries.delete(entry.id);
      released += 1;
    }
    this.counters.releases += released;
    return released;
  }

  checkForLeaks(activeInvalidationSources: ReadonlySet<string>): RenderCacheEntry[] {
    this.counters.leakChecks += 1;
    return Array.from(this.entries.values()).filter((entry) => (
      !entry.durable && !activeInvalidationSources.has(entry.invalidationSource)
    ));
  }

  snapshot(): RenderCacheRegistrySnapshot {
    const bytesByOwner = emptyOwnerBytes();
    let bytes = 0;
    for (const entry of this.entries.values()) {
      bytes += entry.bytes;
      bytesByOwner[entry.owner] += entry.bytes;
    }
    return {
      entries: this.entries.size,
      bytes,
      bytesByOwner,
      counters: { ...this.counters },
    };
  }
}
