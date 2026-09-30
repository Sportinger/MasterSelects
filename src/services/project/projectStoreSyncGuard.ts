let projectStoreSyncDepth = 0;
let projectStoreDirtyMarkSuppressionDepth = 0;
const syncWaiters = new Set<() => void>();

/** Wake after the outermost restore/save synchronization releases its guard. */
export function waitForProjectStoreSync(): Promise<void> {
  if (!isProjectStoreSyncInProgress()) return Promise.resolve();
  return new Promise(resolve => { syncWaiters.add(resolve); });
}

export interface ProjectStoreSyncGuardOptions {
  suppressDirtyMarks?: boolean;
}

export function isProjectStoreSyncInProgress(): boolean {
  return projectStoreSyncDepth > 0;
}

export function isProjectStoreDirtyMarkSuppressed(): boolean {
  return projectStoreDirtyMarkSuppressionDepth > 0;
}

export function withProjectStoreDirtyMarkSuppressed<T>(work: () => T): T {
  projectStoreDirtyMarkSuppressionDepth++;
  try {
    return work();
  } finally {
    projectStoreDirtyMarkSuppressionDepth = Math.max(0, projectStoreDirtyMarkSuppressionDepth - 1);
  }
}

export async function withProjectStoreSyncGuard<T>(
  work: () => Promise<T>,
  options: ProjectStoreSyncGuardOptions = {},
): Promise<T> {
  projectStoreSyncDepth++;
  const suppressDirtyMarks = options.suppressDirtyMarks !== false;
  if (suppressDirtyMarks) {
    projectStoreDirtyMarkSuppressionDepth++;
  }
  try {
    return await work();
  } finally {
    if (suppressDirtyMarks) {
      projectStoreDirtyMarkSuppressionDepth = Math.max(0, projectStoreDirtyMarkSuppressionDepth - 1);
    }
    projectStoreSyncDepth = Math.max(0, projectStoreSyncDepth - 1);
    if (projectStoreSyncDepth === 0) {
      for (const resolve of syncWaiters) resolve();
      syncWaiters.clear();
    }
  }
}
