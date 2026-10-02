import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { installStoreMutationBoundary, withRepositoryHydration, withRepositoryStoreMutation, type StoreMutationBoundary } from '../../src/services/project/repository/transaction/storeMutationBoundary';
interface State { content: number; runtimeHandle: object | null; getContent(): number; edit(value: number): void; cleanup(): void; }
function fixture(options: { blocked?: boolean; preparationFails?: boolean; finalizationFails?: boolean } = {}) {
  let active: { owned: boolean } | null = null;
  const cancelled = vi.fn(), committed = vi.fn();
  const cancel = (scope: { owned: boolean } | null) => { if (scope?.owned) { scope.owned = false; cancelled(); } };
  const boundary: StoreMutationBoundary = {
    assertAllowed: vi.fn(() => { if (options.blocked) throw new Error('Activation barrier'); }),
    beginAction: vi.fn(() => { active = { owned: false }; return active; }),
    prepare: vi.fn((domain, _before, patch) => {
      const changes = patch as Partial<State>; const scope = active ?? { owned: false };
      if (changes.content !== undefined) { boundary.assertAllowed(domain); scope.owned = true; active = scope; }
      if (options.preparationFails) throw new Error('Preparation failed');
      return scope;
    }),
    finish: vi.fn(() => { if (options.finalizationFails) throw new Error('Finalization failed'); }),
    failed: vi.fn((_domain, scope) => cancel((scope as { owned: boolean } | undefined) ?? active)),
    endAction: vi.fn((scope, error) => { if (error) cancel(scope as { owned: boolean });
      else if ((scope as { owned: boolean })?.owned) { (scope as { owned: boolean }).owned = false; committed(); }
      active = null;
    }),
  };
  installStoreMutationBoundary(boundary);
  const store = createStore<State>()(withRepositoryStoreMutation('fixture', (set, get) => ({ content: 1, runtimeHandle: {},
    getContent: () => get().content, edit: value => set({ content: value }), cleanup: () => set({ runtimeHandle: null }),
  })));
  return { store, boundary, cancelled, committed };
}
afterEach(() => installStoreMutationBoundary(null));
describe('repository store mutation boundary', () => {
  it('permits pure action getters while activation blocks actual content setters', () => {
    const { store, boundary, committed } = fixture({ blocked: true });
    expect(store.getState().getContent()).toBe(1); expect(boundary.assertAllowed).not.toHaveBeenCalled();
    expect(() => store.getState().edit(2)).toThrow('Activation barrier');
    expect(store.getState().content).toBe(1); expect(committed).not.toHaveBeenCalled();
  });
  it('classifies runtime-only cleanup before checking the content barrier', () => {
    const { store, boundary, committed } = fixture({ blocked: true });
    store.getState().cleanup(); expect(store.getState().runtimeHandle).toBeNull();
    expect(boundary.prepare).toHaveBeenCalled(); expect(boundary.assertAllowed).not.toHaveBeenCalled();
    expect(committed).not.toHaveBeenCalled();
  });
  it('covers public direct setState before subscribers see content', () => {
    const { store } = fixture({ blocked: true }); const notified = vi.fn(); store.subscribe(notified);
    expect(() => store.setState({ content: 7 })).toThrow('Activation barrier');
    expect(store.getState().content).toBe(1); expect(notified).not.toHaveBeenCalled();
  });
  it('cancels an owned action exactly once when preparation fails', () => {
    const { store, cancelled, committed } = fixture({ preparationFails: true });
    expect(() => store.getState().edit(2)).toThrow('Preparation failed');
    expect(cancelled).toHaveBeenCalledTimes(1); expect(committed).not.toHaveBeenCalled(); expect(store.getState().content).toBe(1);
  });
  it('cancels an owned scope exactly once after finalization fails', () => {
    const { store, boundary, cancelled, committed } = fixture({ finalizationFails: true });
    expect(() => store.getState().edit(2)).toThrow('Finalization failed');
    expect(boundary.failed).toHaveBeenCalledTimes(1); expect(cancelled).toHaveBeenCalledTimes(1); expect(committed).not.toHaveBeenCalled();
  });
  it('reports direct preparation failure to the owner without an action wrapper', () => {
    const { store, boundary, cancelled } = fixture({ preparationFails: true });
    expect(() => store.setState({ content: 3 })).toThrow('Preparation failed');
    expect(boundary.failed).toHaveBeenCalledTimes(1); expect(cancelled).toHaveBeenCalledTimes(1); expect(store.getState().content).toBe(1);
  });
  it('suspends only the synchronous hydration scope and restores guarding after errors', () => {
    const { store, boundary } = fixture({ blocked: true });
    expect(() => withRepositoryHydration(() => { store.setState({ content: 3 }); throw new Error('Hydration failure'); })).toThrow('Hydration failure');
    expect(store.getState().content).toBe(3); expect(boundary.prepare).not.toHaveBeenCalled();
    expect(() => store.setState({ content: 4 })).toThrow('Activation barrier');
  });
});
