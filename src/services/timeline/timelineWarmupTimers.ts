type TimelineWarmupTimerHandle = ReturnType<typeof setTimeout>;

export interface TimelineWarmupTimerDeps {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export function getTimelineWarmupTimerDeps(): TimelineWarmupTimerDeps {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    clearTimeout: globalThis.clearTimeout.bind(globalThis) as typeof clearTimeout,
  };
}

export function clearTimelineWarmupTimers(timers: Iterable<TimelineWarmupTimerHandle>): void {
  const { clearTimeout: clearBoundTimeout } = getTimelineWarmupTimerDeps();
  for (const timer of timers) {
    clearBoundTimeout(timer);
  }
}
