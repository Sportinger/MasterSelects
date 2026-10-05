/** Backpressure for preview work. Export has its own completion barrier. */
export class PtPreviewScheduler {
  private inFlight = false;
  private requested = false;
  private notBefore = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly waitingTargets = new Set<string>();

  private readonly wake: () => void;

  constructor(wake: () => void) { this.wake = wake; }

  /** Worker hosts poll this in their frame report before an asynchronous wake has fired. */
  get needsFrame(): boolean { return this.requested || this.timer !== null; }

  /** Reuse the presented image until the GPU and its following idle interval finish. */
  canRender(target = 'main'): boolean {
    this.waitingTargets.add(target);
    if (!this.inFlight && performance.now() >= this.notBefore && this.waitingTargets.values().next().value === target) {
      this.waitingTargets.delete(target);
      return true;
    }
    this.request();
    return false;
  }

  request(): void {
    this.requested = true;
    if (this.inFlight || this.timer !== null) return;
    // Defer even an immediate wake: render() may still be encoding the current frame.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.inFlight || !this.requested) return;
      this.requested = false;
      this.wake();
    }, Math.max(0, this.notBefore - performance.now()));
  }

  /** Start the idle interval AFTER completion, using the cost of the entire submission. */
  submitted(done: Promise<void>, idleFactor: number): void {
    const generation = this.generation;
    const start = performance.now();
    this.inFlight = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    void done.then(() => {
      if (generation !== this.generation) return;
      this.inFlight = false;
      this.notBefore = performance.now() + Math.max(16, (performance.now() - start) * idleFactor);
      if (this.requested) this.request();
    }, () => {
      if (generation !== this.generation) return;
      this.inFlight = false;
      this.cancel();
    });
  }

  /** Turning off path tracing cancels future work, but cannot cancel a submitted GPU batch. */
  cancel(): void {
    this.requested = false;
    this.waitingTargets.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  releaseTarget(key: string): void { this.waitingTargets.delete(key); }

  dispose(): void {
    this.cancel();
    this.generation++;
    this.inFlight = false;
    this.notBefore = 0;
  }
}
