// Shared retry bookkeeping for audio artifact warmup effects: refs whose load
// missed are re-attempted after retryMs (artifact stores may not be ready right
// after a refresh); a single timer per effect run bumps the caller's retry
// nonce so the owning effect re-runs.

export interface TimelineArtifactRetrySession<T> {
  refs: string[];
  publish: (refId: string, artifact: T | null) => void;
  dispose: () => void;
}

export function createTimelineArtifactRetrySession<T>(options: {
  refKey: string;
  retryMs: number;
  hasArtifact: (refId: string) => boolean;
  missedAt: Map<string, number>;
  bumpRetry: () => void;
  signal: AbortSignal;
  commit: (refId: string, artifact: T) => void;
}): TimelineArtifactRetrySession<T> {
  const now = Date.now();
  const refs = options.refKey.split('|').filter((refId) => {
    if (!refId || options.hasArtifact(refId)) return false;
    const missedAt = options.missedAt.get(refId);
    return missedAt === undefined || now - missedAt >= options.retryMs;
  });
  let retryTimer: number | null = null;

  return {
    refs,
    publish: (refId, artifact) => {
      if (options.signal.aborted) return;
      if (!artifact) {
        options.missedAt.set(refId, Date.now());
        if (retryTimer === null && typeof window !== 'undefined') {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            options.bumpRetry();
          }, options.retryMs);
        }
        return;
      }
      options.missedAt.delete(refId);
      options.commit(refId, artifact);
    },
    dispose: () => {
      if (retryTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimer);
      }
    },
  };
}
