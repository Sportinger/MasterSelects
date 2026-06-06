import type { TimelineSpectrogramTileSet } from '../audio/timelineSpectrogramCache';
import {
  getCachedTimelineSpectrogramTileSet,
  loadTimelineSpectrogramTileSet,
} from '../audio/timelineSpectrogramCache';
import {
  getPreferredSpectrogramTileSetRef,
  type TimelineSpectrogramPresenceInput,
} from '../../utils/audioSpectrogramPresence';
import {
  createArtifactRefCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';

export type TimelineSpectrogramArtifactWarmupClip = TimelineSpectrogramPresenceInput;

export type TimelineSpectrogramArtifactLoadStatus =
  | 'ready'
  | 'missing'
  | 'error';

export interface TimelineSpectrogramArtifactLoadResult {
  refId: string;
  tileSet: TimelineSpectrogramTileSet | null;
  status: TimelineSpectrogramArtifactLoadStatus;
  error?: unknown;
}

export interface TimelineSpectrogramArtifactWarmupDeps {
  getCachedTileSet: (refId: string | undefined) => TimelineSpectrogramTileSet | null;
  loadTileSet: (refId: string | undefined) => Promise<TimelineSpectrogramTileSet | null>;
}

export interface TimelineSpectrogramArtifactWarmupOptions {
  signal?: AbortSignal;
  deps?: TimelineSpectrogramArtifactWarmupDeps;
  onResult?: (result: TimelineSpectrogramArtifactLoadResult) => void;
}

const inFlightSpectrogramArtifactLoads = new Map<string, Promise<TimelineSpectrogramTileSet | null>>();

const defaultDeps: TimelineSpectrogramArtifactWarmupDeps = {
  getCachedTileSet: getCachedTimelineSpectrogramTileSet,
  loadTileSet: loadTimelineSpectrogramTileSet,
};

export function getCachedTimelineSpectrogramArtifact(
  refId: string | undefined,
  deps: TimelineSpectrogramArtifactWarmupDeps = defaultDeps,
): TimelineSpectrogramTileSet | null {
  return deps.getCachedTileSet(refId);
}

export function collectTimelineSpectrogramArtifactRefs(
  clips: readonly TimelineSpectrogramArtifactWarmupClip[],
): string[] {
  const refs = new Set<string>();

  for (const clip of clips) {
    const refId = getPreferredSpectrogramTileSetRef(clip);
    if (refId) refs.add(refId);
  }

  return Array.from(refs).sort();
}

export async function warmTimelineSpectrogramArtifacts(
  refIds: readonly string[],
  options: TimelineSpectrogramArtifactWarmupOptions = {},
): Promise<TimelineSpectrogramArtifactLoadResult[]> {
  const deps = options.deps ?? defaultDeps;
  const results: TimelineSpectrogramArtifactLoadResult[] = [];

  for (const refId of normalizeSpectrogramArtifactRefs(refIds)) {
    if (options.signal?.aborted) break;

    const cached = deps.getCachedTileSet(refId);
    if (cached) {
      const result = createSpectrogramArtifactResult(refId, cached);
      options.onResult?.(result);
      results.push(result);
      continue;
    }

    const key = formatTimelineCacheCoalescingKey(
      createArtifactRefCoalescingKey('spectrogram-tile-artifact-load', refId),
    );
    let loadPromise = inFlightSpectrogramArtifactLoads.get(key);
    if (!loadPromise) {
      loadPromise = deps.loadTileSet(refId)
        .finally(() => {
          inFlightSpectrogramArtifactLoads.delete(key);
        });
      inFlightSpectrogramArtifactLoads.set(key, loadPromise);
    }

    try {
      const tileSet = await loadPromise;
      if (options.signal?.aborted) break;

      const result = createSpectrogramArtifactResult(refId, tileSet);
      options.onResult?.(result);
      results.push(result);
    } catch (error) {
      if (options.signal?.aborted) break;

      const result: TimelineSpectrogramArtifactLoadResult = {
        refId,
        tileSet: null,
        status: 'error',
        error,
      };
      options.onResult?.(result);
      results.push(result);
    }
  }

  return results;
}

function normalizeSpectrogramArtifactRefs(refIds: readonly string[]): string[] {
  return Array.from(new Set(refIds.filter(Boolean))).sort();
}

function createSpectrogramArtifactResult(
  refId: string,
  tileSet: TimelineSpectrogramTileSet | null,
): TimelineSpectrogramArtifactLoadResult {
  return {
    refId,
    tileSet,
    status: tileSet ? 'ready' : 'missing',
  };
}
