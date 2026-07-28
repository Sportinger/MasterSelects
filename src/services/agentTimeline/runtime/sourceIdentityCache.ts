import type {
  SourceIdentity,
  SourceIdentityStrategy,
} from '../../../types/agentTimeline/sourceIdentity';
import {
  createSourceIdentity,
  type SourceIdentityOptions,
} from '../sourceIdentityService';

export type SourceIdentityFactory = (
  source: Blob,
  options?: SourceIdentityOptions,
) => Promise<SourceIdentity>;

export class SourceIdentityRuntimeCache {
  private readonly entries = new WeakMap<Blob, Map<SourceIdentityStrategy, Promise<SourceIdentity>>>();
  private readonly factory: SourceIdentityFactory;

  constructor(factory: SourceIdentityFactory = createSourceIdentity) {
    this.factory = factory;
  }

  get(
    source: Blob,
    options: SourceIdentityOptions = {},
  ): Promise<SourceIdentity> {
    const strategy = options.strategy ?? 'sampled-chunks';
    const byStrategy = this.entries.get(source) ?? new Map();
    this.entries.set(source, byStrategy);
    const existing = byStrategy.get(strategy);
    if (existing) return existing;

    const pending = this.factory(source, { ...options, strategy });
    byStrategy.set(strategy, pending);
    void pending.catch(() => {
      if (byStrategy.get(strategy) === pending) byStrategy.delete(strategy);
    });
    return pending;
  }

  invalidate(source: Blob, strategy?: SourceIdentityStrategy): void {
    const byStrategy = this.entries.get(source);
    if (!byStrategy) return;
    if (strategy) {
      byStrategy.delete(strategy);
      if (byStrategy.size === 0) this.entries.delete(source);
      return;
    }
    this.entries.delete(source);
  }
}

type SourceIdentityCacheGlobal = typeof globalThis & {
  __MASTERSELECTS_SOURCE_IDENTITY_RUNTIME_CACHE__?: SourceIdentityRuntimeCache;
};

const cacheGlobal = globalThis as SourceIdentityCacheGlobal;
export const sourceIdentityRuntimeCache =
  cacheGlobal.__MASTERSELECTS_SOURCE_IDENTITY_RUNTIME_CACHE__
  ?? new SourceIdentityRuntimeCache();
cacheGlobal.__MASTERSELECTS_SOURCE_IDENTITY_RUNTIME_CACHE__ = sourceIdentityRuntimeCache;
