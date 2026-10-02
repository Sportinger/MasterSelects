import { afterEach, describe, expect, it, vi } from 'vitest';
const data = vi.hoisted(() => ({ media: { files: [], compositions: [], activeCompositionId: 'main' }, timeline: { playheadPosition: 0 } }));
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
vi.mock('../../src/services/project/repository/artifacts/queueSourceIdentity', () => ({ queueSourceIdentity: vi.fn() }));
vi.mock('../../src/stores/timeline/exclusiveMutationLease', () => ({ assertExclusiveTimelineMutationAllowed: vi.fn() }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({ playheadState: { isUsingInternalPosition: false, position: 0 } }));
import { installEditorRepositorySession, queueEditorRepositoryView, flushEditorRepositoryViews } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

let cleanup: (() => void) | undefined;
function fixture(workspace: Record<string, unknown> = {}) {
  const updateView = vi.fn(async () => 1);
  const session = { opening: { writable: true }, updateView, coordinator: {
    getEntities: () => new Map(), getStatus: () => ({ generation: 1, revisionId: 'head' }), subscribe: () => () => {},
  } } as unknown as RepositorySession;
  cleanup = installEditorRepositorySession(session, { workspace: workspace as never }); return updateView;
}
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); data.timeline.playheadPosition = 0; });
describe('editor replaceable workspace publication', () => {
  it('does not save a stationary default playhead each second after reopening', async () => {
    vi.useFakeTimers(); const update = fixture();
    await vi.advanceTimersByTimeAsync(5000); await flushEditorRepositoryViews(); expect(update).not.toHaveBeenCalled();
    data.timeline.playheadPosition = 2;
    await vi.advanceTimersByTimeAsync(1000); await flushEditorRepositoryViews();
    expect(update).toHaveBeenCalledExactlyOnceWith('timeline/main/playheadPosition', 2);
    await vi.advanceTimersByTimeAsync(3000); await flushEditorRepositoryViews(); expect(update).toHaveBeenCalledTimes(1);
  });
  it('compares structured view values independently of object key order and coalesces repeated updates', async () => {
    const update = fixture({ 'dock/layout': { a: 1, b: 2 } });
    queueEditorRepositoryView('dock/layout', { b: 2, a: 1 });
    await flushEditorRepositoryViews(); expect(update).not.toHaveBeenCalled();
    queueEditorRepositoryView('dock/layout', { a: 2, b: 2 }); queueEditorRepositoryView('dock/layout', { b: 2, a: 2 });
    await flushEditorRepositoryViews(); expect(update).toHaveBeenCalledTimes(1);
  });
});
