const state: { tail: Promise<void> } = import.meta.hot?.data?.queueState ?? { tail: Promise.resolve() };
const derivations: { tail: Promise<void> } = import.meta.hot?.data?.derivationQueue ?? { tail: Promise.resolve() };
const cacheJobs: { tails: Array<{ tail: Promise<void> }>; next: number } = import.meta.hot?.data?.cacheQueue
  ?? { tails: [{ tail: Promise.resolve() }, { tail: Promise.resolve() }], next: 0 };
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.queueState = state; });
  import.meta.hot.dispose(data => { data.derivationQueue = derivations; });
  import.meta.hot.dispose(data => { data.cacheQueue = cacheJobs; });
  import.meta.hot.accept();
}

/** Only one cold source analysis owns decoded PCM at a time. Cache reads stay
 * outside this queue, and queued work never holds a project artifact batch.
 */
export function runBackgroundSourceWaveform<T>(
  work: (progress: () => void) => Promise<T>,
  signal?: AbortSignal,
  stall: QueueStall = { ms: SOURCE_WAVEFORM_STALL_MS },
): Promise<T> {
  return enqueue(state, work, signal, stall);
}

/**
 * A source analysis that reports no progress for this long stops holding the queue: the next sources start instead
 * of waiting at 0 % behind one hung source. The stalled work keeps running and still delivers if it finishes.
 */
export const SOURCE_WAVEFORM_STALL_MS = 90_000;

interface QueueStall {
  ms: number;
  /** Called once when the work stalls and the queue goes on without it. */
  onStall?: () => void;
}

export function runBackgroundWaveformDerivation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return enqueue(derivations, work, signal);
}

/** Reopening a large project must not start one worker per cached source. */
export function runWaveformCacheWork<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const queue = cacheJobs.tails[cacheJobs.next++ % cacheJobs.tails.length];
  return enqueue(queue, work, signal);
}

function enqueue<T>(
  queue: { tail: Promise<void> },
  work: (progress: () => void) => Promise<T>,
  signal?: AbortSignal,
  stall?: QueueStall,
): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const result = queue.tail.then(() => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Waveform analysis cancelled', 'AbortError');
    // Every progress report restarts the stall timer.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const progress = () => {
      if (!stall) return;
      clearTimeout(timer);
      timer = setTimeout(() => { stall.onStall?.(); release(); }, stall.ms);
    };
    progress();
    return work(progress).finally(() => clearTimeout(timer));
  });
  queue.tail = Promise.race([result.then(() => undefined, () => undefined), released]);
  return result;
}
