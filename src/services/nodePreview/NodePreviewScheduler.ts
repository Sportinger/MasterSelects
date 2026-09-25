import { releasePreviewFrame, type PreviewFrame, type PreviewRequest } from './previewTypes';

export interface PreviewSchedulerStats {
  requested: number; inFlight: number; completed: number; discarded: number;
  errors: number; workMs: number; pixels: number;
}
type Produce = (request: PreviewRequest) => PreviewFrame | Promise<PreviewFrame>;
// A preview that keeps coming back empty backs off exponentially and then rests
// until its revision changes. Endless retries of an unrenderable stage would
// otherwise wake the render loop every interval and keep a paused engine busy.
const MAX_MISSES = 3;
const MAX_RETRY_MS = 2000;

/** Latest-request mailbox, bounded concurrency and a shared token bucket. No per-node timers. */
export class NodePreviewScheduler {
  private requests = new Map<string, PreviewRequest>();
  private pending = new Set<string>();
  private pendingNumeric = new Set<string>();
  private completed = new Map<string, { revision: string; at: number }>();
  private attempted = new Map<string, number>();
  private misses = new Map<string, { revision: string; count: number }>();
  private tokens = 262144;
  private lastTick = 0;
  private disposed = false;
  private generation = 0;
  readonly stats: PreviewSchedulerStats = { requested: 0, inFlight: 0, completed: 0, discarded: 0, errors: 0, workMs: 0, pixels: 0 };

  private produce: Produce;
  private publish: (frame: PreviewFrame) => void;
  private clock: () => number;
  private limits: { concurrent: number; pixelsPerSecond: number; workMs: number; jobsPerTick: number };
  constructor(produce: Produce, publish: (frame: PreviewFrame) => void,
    clock: () => number = () => performance.now(),
    limits = { concurrent: 2, pixelsPerSecond: 2_000_000, workMs: 2, jobsPerTick: 24 }) {
    this.produce = produce; this.publish = publish; this.clock = clock; this.limits = limits;
  }
  get unsettled() { return this.pending.size > 0 || [...this.requests.values()].some(request => this.awaiting(request)); }
  /** Milliseconds until the earliest unsettled request may be attempted again. */
  nextRetryIn(now = this.clock()) {
    if (this.pending.size) return 0;
    let wait = Infinity;
    for (const request of this.requests.values()) if (!this.pending.has(request.key) && this.awaiting(request))
      wait = Math.min(wait, (this.attempted.get(request.key) ?? -Infinity) + this.retryDelay(request) - now);
    return Number.isFinite(wait) ? Math.max(0, wait) : 0;
  }
  private awaiting(request: PreviewRequest) {
    const miss = this.misses.get(request.key);
    return this.completed.get(request.key)?.revision !== request.revision && !(miss?.revision === request.revision && miss.count >= MAX_MISSES);
  }
  private retryDelay(request: PreviewRequest) {
    const miss = this.misses.get(request.key);
    return miss?.revision === request.revision ? Math.min(MAX_RETRY_MS, request.interval * 2 ** miss.count) : request.interval;
  }

  setRequests(requests: PreviewRequest[]) {
    if (this.disposed) return;
    const next = new Map<string, PreviewRequest>();
    for (const request of requests) {
      const previous = next.get(request.key);
      if (!previous) next.set(request.key, request);
      else next.set(request.key, { ...request, width: Math.max(previous.width, request.width), height: Math.max(previous.height, request.height), priority: Math.max(previous.priority, request.priority) });
    }
    this.requests = next;
    for (const key of this.completed.keys()) if (!next.has(key)) this.completed.delete(key);
    for (const key of this.attempted.keys()) if (!next.has(key)) this.attempted.delete(key);
    for (const key of this.misses.keys()) if (!next.has(key)) this.misses.delete(key);
    this.stats.requested = next.size;
  }

  tick(now = this.clock()) {
    if (this.disposed) return;
    this.tokens = Math.min(262144, this.tokens + Math.max(0, now - this.lastTick) * this.limits.pixelsPerSecond / 1000);
    this.lastTick = now;
    const start = this.clock();
    // Age dominates selection priority, so a selected node cannot starve its neighbours.
    const ready = [...this.requests.values()].filter(request => !this.pending.has(request.key) && this.awaiting(request)
      && now - (this.attempted.get(request.key) ?? -Infinity) >= this.retryDelay(request)).toSorted((a, b) => (this.attempted.get(a.key) ?? -1e9) - (this.attempted.get(b.key) ?? -1e9) - (a.priority - b.priority) * 20);
    let jobs = 0;
    for (const request of ready) {
      if (jobs >= this.limits.jobsPerTick || this.clock() - start >= this.limits.workMs) break;
      if (request.numeric ? this.pendingNumeric.size >= 16 : this.pending.size - this.pendingNumeric.size >= this.limits.concurrent) continue;
      const pixels = request.numeric ? 0 : request.width * request.height;
      if (pixels > this.tokens) continue;
      this.tokens -= pixels; this.stats.pixels += pixels; jobs++;
      this.attempted.set(request.key, now);
      this.pending.add(request.key); this.stats.inFlight = this.pending.size;
      if (request.numeric) this.pendingNumeric.add(request.key);
      const generation = this.generation;
      const finish = (frame: PreviewFrame) => {
        this.pending.delete(request.key); this.pendingNumeric.delete(request.key); this.stats.inFlight = this.pending.size;
        const current = this.requests.get(request.key);
        const continuous = current?.continuity !== undefined && current.continuity === request.continuity
          && Math.abs(current.time - request.time) <= 0.5;
        if (this.disposed || generation !== this.generation || !current || (current.revision !== request.revision && !continuous)) {
          releasePreviewFrame(frame); this.stats.discarded++; return;
        }
        if (frame.status !== 'missing' && frame.status !== 'error' && frame.status !== 'stale') {
          this.completed.set(request.key, { revision: request.revision, at: now }); this.misses.delete(request.key);
        } else {
          const miss = this.misses.get(request.key);
          this.misses.set(request.key, { revision: request.revision, count: miss?.revision === request.revision ? miss.count + 1 : 1 });
        }
        this.stats.completed++;
        this.publish(frame);
      };
      const fail = () => finish({ key: request.key, revision: request.revision, time: request.time, status: 'error', label: 'Preview unavailable' });
      try {
        const result = this.produce(request);
        if (result instanceof Promise) void result.then(finish, () => { this.stats.errors++; fail(); });
        else finish(result);
      } catch { this.stats.errors++; fail(); }
    }
    this.stats.workMs = this.clock() - start;
  }

  invalidate() { this.completed.clear(); this.misses.clear(); this.generation++; }
  invalidateValues() { for (const request of this.requests.values()) if (request.numeric) { this.completed.delete(request.key); this.misses.delete(request.key); } }
  dispose() { this.disposed = true; this.generation++; this.requests.clear(); this.completed.clear(); this.attempted.clear(); this.misses.clear(); }
}
