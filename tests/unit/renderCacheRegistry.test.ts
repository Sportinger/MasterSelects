import { describe, expect, it } from 'vitest';

import {
  RenderCacheRegistry,
  type RenderCacheEntry,
} from '../../src/services/renderJobs/renderCacheRegistry';

function entry(overrides: Partial<RenderCacheEntry>): RenderCacheEntry {
  return {
    id: 'entry',
    owner: 'source-frame',
    key: 'source:1',
    resourceKind: 'runtime-frame',
    durable: false,
    bytes: 1024,
    invalidationSource: 'project',
    createdAt: 1,
    lastUsedAt: 1,
    ...overrides,
  };
}

describe('RenderCacheRegistry', () => {
  it('tracks allocation, reuse, transfer, and release counters', () => {
    const registry = new RenderCacheRegistry();

    registry.allocate(entry({ id: 'a', bytes: 100 }));
    registry.allocate(entry({ id: 'a', bytes: 120, lastUsedAt: 2 }));
    registry.touch('a', 3);
    expect(registry.transfer('a')).toBe(true);
    expect(registry.release('a')).toBe(true);

    const snapshot = registry.snapshot();
    expect(snapshot.entries).toBe(0);
    expect(snapshot.counters.allocations).toBe(1);
    expect(snapshot.counters.reuses).toBe(2);
    expect(snapshot.counters.transfers).toBe(1);
    expect(snapshot.counters.releases).toBe(1);
  });

  it('reports bytes by cache owner and evicts by owner', () => {
    const registry = new RenderCacheRegistry();
    registry.allocate(entry({ id: 'source', owner: 'source-frame', bytes: 100 }));
    registry.allocate(entry({ id: 'mask', owner: 'mask-texture', bytes: 50 }));

    expect(registry.snapshot().bytesByOwner['source-frame']).toBe(100);
    expect(registry.snapshot().bytesByOwner['mask-texture']).toBe(50);
    expect(registry.evictByOwner('source-frame')).toBe(1);

    const snapshot = registry.snapshot();
    expect(snapshot.entries).toBe(1);
    expect(snapshot.bytes).toBe(50);
    expect(snapshot.counters.evictions).toBe(1);
  });

  it('releases entries by invalidation source and detects runtime leaks', () => {
    const registry = new RenderCacheRegistry();
    registry.allocate(entry({ id: 'runtime-a', invalidationSource: 'comp-a' }));
    registry.allocate(entry({ id: 'runtime-b', invalidationSource: 'comp-b' }));
    registry.allocate(entry({
      id: 'durable',
      owner: 'bake-artifact',
      resourceKind: 'durable-artifact',
      durable: true,
      invalidationSource: 'comp-old',
    }));

    expect(registry.releaseByInvalidationSource('comp-a')).toBe(1);
    const leaks = registry.checkForLeaks(new Set(['comp-b']));

    expect(leaks.map((item) => item.id)).toEqual([]);
    expect(registry.snapshot().counters.leakChecks).toBe(1);
  });
});
