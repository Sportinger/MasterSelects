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
      loadPromise = deps.loadPyramid(refId)
        .finally(() => {
          inFlightWaveformArtifactLoads.delete(key);
        });
      inFlightWaveformArtifactLoads.set(key, loadPromise);
    }

    try {
      const pyramid = await loadPromise;
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
