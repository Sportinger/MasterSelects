import type {
  StateCreator,
  StoreApi,
  StoreMutatorIdentifier,
} from 'zustand';

export interface ExclusiveTimelineMutationLease {
  readonly id: symbol;
  readonly label: string;
}

export class ExclusiveTimelineMutationBlockedError extends Error {
  constructor() {
    super('project editing is temporarily locked by a verified kernel operation');
    this.name = 'ExclusiveTimelineMutationBlockedError';
  }
}

let activeLease: ExclusiveTimelineMutationLease | null = null;
let authorizedLease: ExclusiveTimelineMutationLease | null = null;

export function acquireExclusiveTimelineMutationLease(
  label: string,
): ExclusiveTimelineMutationLease {
  if (activeLease !== null) {
    throw new Error('another verified kernel operation already owns the timeline mutation lease');
  }
  const lease = Object.freeze({ id: Symbol(label), label });
  activeLease = lease;
  return lease;
}

/**
 * Authorizes only the synchronous mutation phase started by the lease owner.
 * If an editor handler begins mutating after an await, the middleware blocks it
 * instead of leaving the UI unlocked for the entire asynchronous call.
 */
export function runWithExclusiveTimelineMutationLease<T>(
  lease: ExclusiveTimelineMutationLease,
  action: () => T,
): T {
  if (activeLease !== lease || authorizedLease !== null) {
    throw new Error('timeline mutation lease is not exclusively owned');
  }
  authorizedLease = lease;
  try {
    return action();
  } finally {
    authorizedLease = null;
  }
}

export function releaseExclusiveTimelineMutationLease(
  lease: ExclusiveTimelineMutationLease,
): void {
  if (activeLease !== lease) {
    throw new Error('timeline mutation lease ownership was lost');
  }
  if (authorizedLease !== null) {
    throw new Error('timeline mutation lease cannot be released during a mutation');
  }
  activeLease = null;
}

export function assertExclusiveTimelineMutationAllowed(): void {
  if (activeLease !== null && authorizedLease !== activeLease) {
    throw new ExclusiveTimelineMutationBlockedError();
  }
}

export function isExclusiveTimelineMutationLeaseActive(): boolean {
  return activeLease !== null;
}

/**
 * Guards a Zustand store whose state participates in the global history
 * snapshot. The guard is installed on both the `set` passed to store actions
 * and the public `setState`; otherwise direct store edits could still leak
 * into the open batch.
 *
 * The updater is evaluated only after the lease check, so rejected writers
 * cannot cause updater side effects before being blocked.
 */
export function withExclusiveHistorySnapshotMutationLease<
  T,
  StoreMutators extends [StoreMutatorIdentifier, unknown][] = [],
>(
  initializer: StateCreator<T, [], StoreMutators>,
): StateCreator<T, [], StoreMutators> {
  return (set, get, store) => {
    const guardedSet = ((...args: Parameters<typeof set>): ReturnType<typeof set> => {
      assertExclusiveTimelineMutationAllowed();
      return set(...args);
    }) as typeof set;

    store.setState = guardedSet as StoreApi<T>['setState'];
    return initializer(guardedSet, get, store);
  };
}
