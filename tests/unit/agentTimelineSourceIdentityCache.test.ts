import { describe, expect, it, vi } from 'vitest';
import { SOURCE_IDENTITY_SCHEMA_VERSION } from '../../src/types/agentTimeline/sourceIdentity';
import { SourceIdentityRuntimeCache } from '../../src/services/agentTimeline/runtime/sourceIdentityCache';

function identity(hash: string, strategy: 'sampled-chunks' | 'full-stream') {
  return {
    type: 'source-identity' as const,
    version: SOURCE_IDENTITY_SCHEMA_VERSION,
    strategy,
    hashAlgorithm: 'sha-256' as const,
    hash,
    metadata: { size: 1, mediaType: 'video/mp4' },
  };
}

describe('SourceIdentityRuntimeCache', () => {
  it('coalesces concurrent reads for the same Blob and strategy', async () => {
    const factory = vi.fn(async (_source: Blob, options = {}) => (
      identity('sampled', options.strategy ?? 'sampled-chunks')
    ));
    const cache = new SourceIdentityRuntimeCache(factory);
    const source = new Blob(['a'], { type: 'video/mp4' });
    const first = cache.get(source);
    const second = cache.get(source);
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ hash: 'sampled' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('keeps sampled and full identities separate', async () => {
    const factory = vi.fn(async (_source: Blob, options = {}) => (
      identity(options.strategy ?? 'sampled-chunks', options.strategy ?? 'sampled-chunks')
    ));
    const cache = new SourceIdentityRuntimeCache(factory);
    const source = new Blob(['a']);
    const sampled = await cache.get(source);
    const full = await cache.get(source, { strategy: 'full-stream' });
    expect(sampled.strategy).toBe('sampled-chunks');
    expect(full.strategy).toBe('full-stream');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('evicts rejected work so a later request can retry', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(identity('retry', 'sampled-chunks'));
    const cache = new SourceIdentityRuntimeCache(factory);
    const source = new Blob(['a']);
    await expect(cache.get(source)).rejects.toThrow('read failed');
    await expect(cache.get(source)).resolves.toMatchObject({ hash: 'retry' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('invalidates one strategy or the whole Blob explicitly', async () => {
    let counter = 0;
    const factory = vi.fn(async (_source: Blob, options = {}) => {
      counter += 1;
      return identity(String(counter), options.strategy ?? 'sampled-chunks');
    });
    const cache = new SourceIdentityRuntimeCache(factory);
    const source = new Blob(['a']);
    await cache.get(source);
    await cache.get(source, { strategy: 'full-stream' });
    cache.invalidate(source, 'sampled-chunks');
    await expect(cache.get(source)).resolves.toMatchObject({ hash: '3' });
    expect(factory).toHaveBeenCalledTimes(3);
    cache.invalidate(source);
    await expect(cache.get(source, { strategy: 'full-stream' })).resolves.toMatchObject({ hash: '4' });
  });
});
