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
export function runBackgroundSourceWaveform<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return enqueue(state, work, signal);
}

export function runBackgroundWaveformDerivation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return enqueue(derivations, work, signal);
}

/** Reopening a large project must not start one worker per cached source. */
export function runWaveformCacheWork<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const queue = cacheJobs.tails[cacheJobs.next++ % cacheJobs.tails.length];
  return enqueue(queue, work, signal);
}

function enqueue<T>(queue: { tail: Promise<void> }, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const result = queue.tail.then(() => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Waveform analysis cancelled', 'AbortError');
    return work();
  });
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
