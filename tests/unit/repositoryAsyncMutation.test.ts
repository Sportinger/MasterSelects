import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionToken } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { MediaFile } from '../../src/stores/mediaStore/types';
const mock = vi.hoisted(() => {
  const state = { session: null as { id: string } | null, token: null as TransactionToken | null,
    listeners: new Set<() => void>(), owned: new Set<symbol>() };
  const calls = { begin: vi.fn(), commit: vi.fn(), cancel: vi.fn(), run: vi.fn() };
  return { state, calls };
});
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => mock.state.session,
  getEditorTransactionToken: () => mock.state.token,
  subscribeEditorRepositorySession: (listener: () => void) => { mock.state.listeners.add(listener); return () => mock.state.listeners.delete(listener); },
  ownsEditorTransaction: (token: TransactionToken) => mock.state.owned.has(token.owner) && token.sessionEpoch === mock.state.session?.id,
  beginEditorTransaction: (label: string) => {
    mock.calls.begin(label); const token = { transactionId: 'local', owner: Symbol(label), sessionEpoch: mock.state.session!.id };
    mock.state.owned.add(token.owner); return token;
  },
  runEditorTransaction: <T>(token: TransactionToken, action: () => T): T => { mock.calls.run(token); return action(); },
  commitEditorTransaction: (token: TransactionToken) => { mock.calls.commit(token); mock.state.owned.delete(token.owner); },
  cancelEditorTransaction: (token: TransactionToken) => { mock.calls.cancel(token); mock.state.owned.delete(token.owner); },
}));
import { captureEditorAsyncMutation, bindEditorAsyncStore, discardUnpublishedMedia } from '../../src/services/project/repository/transaction/editorAsyncMutation';
function install(session: { id: string } | null) { mock.state.session = session; for (const listener of mock.state.listeners) listener(); }
beforeEach(() => { install(null); mock.state.token = null; mock.state.owned.clear(); for (const call of Object.values(mock.calls)) call.mockClear(); });
afterEach(() => vi.unstubAllGlobals());
describe('session-pinned asynchronous editor mutation', () => {
  it('does not promote a pre-open null binding into the subsequently installed project', () => {
    const binding = captureEditorAsyncMutation('Before project open'); install({ id: 'new-project' });
    const mutate = vi.fn(); expect(binding.isCurrent()).toBe(false);
    expect(() => binding.run(mutate)).toThrow(); expect(mutate).not.toHaveBeenCalled(); expect(mock.calls.begin).not.toHaveBeenCalled();
  });
  it('rejects an old continuation even when its original session object is reinstalled', () => {
    const original = { id: 'original' }; install(original); const binding = captureEditorAsyncMutation('Original import');
    install({ id: 'other' }); install(original);
    expect(binding.isCurrent()).toBe(false); expect(() => binding.invoke(vi.fn())).toThrow();
  });
  it('runs current synchronous phases in one owned transaction and cancels failures once', () => {
    install({ id: 'original' }); const binding = captureEditorAsyncMutation('Import phase');
    expect(binding.run(() => binding.run(() => 4))).toBe(4);
    expect(mock.calls.begin).toHaveBeenCalledTimes(1); expect(mock.calls.commit).toHaveBeenCalledTimes(1);
    expect(() => binding.run(() => { throw new Error('Apply failed'); })).toThrow('Apply failed');
    expect(mock.calls.cancel).toHaveBeenCalledTimes(1); expect(mock.calls.commit).toHaveBeenCalledTimes(1);
  });
  it('joins the captured owned token and refuses a continuation after it is committed', () => {
    install({ id: 'original' }); const token = { owner: Symbol('joined'), transactionId: 'joined', sessionEpoch: 'original' };
    mock.state.token = token; mock.state.owned.add(token.owner); const binding = captureEditorAsyncMutation('Joined phase');
    binding.run(() => 2); expect(mock.calls.begin).not.toHaveBeenCalled(); expect(mock.calls.run).toHaveBeenCalledWith(token);
    mock.state.owned.delete(token.owner); expect(binding.isCurrent()).toBe(false); expect(() => binding.run(() => 3)).toThrow();
  });
  it('cancels a locally owned phase if transaction finalization fails', () => {
    install({ id: 'original' }); mock.calls.commit.mockImplementationOnce(() => { throw new Error('Commit failed'); });
    const binding = captureEditorAsyncMutation('Import phase'); expect(() => binding.run(() => 4)).toThrow('Commit failed');
    expect(mock.calls.cancel).toHaveBeenCalledTimes(1); expect(mock.state.owned.size).toBe(0);
  });
  it('does not let stale bound store setters or action getters mutate the replacement project', () => {
    install({ id: 'original' }); const binding = captureEditorAsyncMutation('Late media import');
    const action = vi.fn(); const get = vi.fn(() => ({ content: 1, action })); const set = vi.fn();
    const bound = bindEditorAsyncStore(set, get, binding); install({ id: 'replacement' });
    bound.set({ content: 9 }); const last = bound.get(); expect(last.content).toBe(1);
    expect(() => last.action()).toThrow(); expect(set).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('rechecks the source/target predicate before every synchronous continuation', () => {
    install({ id: 'original' }); let sourceVersion = 1;
    const binding = captureEditorAsyncMutation('Source analysis', () => sourceVersion === 1);
    binding.run(() => 1); sourceVersion = 2; const mutate = vi.fn();
    expect(() => binding.invoke(mutate)).toThrow(); expect(mutate).not.toHaveBeenCalled();
  });
  it('releases only newly created object URLs from a rejected result', () => {
    const revokeObjectURL = vi.fn(); vi.stubGlobal('URL', { revokeObjectURL });
    const baseline = { id: 'media', url: 'blob:original', thumbnailUrl: 'blob:retained-thumbnail' } as MediaFile;
    const rejected = { ...baseline, proxyVideoUrl: 'blob:new-proxy', audioProxyUrl: 'blob:new-audio',
      modelSequence: { frames: [{ modelUrl: 'blob:new-frame' }] } } as MediaFile;
    discardUnpublishedMedia(rejected, baseline);
    expect(revokeObjectURL.mock.calls.map(call => call[0]).toSorted()).toEqual(['blob:new-proxy', 'blob:new-audio', 'blob:new-frame'].toSorted());
  });
});
