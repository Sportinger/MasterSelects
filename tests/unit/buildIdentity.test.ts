import { describe, expect, it } from 'vitest';
import { buildIdentity } from '../../tools/buildIdentity';
import { sanitizeProductAnalyticsProperties } from '../../src/services/productAnalytics/catalog';

describe('build identity', () => {
  const revision = 'a'.repeat(40);
  const options = { version: '3.1.9', development: false, cwd: '.', env: {}, now: new Date('2026-10-02T00:00:00.000Z') };
  it('ties a clean production build to its exact version and commit', () => {
    const result = buildIdentity({ ...options, git: args => args[0] === 'rev-parse' ? revision : '' });
    expect(result).toEqual({ schema: 'masterselects-build/v1', version: '3.1.9', sourceRevision: revision,
      sourceDirty: false, buildId: '2026-10-02T00:00:00.000Z', releaseId: `masterselects-3.1.9-${revision}` });
  });
  it('never describes dirty, development or unverifiable sources as a release', () => {
    expect(buildIdentity({ ...options, git: args => args[0] === 'rev-parse' ? revision : ' M src/file.ts' }).releaseId).toBeNull();
    expect(buildIdentity({ ...options, development: true, git: args => args[0] === 'rev-parse' ? revision : '' }).releaseId).toBeNull();
    expect(buildIdentity({ ...options, env: { CF_PAGES_COMMIT_SHA: revision }, git: () => { throw new Error('no git'); } }))
      .toMatchObject({ sourceRevision: revision, sourceDirty: true, releaseId: null });
  });
  it('rejects mismatched provider revision', () => {
    expect(() => buildIdentity({ ...options, env: { CF_PAGES_COMMIT_SHA: 'b'.repeat(40) },
      git: args => args[0] === 'rev-parse' ? revision : '' })).toThrow(/does not match/);
  });
  it('preserves bounded release identifiers through the analytics allowlist', () => {
    const properties = { build_id: options.now.toISOString(), source_revision: revision,
      source_dirty: false, release_id: `masterselects-3.1.9-${revision}` };
    expect(sanitizeProductAnalyticsProperties('app_opened', properties)).toEqual(properties);
    expect(sanitizeProductAnalyticsProperties('app_opened', { source_revision: 'private/path', release_id: 'secret' })).toEqual({});
  });
});
