import type { ClipAudioState, ClipAudioStemState } from '../../types';
import { DEFAULT_STEM_MODEL_ID, STEM_SOURCE_LAYER_ID } from '../../services/audio/stemSeparation';
import { isAudioCapableTimelineClip, resolveAudibleAudioClip } from '../../services/audio/audioClipResolution';
import { Logger } from '../../services/logger';
import { captureSnapshot } from '../historyStore';
import type {
  ClipStemSeparationJobPhase,
  ClipStemSeparationProgressUpdate,
  ClipStemSeparationRunner,
  SliceCreator,
  StemSeparationActions,
  TimelineClip,
  TimelineTrack,
} from './types';
import { generateClipId } from './helpers/idGenerator';

const log = Logger.create('TimelineStemSeparation');

const ACTIVE_STEM_JOB_PHASES = new Set<ClipStemSeparationJobPhase>([
  'queued',
  'preparing',
  'downloading-model',
  'loading-model',
  'separating',
  'storing',
]);

let stemSeparationRunner: ClipStemSeparationRunner | null = null;
const stemJobControllers = new Map<string, { jobId: string; controller: AbortController }>();

export function setClipStemSeparationRunner(runner: ClipStemSeparationRunner | null): void {
  stemSeparationRunner = runner;
}

function isTrackLocked(tracks: readonly TimelineTrack[], trackId: string | undefined): boolean {
  return !!trackId && tracks.find(track => track.id === trackId)?.locked === true;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampStemGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-60, Math.min(24, value));
}

function hasActiveStemJob(phase: ClipStemSeparationJobPhase | undefined): boolean {
  return !!phase && ACTIVE_STEM_JOB_PHASES.has(phase);
}

function compactAudioState(audioState: ClipAudioState): ClipAudioState | undefined {
  return Object.values(audioState).some(value => value !== undefined)
    ? audioState
    : undefined;
}

function applyStemStateToClip(
  clip: TimelineClip,
  stemSeparation: ClipAudioStemState | undefined,
): TimelineClip {
  const audioState: ClipAudioState = { ...(clip.audioState ?? {}) };
  if (stemSeparation) {
    audioState.stemSeparation = stemSeparation;
  } else {
    delete audioState.stemSeparation;
  }
  delete audioState.processedAnalysisRefs;

  return {
    ...clip,
    audioState: compactAudioState(audioState),
  };
}

function getClipStemShareMediaFileId(clip: TimelineClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

function getClipStemShareFileKey(clip: TimelineClip): string | null {
  const file = clip.file ?? clip.source?.file;
  if (!(file instanceof File)) return null;
  return [
    file.name,
    file.type,
    file.size,
    file.lastModified,
  ].join(':');
}

function clipsShareStemSource(sourceClip: TimelineClip, candidate: TimelineClip): boolean {
  if (!isAudioCapableTimelineClip(candidate)) return false;

  const sourceMediaFileId = getClipStemShareMediaFileId(sourceClip);
  const candidateMediaFileId = getClipStemShareMediaFileId(candidate);
  if (sourceMediaFileId && candidateMediaFileId) {
    return sourceMediaFileId === candidateMediaFileId;
  }

  const sourceFileKey = getClipStemShareFileKey(sourceClip);
  const candidateFileKey = getClipStemShareFileKey(candidate);
  return Boolean(sourceFileKey && candidateFileKey && sourceFileKey === candidateFileKey);
}

function cloneStemSeparationState(stemSeparation: ClipAudioStemState): ClipAudioStemState {
  return structuredClone(stemSeparation);
}

function createSharedStemAvailabilityState(
  stemSeparation: ClipAudioStemState,
  existing: ClipAudioStemState | undefined,
): ClipAudioStemState {
  const shared = cloneStemSeparationState(stemSeparation);

  if (!existing || existing.sourceFingerprint !== stemSeparation.sourceFingerprint) {
    return {
      ...shared,
      mixMode: 'original',
      soloStemId: STEM_SOURCE_LAYER_ID,
      sourceGainDb: 0,
    };
  }

  const existingStemByKind = new Map(existing.stems.map(stem => [stem.kind, stem]));
  const existingSoloKind = existing.soloStemId === STEM_SOURCE_LAYER_ID
    ? null
    : existing.stems.find(stem => stem.id === existing.soloStemId)?.kind;
  const nextSoloStem = existingSoloKind
    ? shared.stems.find(stem => stem.kind === existingSoloKind)
    : null;

  return {
    ...shared,
    mixMode: existing.mixMode,
    soloStemId: existing.soloStemId === STEM_SOURCE_LAYER_ID
      ? STEM_SOURCE_LAYER_ID
      : nextSoloStem?.id,
    sourceGainDb: existing.sourceGainDb ?? 0,
    stems: shared.stems.map(stem => {
      const existingStem = existingStemByKind.get(stem.kind);
      return existingStem
        ? {
            ...stem,
            enabled: existingStem.enabled,
            gainDb: existingStem.gainDb,
          }
        : stem;
    }),
  };
}

function applyStemStateToSourceCopies(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  sourceClipId: string,
  stemSeparation: ClipAudioStemState,
): { clips: TimelineClip[]; changedCount: number } {
  const sourceClip = clips.find(clip => clip.id === sourceClipId);
  if (!sourceClip) return { clips: [...clips], changedCount: 0 };

  let changedCount = 0;
  const nextClips = clips.map((clip) => {
    if (!clipsShareStemSource(sourceClip, clip)) return clip;
    if (clip.id !== sourceClipId && isTrackLocked(tracks, clip.trackId)) return clip;

    changedCount += 1;
    const nextStemState = clip.id === sourceClipId
      ? cloneStemSeparationState(stemSeparation)
      : createSharedStemAvailabilityState(stemSeparation, clip.audioState?.stemSeparation);
    return applyStemStateToClip(clip, nextStemState);
  });

  return { clips: nextClips, changedCount };
}

function updateStemJob(
  set: Parameters<SliceCreator<StemSeparationActions>>[0],
  get: Parameters<SliceCreator<StemSeparationActions>>[1],
  clipId: string,
  jobId: string,
  update: ClipStemSeparationProgressUpdate,
): void {
  set((state) => {
    const current = state.clipStemSeparationJobs[clipId];
    if (!current || current.jobId !== jobId) return {};

    return {
      clipStemSeparationJobs: {
        ...state.clipStemSeparationJobs,
        [clipId]: {
          ...current,
          ...update,
          progress: update.progress === undefined ? current.progress : clampProgress(update.progress),
          updatedAt: Date.now(),
        },
      },
    };
  });

  const current = get().clipStemSeparationJobs[clipId];
  if (current?.jobId === jobId && !hasActiveStemJob(current.phase)) {
    stemJobControllers.delete(clipId);
  }
}

function cancelStemJob(
  set: Parameters<SliceCreator<StemSeparationActions>>[0],
  get: Parameters<SliceCreator<StemSeparationActions>>[1],
  clipId: string,
  message = 'Stem separation cancelled.',
): void {
  const job = get().clipStemSeparationJobs[clipId];
  if (!job || !hasActiveStemJob(job.phase)) return;

  const controllerEntry = stemJobControllers.get(clipId);
  if (controllerEntry?.jobId === job.jobId) {
    controllerEntry.controller.abort(new DOMException(message, 'AbortError'));
  }
  updateStemJob(set, get, clipId, job.jobId, {
    phase: 'cancelled',
    message,
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function patchResolvedClipStemState(
  set: Parameters<SliceCreator<StemSeparationActions>>[0],
  get: Parameters<SliceCreator<StemSeparationActions>>[1],
  clipId: string,
  historyLabel: string,
  updater: (stemSeparation: ClipAudioStemState) => ClipAudioStemState,
  options: { skipHistoryWhilePlaying?: boolean } = {},
): void {
  const { clips, tracks } = get();
  const resolved = resolveAudibleAudioClip(clips, clipId);
  if (!resolved) return;

  const { audioClip } = resolved;
  const currentStemState = audioClip.audioState?.stemSeparation;
  if (!currentStemState) return;

  if (isTrackLocked(tracks, audioClip.trackId)) {
    log.warn('Cannot update clip stem state on locked track', { clipId, audioClipId: audioClip.id });
    return;
  }

  const nextStemState = updater(currentStemState);
  if (nextStemState === currentStemState) return;

  if (!(options.skipHistoryWhilePlaying && get().isPlaying)) {
    captureSnapshot(historyLabel);
  }
  set({
    clips: clips.map(clip =>
      clip.id === audioClip.id ? applyStemStateToClip(clip, nextStemState) : clip
    ),
  });
}

function updateStemLayer(
  stemSeparation: ClipAudioStemState,
  stemId: string,
  updater: (stem: ClipAudioStemState['stems'][number]) => ClipAudioStemState['stems'][number],
): ClipAudioStemState {
  let changed = false;
  const stems = stemSeparation.stems.map(stem => {
    if (stem.id !== stemId) return stem;
    const nextStem = updater(stem);
    if (nextStem !== stem) changed = true;
    return nextStem;
  });

  return changed ? { ...stemSeparation, stems } : stemSeparation;
}

function prepareStemLayerEditState(stemSeparation: ClipAudioStemState): ClipAudioStemState {
  const nextStemSeparation = {
    ...stemSeparation,
    mixMode: stemSeparation.mixMode === 'original' ? 'stems' as const : stemSeparation.mixMode,
  };
  if (nextStemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
    delete nextStemSeparation.soloStemId;
  }
  return nextStemSeparation;
}

async function runStemSeparationJob(
  set: Parameters<SliceCreator<StemSeparationActions>>[0],
  get: Parameters<SliceCreator<StemSeparationActions>>[1],
  jobId: string,
  audioClipId: string,
  requestedClipId: string,
  controller: AbortController,
  options: Parameters<StemSeparationActions['startClipStemSeparation']>[1],
): Promise<void> {
  const runner = stemSeparationRunner;
  if (!runner) {
    updateStemJob(set, get, audioClipId, jobId, {
      phase: 'failed',
      error: 'Stem separation service is not available.',
      message: 'Stem separation service is not available.',
    });
    return;
  }

  try {
    const state = get();
    const audioClip = state.clips.find(clip => clip.id === audioClipId);
    const requestedClip = state.clips.find(clip => clip.id === requestedClipId) ?? audioClip;
    if (!audioClip || !requestedClip) {
      const message = 'Clip is no longer available.';
      updateStemJob(set, get, audioClipId, jobId, {
        phase: 'failed',
        error: message,
        message,
      });
      return;
    }

    updateStemJob(set, get, audioClipId, jobId, { phase: 'preparing', progress: 0 });
    const stemSeparation = await runner({
      jobId,
      clip: audioClip,
      requestedClip,
      options: options ?? {},
      signal: controller.signal,
      updateProgress: (update) => updateStemJob(set, get, audioClipId, jobId, update),
    });

    const currentJob = get().clipStemSeparationJobs[audioClipId];
    if (!currentJob || currentJob.jobId !== jobId || currentJob.phase === 'cancelled') {
      return;
    }
    if (controller.signal.aborted) {
      updateStemJob(set, get, audioClipId, jobId, { phase: 'cancelled' });
      return;
    }
    if (!stemSeparation) {
      const message = 'Stem separation produced no stem layers.';
      updateStemJob(set, get, audioClipId, jobId, {
        phase: 'failed',
        error: message,
        message,
      });
      return;
    }

    const { clips, tracks } = get();
    if (isTrackLocked(tracks, audioClip.trackId)) {
      const message = 'Cannot commit stem separation on a locked track.';
      updateStemJob(set, get, audioClipId, jobId, {
        phase: 'failed',
        error: message,
        message,
      });
      return;
    }

    captureSnapshot('Separate stems');
    const applied = applyStemStateToSourceCopies(clips, tracks, audioClipId, stemSeparation);
    set({ clips: applied.clips });
    get().invalidateCache();
    if (applied.changedCount > 1) {
      log.info('Shared stem separation with source copies', {
        audioClipId,
        copyCount: applied.changedCount - 1,
      });
    }
    updateStemJob(set, get, audioClipId, jobId, {
      phase: 'complete',
      progress: 1,
      message: 'Stem separation complete.',
    });
  } catch (error) {
    if (isAbortError(error, controller.signal)) {
      updateStemJob(set, get, audioClipId, jobId, {
        phase: 'cancelled',
        message: 'Stem separation cancelled.',
      });
      return;
    }

    const message = getErrorMessage(error);
    updateStemJob(set, get, audioClipId, jobId, {
      phase: 'failed',
      error: message,
      message,
    });
  } finally {
    const currentEntry = stemJobControllers.get(audioClipId);
    if (currentEntry?.jobId === jobId) {
      stemJobControllers.delete(audioClipId);
    }
  }
}

export const createStemSeparationSlice: SliceCreator<StemSeparationActions> = (set, get) => ({
  startClipStemSeparation: async (clipId, options = {}) => {
    const { clips, tracks, clipStemSeparationJobs } = get();
    const resolved = resolveAudibleAudioClip(clips, clipId);
    if (!resolved) {
      log.warn('Cannot start stem separation for non-audio clip', { clipId });
      return null;
    }

    const { requestedClip, audioClip } = resolved;
    if (isTrackLocked(tracks, audioClip.trackId)) {
      log.warn('Cannot start stem separation on locked track', { clipId, audioClipId: audioClip.id });
      return null;
    }

    const existingJob = clipStemSeparationJobs[audioClip.id];
    if (hasActiveStemJob(existingJob?.phase)) {
      if (options.force !== true) return existingJob?.jobId ?? null;
      cancelStemJob(set, get, audioClip.id, 'Stem separation restarted.');
    }

    if (audioClip.audioState?.stemSeparation && options.force !== true) {
      return null;
    }

    const jobId = generateClipId('stem-job');
    const now = Date.now();
    const modelId = options.modelId ?? DEFAULT_STEM_MODEL_ID;
    const controller = new AbortController();
    stemJobControllers.set(audioClip.id, { jobId, controller });

    set((state) => {
      const expandedClipStemLayerIds = new Set(state.expandedClipStemLayerIds);
      expandedClipStemLayerIds.add(audioClip.id);

      return {
        clipStemSeparationJobs: {
          ...state.clipStemSeparationJobs,
          [audioClip.id]: {
            jobId,
            clipId: audioClip.id,
            requestedClipId: requestedClip.id,
            modelId,
            phase: 'queued',
            progress: 0,
            startedAt: now,
            updatedAt: now,
          },
        },
        expandedClipStemLayerIds,
      };
    });

    void runStemSeparationJob(set, get, jobId, audioClip.id, requestedClip.id, controller, {
      ...options,
      modelId,
    });
    return jobId;
  },

  cancelClipStemSeparation: (clipId) => {
    const resolved = resolveAudibleAudioClip(get().clips, clipId);
    if (!resolved) return;
    cancelStemJob(set, get, resolved.audioClip.id);
  },

  setClipStemMixMode: (clipId, mixMode) => {
    patchResolvedClipStemState(set, get, clipId, mixMode === 'original' ? 'Use source audio' : 'Use stem mix', (stemSeparation) => {
      if (stemSeparation.mixMode === mixMode && (
        mixMode !== 'original' || stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID
      )) {
        return stemSeparation;
      }
      const nextStemSeparation = { ...stemSeparation, mixMode };
      if (mixMode === 'original') {
        nextStemSeparation.soloStemId = STEM_SOURCE_LAYER_ID;
      } else if (nextStemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
        delete nextStemSeparation.soloStemId;
      }
      return nextStemSeparation;
    }, { skipHistoryWhilePlaying: true });
  },

  setClipStemSourceGain: (clipId, gainDb) => {
    const nextGainDb = clampStemGainDb(gainDb);
    patchResolvedClipStemState(
      set,
      get,
      clipId,
      'Set source gain',
      (stemSeparation) =>
        stemSeparation.sourceGainDb === nextGainDb
          ? stemSeparation
          : { ...stemSeparation, sourceGainDb: nextGainDb },
      { skipHistoryWhilePlaying: true }
    );
  },

  setClipStemSolo: (clipId, stemId) => {
    patchResolvedClipStemState(set, get, clipId, stemId ? 'Solo stem' : 'Clear stem solo', (stemSeparation) => {
      if (stemId === STEM_SOURCE_LAYER_ID) {
        if (stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
          const nextStemSeparation = { ...stemSeparation, mixMode: 'hybrid' as const };
          delete nextStemSeparation.soloStemId;
          return nextStemSeparation;
        }
        return {
          ...stemSeparation,
          soloStemId: STEM_SOURCE_LAYER_ID,
          mixMode: 'original',
        };
      }

      if (stemId && !stemSeparation.stems.some(stem => stem.id === stemId)) {
        return stemSeparation;
      }

      const nextSoloStemId = stemId ?? undefined;
      if (stemSeparation.soloStemId === nextSoloStemId && stemSeparation.mixMode === 'stems') return stemSeparation;

      const nextStemSeparation = { ...stemSeparation };
      if (nextSoloStemId) {
        nextStemSeparation.soloStemId = nextSoloStemId;
      } else {
        delete nextStemSeparation.soloStemId;
      }
      nextStemSeparation.mixMode = 'stems';
      return nextStemSeparation;
    }, { skipHistoryWhilePlaying: true });
  },

  setClipStemEnabled: (clipId, stemId, enabled) => {
    patchResolvedClipStemState(
      set,
      get,
      clipId,
      enabled ? 'Enable stem' : 'Disable stem',
      (stemSeparation) =>
        updateStemLayer(prepareStemLayerEditState(stemSeparation), stemId, stem =>
          stem.enabled === enabled ? stem : { ...stem, enabled }
        ),
      { skipHistoryWhilePlaying: true }
    );
  },

  setClipStemGain: (clipId, stemId, gainDb) => {
    const nextGainDb = clampStemGainDb(gainDb);
    patchResolvedClipStemState(
      set,
      get,
      clipId,
      'Set stem gain',
      (stemSeparation) =>
        updateStemLayer(prepareStemLayerEditState(stemSeparation), stemId, stem =>
          stem.gainDb === nextGainDb ? stem : { ...stem, gainDb: nextGainDb }
        ),
      { skipHistoryWhilePlaying: true }
    );
  },

  syncClipStemSeparationCopies: (clipId) => {
    const { clips, tracks } = get();
    const resolved = resolveAudibleAudioClip(clips, clipId);
    const audioClip = resolved?.audioClip;
    const stemSeparation = audioClip?.audioState?.stemSeparation;
    if (!audioClip || !stemSeparation) return 0;

    const applied = applyStemStateToSourceCopies(clips, tracks, audioClip.id, stemSeparation);
    const copyCount = Math.max(0, applied.changedCount - 1);
    if (copyCount === 0) return 0;

    captureSnapshot('Share stems with copies');
    set({ clips: applied.clips });
    get().invalidateCache();
    return copyCount;
  },

  clearClipStemSeparation: (clipId) => {
    const { clips, tracks } = get();
    const resolved = resolveAudibleAudioClip(clips, clipId);
    if (!resolved) return;

    const { audioClip } = resolved;
    if (!audioClip.audioState?.stemSeparation) return;
    if (isTrackLocked(tracks, audioClip.trackId)) {
      log.warn('Cannot clear clip stem separation on locked track', { clipId, audioClipId: audioClip.id });
      return;
    }

    cancelStemJob(set, get, audioClip.id, 'Stem separation cleared.');
    captureSnapshot('Clear stems');
    set((state) => {
      const expandedClipStemLayerIds = new Set(state.expandedClipStemLayerIds);
      expandedClipStemLayerIds.delete(audioClip.id);
      return {
        clips: state.clips.map(clip =>
          clip.id === audioClip.id ? applyStemStateToClip(clip, undefined) : clip
        ),
        expandedClipStemLayerIds,
      };
    });
    get().invalidateCache();
  },

  toggleClipStemLayerDropdown: (clipId) => {
    const resolved = resolveAudibleAudioClip(get().clips, clipId);
    const targetClipId = resolved?.audioClip.id ?? clipId;
    const expandedClipStemLayerIds = new Set(get().expandedClipStemLayerIds);
    if (expandedClipStemLayerIds.has(targetClipId)) {
      expandedClipStemLayerIds.delete(targetClipId);
    } else {
      expandedClipStemLayerIds.add(targetClipId);
    }
    set({ expandedClipStemLayerIds });
  },

  setClipStemLayerDropdownOpen: (clipId, open) => {
    const resolved = resolveAudibleAudioClip(get().clips, clipId);
    const targetClipId = resolved?.audioClip.id ?? clipId;
    const expandedClipStemLayerIds = new Set(get().expandedClipStemLayerIds);
    if (open) {
      expandedClipStemLayerIds.add(targetClipId);
    } else {
      expandedClipStemLayerIds.delete(targetClipId);
    }
    set({ expandedClipStemLayerIds });
  },
});
