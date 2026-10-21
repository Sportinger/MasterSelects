import { describe, expect, it, vi } from 'vitest';

// Renaming (also inside Save As and Save permanently > Keep in this browser) writes
// only the project root. It must not re-encode media aggregates that carry
// repository-internal proofs such as $sourceIdentity.

const state = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => state.session,
  openEditorRepository: vi.fn(),
  repositoryWorkspaceId: 'workspace',
  flushEditorRepository: vi.fn(async () => true),
}));

import { renameRepositoryProject } from '../../src/services/project/repository/lifecycle/repositoryProjectOperations';
import { PROJECT_ENTITY_KEY } from '../../src/services/project/repository/domains/projectDomains';

function fakeSession() {
  const root = { type: 'project-root', schemaVersion: 1, references: [], blobs: [], value: { name: 'Untitled Project', createdAt: '2026-10-21', media: { $repositoryEntity: 'membership:project:media' } } };
  const media = { type: 'media-aggregate', schemaVersion: 1, references: [], blobs: [], value: { id: 'm1', name: 'clip.png', $sourceIdentity: { hash: 'abc' } } };
  const entities = new Map<string, unknown>([[PROJECT_ENTITY_KEY, root], ['media:project:m1', media]]);
  const writes: Array<[string, unknown]> = [];
  return {
    writes,
    coordinator: {
      getProjection: () => ({ entities }),
      begin: vi.fn(() => 'token'),
      write: vi.fn((_token: string, key: string, entity: unknown) => { writes.push([key, entity]); }),
      commit: vi.fn(() => ({ receipt: 'receipt' })),
      flush: vi.fn(async () => undefined),
      cancel: vi.fn(),
    },
  };
}

describe('renameRepositoryProject', () => {
  it('renames only the project root, even when media carry source identity proofs', async () => {
    const session = fakeSession(); state.session = session;
    expect(await renameRepositoryProject('  My Film  ')).toBe(true);
    expect(session.writes).toHaveLength(1);
    const [key, entity] = session.writes[0] as [string, { value: Record<string, unknown> }];
    expect(key).toBe(PROJECT_ENTITY_KEY);
    expect(entity.value).toEqual({ name: 'My Film', createdAt: '2026-10-21', media: { $repositoryEntity: 'membership:project:media' } });
    expect(session.coordinator.flush).toHaveBeenCalledWith('receipt');
  });

  it('refuses an empty name or a missing project', async () => {
    state.session = fakeSession();
    expect(await renameRepositoryProject('   ')).toBe(false);
    state.session = null;
    expect(await renameRepositoryProject('Name')).toBe(false);
  });
});
