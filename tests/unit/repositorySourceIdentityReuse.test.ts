import { afterEach, describe, expect, it, vi } from 'vitest';
const data = vi.hoisted(() => ({ media: { files: [] as unknown[], compositions: [], activeCompositionId: null }, timeline: { playheadPosition: 0 } }));
const hashing = vi.hoisted(() => ({ queue: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', () => ({
  getRepositoryStore: (domain: string) => domain === 'media' ? { getState: () => data.media } : domain === 'timeline' ? { getState: () => data.timeline } : undefined,
  installStoreMutationBoundary: vi.fn(), withRepositoryHydration: (action: () => unknown) => action(),
}));
vi.mock('../../src/services/project/repository/transaction/domainAdapters/timelineAdapter', () => ({ prepareTimelineMutation: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/domainAdapters/mediaAdapter', () => ({ prepareMediaMutation: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/domainAdapters/otherDomainsAdapter', () => ({ prepareOtherDomainMutation: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/editorGestureOwnership', () => ({ getEditorGestureToken: () => null, installEditorGestureEvents: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/editorHistory', () => ({ refreshEditorHistoryAvailability: () => Promise.resolve() }));
vi.mock('../../src/services/project/repository/transaction/editorCompositionProjection', () => ({ projectTimelineMutationToComposition: vi.fn() }));
vi.mock('../../src/services/project/repository/artifacts/queueSourceIdentity', () => ({ queueSourceIdentity: hashing.queue }));
vi.mock('../../src/stores/timeline/exclusiveMutationLease', () => ({ assertExclusiveTimelineMutationAllowed: vi.fn() }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({ playheadState: { isUsingInternalPosition: false, position: 0 } }));
import { installEditorRepositorySession } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; hashing.queue.mockClear(); });

describe('source identity reuse after reopening', () => {
  it('keeps stored full hashes of restored sources and hashes only new or resized ones', () => {
    const blob = (size: number) => new Blob([new Uint8Array(size)]);
    data.media.files = [{ id: 'kept', file: blob(8) }, { id: 'resized', file: blob(9) }, { id: 'new', file: blob(4) }];
    const verified = (byteLength: number) => ({ value: { identityStatus: 'verified', algorithm: 'sha256', contentHash: 'sha256:' + '0'.repeat(64), byteLength } });
    const entities = new Map([['source-identity:kept', verified(8)], ['source-identity:resized', verified(8)]]);
    const session = { opening: { writable: true }, updateView: vi.fn(async () => 1), coordinator: {
      getEntities: () => entities, getStatus: () => ({ generation: 1, revisionId: 'head' }), subscribe: () => () => {},
    } } as unknown as RepositorySession;
    cleanup = installEditorRepositorySession(session);
    expect(hashing.queue.mock.calls.map(call => (call as unknown[])[1])).toEqual(['resized', 'new']);
  });
});
