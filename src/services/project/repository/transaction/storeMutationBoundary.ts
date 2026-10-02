import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand';

export interface StoreMutationBoundary {
  assertAllowed(domain: string): void;
  beginAction(domain: string, label: string): unknown;
  /** Called before the actual set: freeze previous versions of touched entities. */
  prepare(domain: string, before: unknown, patch: unknown, replacing: boolean): unknown;
  finish(domain: string, preparation: unknown, after: unknown): void;
  endAction(action: unknown, error?: unknown): void;
  failed?(domain: string, preparation: unknown, error: unknown): void;
}

export interface RepositoryStoreHandle { getState(): unknown; setState(value: unknown, replace?: boolean): void; }
const stores: Map<string, RepositoryStoreHandle> = import.meta.hot?.data?.repositoryStores ?? new Map();
export function getRepositoryStore(domain: string): RepositoryStoreHandle | undefined { return stores.get(domain); }
interface BoundaryRuntime { boundary: StoreMutationBoundary | null; suspension: number; }
const runtime: BoundaryRuntime = import.meta.hot?.data?.repositoryMutationBoundary ?? { boundary: null, suspension: 0 };

export function installStoreMutationBoundary(boundary: StoreMutationBoundary | null): void { runtime.boundary = boundary; }
export function withRepositoryHydration<T>(action: () => T): T {
  runtime.suspension++;
  try { return action(); } finally { runtime.suspension--; }
}
export function isRepositoryHydrating(): boolean { return runtime.suspension > 0; }

/** Covers actions, internal setters and public setState, before subscribers run. */
export function withRepositoryStoreMutation<T, Mutators extends [StoreMutatorIdentifier, unknown][] = []>(
  domain: string, initializer: StateCreator<T, [], Mutators>,
): StateCreator<T, [], Mutators> {
  return (set, get, store) => {
    const guardedSet = ((update: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => {
      const boundary = runtime.suspension ? null : runtime.boundary;
      const before = get();
      const patch = typeof update === 'function' ? (update as (state: T) => T | Partial<T>)(before) : update;
      let preparation: unknown;
      try {
        preparation = boundary?.prepare(domain, before, patch, replace === true);
        if (replace) set(patch as T, true); else set(patch);
        boundary?.finish(domain, preparation, get());
      } catch (error) { boundary?.failed?.(domain, preparation, error); throw error; }
    }) as typeof set;
    const state = initializer(guardedSet, get, store);
    // An inner revision/lease middleware can install its own direct setter.
    // Retain it, routing its underlying set through this boundary exactly once.
    const innerDirectSet = store.setState;
    if (innerDirectSet === set) store.setState = guardedSet as StoreApi<T>['setState'];
    const wrapped = { ...state };
    for (const key of Object.keys(wrapped as object) as (keyof T)[]) {
      const action = wrapped[key];
      if (typeof action !== 'function') continue;
      (wrapped as Record<keyof T, unknown>)[key] = (...args: unknown[]) => {
        const boundary = runtime.suspension ? null : runtime.boundary;
        const scope = boundary?.beginAction(domain, String(key));
        let result: unknown;
        try { result = (action as (...values: unknown[]) => unknown)(...args); }
        catch (error) { boundary?.endAction(scope, error); throw error; }
        boundary?.endAction(scope);
        return result;
      };
    }
    stores.set(domain, store as unknown as RepositoryStoreHandle);
    return wrapped;
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.repositoryMutationBoundary = runtime; data.repositoryStores = stores; });
  import.meta.hot.accept();
}
