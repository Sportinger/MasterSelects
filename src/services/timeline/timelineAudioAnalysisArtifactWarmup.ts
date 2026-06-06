import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import {
  getCachedTimelineBeatGrid,
  getCachedTimelineOnsetMap,
  loadTimelineBeatGrid,
  loadTimelineOnsetMap,
  type TimelineBeatGrid,
  type TimelineOnsetMap,
} from '../audio/timelineBeatOnsetCache';
import {
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
  loadTimelineFrequencySummary,
  loadTimelinePhaseCorrelation,
  type TimelineFrequencySummary,
  type TimelinePhaseCorrelation,
} from '../audio/timelineFrequencyPhaseCache';
import {
  getCachedTimelineLoudnessEnvelope,
  loadTimelineLoudnessEnvelope,
  type TimelineLoudnessEnvelope,
} from '../audio/timelineLoudnessEnvelopeCache';
import type { TimelineCacheSchedulerLane } from './cacheSchedulerTypes';
import {
  createArtifactRefCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';

export type TimelineAudioAnalysisArtifactKind =
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'frequency-summary'
  | 'phase-correlation';

export type TimelineAudioAnalysisArtifact =
  | TimelineLoudnessEnvelope
  | TimelineBeatGrid
  | TimelineOnsetMap
  | TimelineFrequencySummary
  | TimelinePhaseCorrelation;

export interface TimelineAudioAnalysisArtifactRef {
  kind: TimelineAudioAnalysisArtifactKind;
  refId: string;
}

export interface TimelineAudioAnalysisArtifactWarmupClip {
  audioState?: {
    sourceAnalysisRefs?: MediaFileAudioAnalysisRefs;
    processedAnalysisRefs?: MediaFileAudioAnalysisRefs;
  };
}

export type TimelineAudioAnalysisArtifactLoadStatus =
  | 'ready'
  | 'missing'
  | 'error';

export interface TimelineAudioAnalysisArtifactLoadResult {
  kind: TimelineAudioAnalysisArtifactKind;
  refId: string;
  artifact: TimelineAudioAnalysisArtifact | null;
  status: TimelineAudioAnalysisArtifactLoadStatus;
  error?: unknown;
}

export interface TimelineAudioAnalysisArtifactWarmupDeps {
  getCachedArtifact: (
    kind: TimelineAudioAnalysisArtifactKind,
    refId: string | undefined,
  ) => TimelineAudioAnalysisArtifact | null;
  loadArtifact: (
    kind: TimelineAudioAnalysisArtifactKind,
    refId: string | undefined,
  ) => Promise<TimelineAudioAnalysisArtifact | null>;
}

export interface TimelineAudioAnalysisArtifactWarmupOptions {
  signal?: AbortSignal;
  deps?: TimelineAudioAnalysisArtifactWarmupDeps;
  onResult?: (result: TimelineAudioAnalysisArtifactLoadResult) => void;
}

const inFlightAudioAnalysisArtifactLoads = new Map<string, Promise<TimelineAudioAnalysisArtifact | null>>();

const defaultDeps: TimelineAudioAnalysisArtifactWarmupDeps = {
  getCachedArtifact: getCachedAudioAnalysisArtifact,
  loadArtifact: loadAudioAnalysisArtifact,
};

export function collectTimelineAudioAnalysisArtifactRefs(
  clips: readonly TimelineAudioAnalysisArtifactWarmupClip[],
): TimelineAudioAnalysisArtifactRef[] {
  const refs = new Map<string, TimelineAudioAnalysisArtifactRef>();

  for (const clip of clips) {
    const source = clip.audioState?.sourceAnalysisRefs;
    const processed = clip.audioState?.processedAnalysisRefs;

    addArtifactRef(refs, 'loudness-envelope', processed?.loudnessEnvelopeId ?? source?.loudnessEnvelopeId);
    addArtifactRef(refs, 'beat-grid', processed?.beatGridId ?? source?.beatGridId);
    addArtifactRef(refs, 'onset-map', processed?.onsetMapId ?? source?.onsetMapId);
    addArtifactRef(refs, 'frequency-summary', processed?.frequencySummaryId ?? source?.frequencySummaryId);
    addArtifactRef(refs, 'phase-correlation', processed?.phaseCorrelationId ?? source?.phaseCorrelationId);
  }

  return Array.from(refs.values()).toSorted(compareArtifactRefs);
}

export async function warmTimelineAudioAnalysisArtifacts(
  refs: readonly TimelineAudioAnalysisArtifactRef[],
  options: TimelineAudioAnalysisArtifactWarmupOptions = {},
): Promise<TimelineAudioAnalysisArtifactLoadResult[]> {
  const deps = options.deps ?? defaultDeps;
  const results: TimelineAudioAnalysisArtifactLoadResult[] = [];

  for (const ref of normalizeAudioAnalysisArtifactRefs(refs)) {
    if (options.signal?.aborted) break;

    const cached = deps.getCachedArtifact(ref.kind, ref.refId);
    if (cached) {
      const result = createAudioAnalysisArtifactResult(ref, cached);
      options.onResult?.(result);
      results.push(result);
      continue;
    }

    const key = formatTimelineCacheCoalescingKey(
      createArtifactRefCoalescingKey(getArtifactLoadLane(ref.kind), ref.refId, ref.kind),
    );
    let loadPromise = inFlightAudioAnalysisArtifactLoads.get(key);
    if (!loadPromise) {
      loadPromise = deps.loadArtifact(ref.kind, ref.refId)
        .finally(() => {
          inFlightAudioAnalysisArtifactLoads.delete(key);
        });
      inFlightAudioAnalysisArtifactLoads.set(key, loadPromise);
    }

    try {
      const artifact = await loadPromise;
      if (options.signal?.aborted) break;

      const result = createAudioAnalysisArtifactResult(ref, artifact);
      options.onResult?.(result);
      results.push(result);
    } catch (error) {
      if (options.signal?.aborted) break;

      const result: TimelineAudioAnalysisArtifactLoadResult = {
        ...ref,
        artifact: null,
        status: 'error',
        error,
      };
      options.onResult?.(result);
      results.push(result);
    }
  }

  return results;
}

function addArtifactRef(
  target: Map<string, TimelineAudioAnalysisArtifactRef>,
  kind: TimelineAudioAnalysisArtifactKind,
  refId: string | undefined,
): void {
  if (!refId) return;
  target.set(`${kind}:${refId}`, { kind, refId });
}

function normalizeAudioAnalysisArtifactRefs(
  refs: readonly TimelineAudioAnalysisArtifactRef[],
): TimelineAudioAnalysisArtifactRef[] {
  const unique = new Map<string, TimelineAudioAnalysisArtifactRef>();
  for (const ref of refs) {
    addArtifactRef(unique, ref.kind, ref.refId);
  }
  return Array.from(unique.values()).toSorted(compareArtifactRefs);
}

function compareArtifactRefs(
  a: TimelineAudioAnalysisArtifactRef,
  b: TimelineAudioAnalysisArtifactRef,
): number {
  const kindOrder = a.kind.localeCompare(b.kind);
  return kindOrder !== 0 ? kindOrder : a.refId.localeCompare(b.refId);
}

function createAudioAnalysisArtifactResult(
  ref: TimelineAudioAnalysisArtifactRef,
  artifact: TimelineAudioAnalysisArtifact | null,
): TimelineAudioAnalysisArtifactLoadResult {
  return {
    ...ref,
    artifact,
    status: artifact ? 'ready' : 'missing',
  };
}

function getArtifactLoadLane(
  kind: TimelineAudioAnalysisArtifactKind,
): TimelineCacheSchedulerLane {
  if (kind === 'loudness-envelope') return 'loudness-envelope-artifact-load';
  if (kind === 'beat-grid' || kind === 'onset-map') return 'beat-onset-artifact-load';
  return 'frequency-phase-artifact-load';
}

function getCachedAudioAnalysisArtifact(
  kind: TimelineAudioAnalysisArtifactKind,
  refId: string | undefined,
): TimelineAudioAnalysisArtifact | null {
  if (kind === 'loudness-envelope') return getCachedTimelineLoudnessEnvelope(refId);
  if (kind === 'beat-grid') return getCachedTimelineBeatGrid(refId) ?? null;
  if (kind === 'onset-map') return getCachedTimelineOnsetMap(refId) ?? null;
  if (kind === 'frequency-summary') return getCachedTimelineFrequencySummary(refId) ?? null;
  return getCachedTimelinePhaseCorrelation(refId) ?? null;
}

function loadAudioAnalysisArtifact(
  kind: TimelineAudioAnalysisArtifactKind,
  refId: string | undefined,
): Promise<TimelineAudioAnalysisArtifact | null> {
  if (kind === 'loudness-envelope') return loadTimelineLoudnessEnvelope(refId);
  if (kind === 'beat-grid') return loadTimelineBeatGrid(refId);
  if (kind === 'onset-map') return loadTimelineOnsetMap(refId);
  if (kind === 'frequency-summary') return loadTimelineFrequencySummary(refId);
  return loadTimelinePhaseCorrelation(refId);
}
