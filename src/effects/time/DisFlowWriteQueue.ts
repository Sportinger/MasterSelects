/** Bounded background persistence. Capture starts before enqueue returns so
 * GPU copies precede any reuse/retirement of the source texture. Only a full
 * queue applies backpressure; ordinary file closes never gate each pair. */
export class DisFlowWriteQueue {
  private jobs = new Set<Promise<void>>();
  private limit: number;
  constructor(bytesPerPair: number) {
    this.limit = Math.max(1, Math.min(4, Math.floor(64*1024*1024/Math.max(1,bytesPerPair))));
  }

  async enqueue(captureAndWrite: () => Promise<void>): Promise<void> {
    while (this.jobs.size >= this.limit) await Promise.race(this.jobs);
    const job = captureAndWrite().catch(() => undefined);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
  }

  async drain(): Promise<void> { await Promise.all(this.jobs); }
}
