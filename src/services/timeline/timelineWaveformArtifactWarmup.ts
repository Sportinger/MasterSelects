import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import {
  getCachedTimelineWaveformPyramid,
  loadTimelineWaveformPyramid,
} from '../audio/timelineWaveformPyramidCache';
import {
  getPreferredWaveformPyramidRef,
  type TimelineWaveformPresenceInput,
} from '../../utils/audioWaveformPresence';
import {
  createArtifactRefCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';

export type TimelineWaveformArtifactWarmupClip = TimelineWaveformPresenceInput;

export type TimelineWaveformArtifactLoadStatus =
  | 'ready'
  | 'missing'
  | 'error';

export interface TimelineWaveformArtifactLoadResult {
  refId: string;
  pyramid: TimelineWaveformPyramid | null;
  status: TimelineWaveformArtifactLoadStatus;
  error?: unknown;
}

export interface TimelineWaveformArtifactWarmupDeps {
  getCachedPyramid: (refId: string | undefined) => TimelineWaveformPyramid | null;
  loadPyramid: (refId: string | undefined) => Promise<TimelineWaveformPyramid | null>;
}

export interface TimelineWaveformArtifactWarmupOptions {
  signal?: AbortSignal;
  deps?: TimelineWaveformArtifactWarmupDeps;
  onResult?: (result: TimelineWaveformArtifactLoadResult) => void;
}

const inFlightWaveformArtifactLoads = new Map<string, Promise<TimelineWaveformPyramid | null>>();

// Artifact store reads can stall right after a page reload (store still
// initializing). A stalled load would otherwise never resolve, so the caller's
// miss/retry path never fires AND the stuck promise stays cached as in-flight,
// poisoning every later attempt. Treat a slow load as a miss and evict it from
// the in-flight map so the next retry starts a fresh load (which also sees the
// module cache if another path primed it meanwhile).
const WAVEFORM_ARTIFACT_LOAD_TIMEOUT_MS = 4000;

function raceLoadWithTimeout(
  key: string,
  loadPromise: Promise<TimelineWaveformPyramid | null>,
  timeoutMs: number,
  onLatePyramid?: (pyramid: TimelineWaveformPyramid) => void,
): Promise<TimelineWaveformPyramid | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      timedOut = true;
      // Drop the stalled promise so retries create a fresh load. If the
      // stalled load settles later it still primes the pyramid cache itself.
      if (inFlightWaveformArtifactLoads.get(key) === loadPromise) {
        inFlightWaveformArtifactLoads.delete(key);
      }
      resolve(null);
    }, timeoutMs);

    loadPromise.then(
      (pyramid) => {
        if (settled) {
          if (timedOut && pyramid) {
            onLatePyramid?.(pyramid);
          }
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(pyramid);
      },
      () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

const defaultDeps: TimelineWaveformArtifactWarmupDeps = {
  getCachedPyramid: getCachedTimelineWaveformPyramid,
  loadPyramid: loadTimelineWaveformPyramid,
};

export function getCachedTimelineWaveformArtifact(
  refId: string | undefined,
  deps: TimelineWaveformArtifactWarmupDeps = defaultDeps,
): TimelineWaveformPyramid | null {
  return deps.getCachedPyramid(refId);
}

export function collectTimelineWaveformArtifactRefs(
  clips: readonly TimelineWaveformArtifactWarmupClip[],
): string[] {
  const refs = new Set<string>();

  for (const clip of clips) {
    const refId = getPreferredWaveformPyramidRef(clip);
    if (refId) refs.add(refId);
  }

  return Array.from(refs).sort();
}

export async function warmTimelineWaveformArtifacts(
  refIds: readonly string[],
  options: TimelineWaveformArtifactWarmupOptions = {},
): Promise<TimelineWaveformArtifactLoadResult[]> {
  const deps = options.deps ?? defaultDeps;
  const results: TimelineWaveformArtifactLoadResult[] = [];

  for (const refId of normalizeWaveformArtifactRefs(refIds)) {
    if (options.signal?.aborted) break;

    const cached = deps.getCachedPyramid(refId);
    if (cached) {
      const result = createWaveformArtifactResult(refId, cached);
      options.onResult?.(result);
      results.push(result);
      continue;
    }

    const key = formatTimelineCacheCoalescingKey(
      createArtifactRefCoalescingKey('waveform-artifact-load', refId),
    );
    let loadPromise = inFlightWaveformArtifactLoads.get(key);
    if (!loadPromise) {
      const nextLoadPromise = deps.loadPyramid(refId)
        .finally(() => {
          if (inFlightWaveformArtifactLoads.get(key) === nextLoadPromise) {
            inFlightWaveformArtifactLoads.delete(key);
          }
        });
      loadPromise = nextLoadPromise;
      inFlightWaveformArtifactLoads.set(key, loadPromise);
    }

    try {
      const pyramid = await raceLoadWithTimeout(
        key,
        loadPromise,
        WAVEFORM_ARTIFACT_LOAD_TIMEOUT_MS,
        (latePyramid) => {
          if (options.signal?.aborted) return;
          options.onResult?.(createWaveformArtifactResult(refId, latePyramid));
        },
      );
      if (options.signal?.aborted) break;

      const result = createWaveformArtifactResult(refId, pyramid);
      options.onResult?.(result);
      results.push(result);
    } catch (error) {
      if (options.signal?.aborted) break;

      const result: TimelineWaveformArtifactLoadResult = {
        refId,
        pyramid: null,
        status: 'error',
        error,
      };
      options.onResult?.(result);
      results.push(result);
    }
  }

  return results;
}

function normalizeWaveformArtifactRefs(refIds: readonly string[]): string[] {
  return Array.from(new Set(refIds.filter(Boolean))).sort();
}

function createWaveformArtifactResult(
  refId: string,
  pyramid: TimelineWaveformPyramid | null,
): TimelineWaveformArtifactLoadResult {
  return {
    refId,
    pyramid,
    status: pyramid ? 'ready' : 'missing',
  };
}
