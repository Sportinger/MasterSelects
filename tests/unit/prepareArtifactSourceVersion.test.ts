import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import { prepareArtifactSourceVersion } from '../../src/services/project/repository/artifacts/prepareArtifactSourceVersion';
import { queueSourceIdentity } from '../../src/services/project/repository/artifacts/queueSourceIdentity';

vi.mock('../../src/services/project/repository/artifacts/queueSourceIdentity', () => ({ queueSourceIdentity: vi.fn() }));
const session = {} as RepositorySession;
const hash = `sha256:${'a'.repeat(64)}`;
const identity = { identityStatus: 'verified' as const, algorithm: 'sha256' as const, contentHash: hash, byteLength: 4 };
beforeEach(() => { vi.mocked(queueSourceIdentity).mockReset(); });

describe('preparing a source-bound save', () => {
  it('uses an existing identity without rereading a large original', async () => {
    const readFile = vi.fn();
    expect(await prepareArtifactSourceVersion(session, 'media', {
      isActive: () => true, readVersion: () => hash, readFile,
    })).toBe(hash);
    expect(readFile).not.toHaveBeenCalled();
    expect(queueSourceIdentity).not.toHaveBeenCalled();
  });

  it.each(['source', 'session'] as const)('rejects a %s change while the original is being verified', async change => {
    let file = new Blob(['same']), active = true, version: string | null = null;
    vi.mocked(queueSourceIdentity).mockImplementation(async (_session, _id, _file, isCurrent) => {
      if (change === 'source') file = new Blob(['next']); else active = false;
      expect(isCurrent()).toBe(false);
      version = hash;
      return identity;
    });
    expect(await prepareArtifactSourceVersion(session, 'media', {
      isActive: () => active, readVersion: () => version, readFile: () => file,
    })).toBeNull();
  });

  it('returns only the identity actually published for the captured original', async () => {
    let version: string | null = null;
    const file = new Blob(['same']);
    vi.mocked(queueSourceIdentity).mockImplementation(async () => { version = hash; return identity; });
    expect(await prepareArtifactSourceVersion(session, 'media', {
      isActive: () => true, readVersion: () => version, readFile: () => file,
    })).toBe(hash);
  });

  it('does not invent an identity for missing media', async () => {
    expect(await prepareArtifactSourceVersion(session, 'media', {
      isActive: () => true, readVersion: () => null, readFile: () => undefined,
    })).toBeNull();
    expect(queueSourceIdentity).not.toHaveBeenCalled();
  });
});
