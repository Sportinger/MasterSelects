import type {
  ClipAudioState,
  MediaFileAudioAnalysisRefs,
} from '../../types/audio';
import { clipAudioAnalysisJobService } from '../audio/ClipAudioAnalysisJobService';
import {
  evictTimelineBeatOnsetRefs,
} from '../audio/timelineBeatOnsetCache';
import {
  evictTimelineFrequencyPhaseRefs,
} from '../audio/timelineFrequencyPhaseCache';
import {
  evictTimelineLoudnessEnvelopeRefs,
} from '../audio/timelineLoudnessEnvelopeCache';
import {
  evictTimelineSpectrogramTileSetRefs,
} from '../audio/timelineSpectrogramCache';
import {
  evictTimelineWaveformPyramidRefs,
} from '../audio/timelineWaveformPyramidCache';
import { thumbnailCacheService } from '../thumbnailCacheService';
import { createMediaCacheInvalidationPlan } from './cacheSchedulerContracts';
import type {
  TimelineAudioCacheRefSet,
  TimelineCacheInvalidationAction,
  TimelineCacheInvalidationInput,
  TimelineCacheInvalidationPlan,
} from './cacheSchedulerTypes';
import { closeSource as closeThumbnailBitmapSource } from './thumbnailBitmapCache';

export interface TimelineAudioCacheRefClip {
  id?: string;
  audioState?: Pick<ClipAudioState, 'sourceAnalysisRefs' | 'processedAnalysisRefs'>;
}

export interface TimelineCacheInvalidationDeps {
  abortThumbnailGeneration: (mediaFileId: string) => void;
  clearSourceThumbnails: (mediaFileId: string) => Promise<void>;
  evictSourceThumbnails: (mediaFileId: string) => void;
  closeThumbnailBitmaps: (mediaFileId: string) => void;
  evictWaveformRefs: (refIds: readonly string[]) => number;
  evictSpectrogramRefs: (refIds: readonly string[]) => number;
  evictLoudnessRefs: (refIds: readonly string[]) => number;
  evictBeatOnsetRefs: (refIds: readonly string[]) => number;
  evictFrequencyPhaseRefs: (refIds: readonly string[]) => number;
  cancelClipAnalysisJobs: (clipId: string) => number;
}

export interface TimelineCacheInvalidationActionResult {
  service: TimelineCacheInvalidationAction['service'];
  type: TimelineCacheInvalidationAction['type'];
  affectedCount: number;
}

export interface TimelineCacheInvalidationExecutionResult {
  plan: TimelineCacheInvalidationPlan;
  actions: TimelineCacheInvalidationActionResult[];
}

const defaultTimelineCacheInvalidationDeps: TimelineCacheInvalidationDeps = {
  abortThumbnailGeneration: (mediaFileId) => thumbnailCacheService.abort(mediaFileId),
  clearSourceThumbnails: (mediaFileId) => thumbnailCacheService.clearSource(mediaFileId),
  evictSourceThumbnails: (mediaFileId) => thumbnailCacheService.evictFromMemory(mediaFileId),
  closeThumbnailBitmaps: (mediaFileId) => closeThumbnailBitmapSource(mediaFileId),
  evictWaveformRefs: (refIds) => evictTimelineWaveformPyramidRefs(refIds),
  evictSpectrogramRefs: (refIds) => evictTimelineSpectrogramTileSetRefs(refIds),
  evictLoudnessRefs: (refIds) => evictTimelineLoudnessEnvelopeRefs(refIds),
  evictBeatOnsetRefs: (refIds) => evictTimelineBeatOnsetRefs(refIds),
  evictFrequencyPhaseRefs: (refIds) => evictTimelineFrequencyPhaseRefs(refIds),
  cancelClipAnalysisJobs: (clipId) => clipAudioAnalysisJobService.cancelClip(clipId),
};

function addRef(target: Set<string>, value: string | undefined): void {
  if (value) {
    target.add(value);
  }
}

function addRefs(target: Set<string>, values: readonly string[] | undefined): void {
  for (const value of values ?? []) {
    addRef(target, value);
  }
}

function addAnalysisRefs(
  refs: MediaFileAudioAnalysisRefs | undefined,
  output: Record<keyof Required<TimelineAudioCacheRefSet>, Set<string>>,
): void {
  addRef(output.waveformPyramidIds, refs?.waveformPyramidId);
  addRef(output.processedWaveformPyramidIds, refs?.processedWaveformPyramidId);
  addRefs(output.spectrogramTileSetIds, refs?.spectrogramTileSetIds);
  addRef(output.loudnessEnvelopeIds, refs?.loudnessEnvelopeId);
  addRef(output.beatGridIds, refs?.beatGridId);
  addRef(output.onsetMapIds, refs?.onsetMapId);
  addRef(output.phaseCorrelationIds, refs?.phaseCorrelationId);
  addRef(output.frequencySummaryIds, refs?.frequencySummaryId);
}

export function collectTimelineAudioCacheRefsFromClips(
  clips: readonly TimelineAudioCacheRefClip[],
): Required<TimelineAudioCacheRefSet> {
  const output = {
    waveformPyramidIds: new Set<string>(),
    processedWaveformPyramidIds: new Set<string>(),
    spectrogramTileSetIds: new Set<string>(),
    loudnessEnvelopeIds: new Set<string>(),
    beatGridIds: new Set<string>(),
    onsetMapIds: new Set<string>(),
    phaseCorrelationIds: new Set<string>(),
    frequencySummaryIds: new Set<string>(),
  };

  for (const clip of clips) {
    addAnalysisRefs(clip.audioState?.sourceAnalysisRefs, output);
    addAnalysisRefs(clip.audioState?.processedAnalysisRefs, output);
  }

  return {
    waveformPyramidIds: [...output.waveformPyramidIds],
    processedWaveformPyramidIds: [...output.processedWaveformPyramidIds],
    spectrogramTileSetIds: [...output.spectrogramTileSetIds],
    loudnessEnvelopeIds: [...output.loudnessEnvelopeIds],
    beatGridIds: [...output.beatGridIds],
    onsetMapIds: [...output.onsetMapIds],
    phaseCorrelationIds: [...output.phaseCorrelationIds],
    frequencySummaryIds: [...output.frequencySummaryIds],
  };
}

function refIdsFromAction(action: TimelineCacheInvalidationAction): readonly string[] {
  return action.target.refIds ?? [];
}

function clipIdsFromAction(action: TimelineCacheInvalidationAction): readonly string[] {
  return action.target.clipIds ?? [];
}

export async function executeTimelineCacheInvalidationPlan(
  plan: TimelineCacheInvalidationPlan,
  deps: TimelineCacheInvalidationDeps = defaultTimelineCacheInvalidationDeps,
): Promise<TimelineCacheInvalidationExecutionResult> {
  const actions: TimelineCacheInvalidationActionResult[] = [];

  for (const action of plan.actions) {
    let affectedCount = 0;

    if (action.service === 'thumbnailCacheService' && action.type === 'abort-queued-work') {
      deps.abortThumbnailGeneration(plan.mediaFileId);
      affectedCount = 1;
    } else if (action.service === 'thumbnailCacheService' && action.type === 'clear-source-thumbnails') {
      await deps.clearSourceThumbnails(plan.mediaFileId);
      affectedCount = 1;
    } else if (action.service === 'thumbnailCacheService' && action.type === 'evict-memory') {
      deps.evictSourceThumbnails(plan.mediaFileId);
      affectedCount = 1;
    } else if (action.service === 'thumbnailBitmapCache' && action.type === 'close-decoded-resources') {
      deps.closeThumbnailBitmaps(plan.mediaFileId);
      affectedCount = 1;
    } else if (action.service === 'timelineWaveformPyramidCache' && action.type === 'evict-memory') {
      affectedCount = deps.evictWaveformRefs(refIdsFromAction(action));
    } else if (action.service === 'timelineSpectrogramCache' && action.type === 'evict-memory') {
      affectedCount = deps.evictSpectrogramRefs(refIdsFromAction(action));
    } else if (action.service === 'timelineLoudnessEnvelopeCache' && action.type === 'evict-memory') {
      affectedCount = deps.evictLoudnessRefs(refIdsFromAction(action));
    } else if (action.service === 'timelineBeatOnsetCache' && action.type === 'evict-memory') {
      affectedCount = deps.evictBeatOnsetRefs(refIdsFromAction(action));
    } else if (action.service === 'timelineFrequencyPhaseCache' && action.type === 'evict-memory') {
      affectedCount = deps.evictFrequencyPhaseRefs(refIdsFromAction(action));
    } else if (action.service === 'clipAudioAnalysisJobService' && action.type === 'cancel-analysis-jobs') {
      affectedCount = clipIdsFromAction(action)
        .reduce((total, clipId) => total + deps.cancelClipAnalysisJobs(clipId), 0);
    }

    actions.push({
      service: action.service,
      type: action.type,
      affectedCount,
    });
  }

  return { plan, actions };
}

export function invalidateTimelineMediaCaches(
  input: TimelineCacheInvalidationInput,
  deps?: TimelineCacheInvalidationDeps,
): Promise<TimelineCacheInvalidationExecutionResult> {
  return executeTimelineCacheInvalidationPlan(
    createMediaCacheInvalidationPlan(input),
    deps,
  );
}
