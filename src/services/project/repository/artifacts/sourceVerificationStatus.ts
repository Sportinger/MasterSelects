/**
 * Progress of the full-content hashing of original media (source identities), for the toolbar.
 * Hashing reads every byte of each new or replaced original, which can take minutes on large
 * camera files; the user should always see that it runs and how far it is.
 */
export interface SourceVerificationStatus {
  /** Originals still queued or being hashed. */
  files: number;
  /** Bytes read in this run: finished originals plus the progress of the running one. */
  bytesDone: number;
  bytesTotal: number;
}

interface Job { size: number; read: number }
const jobs = new Map<object, Job>();
const listeners = new Set<() => void>();
let finishedBytes = 0;
let finishedTotal = 0;
let snapshot: SourceVerificationStatus | null = null;

function publish(): void {
  if (jobs.size === 0) {
    // A run ends when the queue drains; the next one counts from zero again.
    finishedBytes = 0; finishedTotal = 0; snapshot = null;
  } else {
    let read = 0, total = 0;
    for (const job of jobs.values()) { read += job.read; total += job.size; }
    snapshot = { files: jobs.size, bytesDone: finishedBytes + read, bytesTotal: finishedTotal + total };
  }
  for (const listener of listeners) listener();
}

/** Registers one queued original; the returned callbacks report its read progress and its end. */
export function trackSourceVerification(size: number): { progress(bytes: number): void; finish(completed: boolean): void } {
  const key = {};
  jobs.set(key, { size, read: 0 });
  publish();
  return {
    progress(bytes) {
      const job = jobs.get(key);
      if (!job) return;
      job.read = Math.min(job.size, Math.max(job.read, bytes));
      publish();
    },
    finish(completed) {
      const job = jobs.get(key);
      if (!job) return;
      jobs.delete(key);
      // Cancelled or skipped originals leave the run instead of counting as read.
      if (completed) { finishedBytes += job.size; finishedTotal += job.size; }
      publish();
    },
  };
}

export function getSourceVerificationStatus(): SourceVerificationStatus | null { return snapshot; }
export function subscribeSourceVerificationStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function sourceVerificationPercent(status: SourceVerificationStatus): number {
  return status.bytesTotal > 0 ? Math.min(100, Math.floor(status.bytesDone / status.bytesTotal * 100)) : 0;
}
