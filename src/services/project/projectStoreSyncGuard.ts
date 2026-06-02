let projectStoreSyncDepth = 0;

export function isProjectStoreSyncInProgress(): boolean {
  return projectStoreSyncDepth > 0;
}

export async function withProjectStoreSyncGuard<T>(work: () => Promise<T>): Promise<T> {
  projectStoreSyncDepth++;
  try {
    return await work();
  } finally {
    projectStoreSyncDepth = Math.max(0, projectStoreSyncDepth - 1);
  }
}
