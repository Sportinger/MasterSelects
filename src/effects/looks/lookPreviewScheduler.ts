type PreviewJob = () => Promise<void>;

class LookPreviewScheduler {
  private jobs = new Map<string, PreviewJob>();
  private frameId: number | null = null;

  enqueue(key: string, job: PreviewJob): void {
    this.jobs.set(key, job);
    this.schedule();
  }

  cancel(key: string): void {
    this.jobs.delete(key);
  }

  private schedule(): void {
    if (this.frameId !== null || this.jobs.size === 0) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      const next = this.jobs.entries().next().value as [string, PreviewJob] | undefined;
      if (!next) return;
      this.jobs.delete(next[0]);
      void next[1]().finally(() => this.schedule());
    });
  }
}

export const lookPreviewScheduler = new LookPreviewScheduler();
