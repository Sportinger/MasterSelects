// Waveform analysis that waits for a clip's media runtime instead of failing on reopen.
//
// While a project opens or reopens (also in a read-only tab or while linked media opens on
// demand) the media entry exists but its runtime File is not restored yet. Analysing then
// would report "No file found" and mark the clip as needing a reload although the media
// arrives a moment later. The analysis registers here instead and runs again once the File
// is there. Runtime-only state: nothing here is stored in a store or in project data.

/** Upper bound for one wait; the retry then classifies the clip again. */
export const WAVEFORM_MEDIA_DEFERRAL_TIMEOUT_MS = 120_000;
/** Waits per clip before a still-missing source is reported as unavailable. */
export const MAX_WAVEFORM_MEDIA_DEFERRALS = 3;

export type WaveformMediaDeferralOutcome = 'loaded' | 'timeout';

interface Deferral {
  dispose(): void;
}

const deferrals = new Map<string, Deferral>();

export interface DeferWaveformUntilMediaLoadedInput {
  clipId: string;
  watchLoaded: (onLoaded: () => void) => () => void;
  retry: (outcome: WaveformMediaDeferralOutcome) => void;
  timeoutMs?: number;
}

/** Runs `retry` once the clip's media runtime File is loaded, or after the timeout. Replaces an earlier wait. */
export function deferWaveformUntilMediaLoaded(input: DeferWaveformUntilMediaLoadedInput): void {
  deferrals.get(input.clipId)?.dispose();
  let settled = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const entry: Deferral = {
    dispose() {
      settled = true;
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (deferrals.get(input.clipId) === entry) deferrals.delete(input.clipId);
    },
  };
  const finish = (outcome: WaveformMediaDeferralOutcome) => {
    if (settled) return;
    entry.dispose();
    input.retry(outcome);
  };
  deferrals.set(input.clipId, entry);
  timer = setTimeout(() => finish('timeout'), input.timeoutMs ?? WAVEFORM_MEDIA_DEFERRAL_TIMEOUT_MS);
  // The watch may fire synchronously when the File arrived between resolution and subscription.
  const stop = input.watchLoaded(() => finish('loaded'));
  if (settled) stop();
  else unsubscribe = stop;
}

export function isWaveformWaitingForMedia(clipId: string): boolean {
  return deferrals.has(clipId);
}

export function cancelWaveformMediaDeferral(clipId: string): void {
  deferrals.get(clipId)?.dispose();
}

export function resetWaveformMediaDeferralsForTest(): void {
  for (const deferral of [...deferrals.values()]) deferral.dispose();
  deferrals.clear();
}
