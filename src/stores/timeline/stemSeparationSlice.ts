import type { AudioStemKind, ClipAudioStemState, MediaFileAudioAnalysisRefs, TimelineClip } from '../../types';
import { DEFAULT_STEM_MODEL_ID, STEM_SOURCE_LAYER_ID } from '../../services/audio/stemSeparation';
import { resolveAudibleAudioClip } from '../../services/audio/audioClipResolution';
import { Logger } from '../../services/logger';
import { audioRoutingManager } from '../../services/audioRoutingManager';
import { clearMasterAudio, playheadState } from '../../services/layerBuilder/PlayheadState';
import { captureSnapshot } from '../historyStore';
import { useMediaStore, type MediaFile, type MediaFolder } from '../mediaStore';
import {
  applyStemStateToClip,
  applyStemStateToSourceCopies,
} from './helpers/stemSharingHelpers';
import { isActiveStemJobPhase } from './helpers/stemSeparationJobPhases';
import { createAudioElement } from './helpers/webCodecsHelpers';
import type {
  ClipStemSeparationJobPhase,
  ClipStemSeparationJobStemChoice,
  ClipStemSeparationProgressUpdate,
  ClipStemSeparationRunner,
  SliceCreator,
  StemSeparationActions,
  TimelineTrack,
} from './types';
import { generateClipId } from './helpers/idGenerator';

const log = Logger.create('TimelineStemSeparation');

const STEM_JOB_PROGRESS_UPDATE_MIN_INTERVAL_MS = 250;
const STEM_JOB_PROGRESS_UPDATE_MIN_DELTA = 0.01;
const STEM_RELINK_JOB_ID_PREFIX = 'stem-relink';
const STEM_MEDIA_ROOT_FOLDER_NAME = 'Stems';
const STEM_KIND_ORDER: AudioStemKind[] = ['vocals', 'dialogue', 'drums', 'bass', 'instrumental', 'music', 'sfx', 'other', 'mix'];
const STEM_LABEL_TO_KIND = new Map<string, AudioStemKind>([
  ['mix', 'mix'],
  ['vocals', 'vocals'],
  ['voice', 'vocals'],
  ['dialogue', 'dialogue'],
  ['dialog', 'dialogue'],
  ['drums', 'drums'],
  ['bass', 'bass'],
  ['other', 'other'],
  ['instrumental', 'instrumental'],
  ['music', 'music'],
  ['sfx', 'sfx'],
  ['sound effects', 'sfx'],
]);

let stemSeparationRunner: ClipStemSeparationRunner | null = null;
const stemJobControllers = new Map<string, { jobId: string; controller: AbortController }>();
const stemSourceAudioElementCache = new Map<string, { file: File; element: HTMLAudioElement }>();

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
  return isActiveStemJobPhase(phase);
}

function createStemChoices(stemSeparation: ClipAudioStemState): ClipStemSeparationJobStemChoice[] {
  return stemSeparation.stems
    .filter((stem): stem is typeof stem & { mediaFileId: string } => typeof stem.mediaFileId === 'string' && stem.mediaFileId.length > 0)
    .map(stem => ({
      id: stem.id,
      kind: stem.kind,
      label: stem.label,
      mediaFileId: stem.mediaFileId,
    }));
}

function getOrCreateStemSourceAudioElement(mediaFile: MediaFile): HTMLAudioElement | null {
  if (!mediaFile.file) return null;

  const cached = stemSourceAudioElementCache.get(mediaFile.id);
  if (cached?.file === mediaFile.file) {
    return cached.element;
  }

  if (cached) {
    disposeReplacedAudioElement(cached.element);
  }

  const element = createAudioElement(mediaFile.file);
  stemSourceAudioElementCache.set(mediaFile.id, { file: mediaFile.file, element });
  return element;
}

function prewarmStemSourceAudioElement(mediaFile: MediaFile): boolean {
  const element = getOrCreateStemSourceAudioElement(mediaFile);
  if (!element) return false;

  try {
    if (element.paused && element.readyState < 2) {
      element.load();
    }
  } catch {
    // A cold element can still be started by the normal sync pass on selection.
  }
  return true;
}

function stemKindSortIndex(kind: AudioStemKind): number {
  const index = STEM_KIND_ORDER.indexOf(kind);
  return index === -1 ? STEM_KIND_ORDER.length : index;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function sanitizeStemPathPart(value: string, fallback: string): string {
  const sanitized = Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized.slice(0, 120) : fallback;
}

function stripFileExtension(value: string): string {
  const lastDot = value.lastIndexOf('.');
  return lastDot > 0 ? value.slice(0, lastDot) : value;
}

function stemFolderNameCandidates(clip: TimelineClip, mediaFile: MediaFile | undefined): Set<string> {
  const candidates = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    candidates.add(sanitizeStemPathPart(stripFileExtension(value), 'Source Clip').toLowerCase());
  };
  add(mediaFile?.name);
  add(mediaFile?.file?.name);
  add(clip.name);
  add(clip.file?.name);
  return candidates;
}

function getFolderPathParts(folderId: string | null | undefined, foldersById: Map<string, MediaFolder>): string[] {
  const parts: string[] = [];
  let currentId = folderId ?? null;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parentId;
  }
  return parts;
}

function inferLegacyStemChoice(
  stemFile: MediaFile,
  sourceClip: TimelineClip,
  sourceMediaFile: MediaFile | undefined,
  foldersById: Map<string, MediaFolder>,
): ClipStemSeparationJobStemChoice | null {
  if (stemFile.type !== 'audio') return null;
  const pathParts = getFolderPathParts(stemFile.parentId, foldersById);
  const sourceFolderName = pathParts.at(-1);
  const rootFolderName = pathParts.at(-2);
  const projectPath = stemFile.projectPath ?? stemFile.filePath ?? '';
  if (rootFolderName !== STEM_MEDIA_ROOT_FOLDER_NAME && !projectPath.replace(/\\/g, '/').startsWith(`${STEM_MEDIA_ROOT_FOLDER_NAME}/`)) {
    return null;
  }

  const folderCandidates = stemFolderNameCandidates(sourceClip, sourceMediaFile);
  const normalizedSourceFolder = sourceFolderName?.toLowerCase();
  if (!normalizedSourceFolder || !folderCandidates.has(normalizedSourceFolder)) {
    return null;
  }

  const stemBaseName = stripFileExtension(stemFile.name);
  const folderPrefix = `${sourceFolderName} - `;
  if (!stemBaseName.toLowerCase().startsWith(folderPrefix.toLowerCase())) {
    return null;
  }

  const label = stemBaseName.slice(folderPrefix.length).trim();
  const kind = STEM_LABEL_TO_KIND.get(label.toLowerCase());
  if (!kind) return null;

  return {
    id: `${stemFile.id}:${kind}`,
    kind,
    label,
    mediaFileId: stemFile.id,
  };
}

function collectRelinkedStemChoicesForClip(
  sourceClip: TimelineClip,
  mediaFiles: readonly MediaFile[],
  folders: readonly MediaFolder[],
): { sourceMediaFileId: string; choices: ClipStemSeparationJobStemChoice[] } | null {
  const currentMediaFileId = getClipMediaFileId(sourceClip);
  if (!currentMediaFileId) return null;

  const mediaFilesById = new Map(mediaFiles.map(file => [file.id, file]));
  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
  const currentMediaFile = mediaFilesById.get(currentMediaFileId);
  const sourceMediaFileId = currentMediaFile?.stemInfo?.sourceMediaFileId ?? currentMediaFileId;
  const sourceMediaFile = mediaFilesById.get(sourceMediaFileId);
  const choicesByMediaFileId = new Map<string, ClipStemSeparationJobStemChoice>();

  for (const file of mediaFiles) {
    const directInfo = file.stemInfo?.sourceMediaFileId === sourceMediaFileId
      ? file.stemInfo
      : undefined;
    const choice = directInfo
      ? {
          id: `${file.id}:${directInfo.kind}`,
          kind: directInfo.kind,
          label: directInfo.label,
          mediaFileId: file.id,
        }
      : inferLegacyStemChoice(file, sourceClip, sourceMediaFile, foldersById);
    if (!choice) continue;
    choicesByMediaFileId.set(choice.mediaFileId, choice);
  }

  const choices = Array.from(choicesByMediaFileId.values())
    .toSorted((a, b) => stemKindSortIndex(a.kind) - stemKindSortIndex(b.kind) || a.label.localeCompare(b.label));
  return choices.length > 0 ? { sourceMediaFileId, choices } : null;
}

function createStemAudioState(
  clip: TimelineClip,
  stemMediaFileId: string,
  sourceAnalysisRefs: MediaFileAudioAnalysisRefs | undefined,
): TimelineClip['audioState'] {
  const {
    stemSeparation: _stemSeparation,
    processedAnalysisRefs: _processedAnalysisRefs,
    ...restAudioState
  } = clip.audioState ?? {};

  return {
    ...restAudioState,
    sourceAudioRevisionId: stemMediaFileId,
    sourceAnalysisRefs,
  };
}

function getClipSourceTimeAtPlayhead(clip: TimelineClip, playheadPosition: number): number {
  const speed = Math.max(0.001, Math.abs(clip.speed ?? 1));
  const localTime = Math.max(0, Math.min(clip.duration, playheadPosition - clip.startTime));
  if (clip.reversed || (clip.speed ?? 1) < 0) {
    return Math.max(0, clip.outPoint - localTime * speed);
  }
  return Math.max(0, clip.inPoint + localTime * speed);
}

function disposeReplacedAudioElement(element: HTMLAudioElement | HTMLVideoElement | undefined): void {
  if (!element) return;
  try {
    element.pause();
  } catch {
    // Ignore media element teardown errors.
  }
  audioRoutingManager.disposeRoute(element);
  if (playheadState.masterAudioElement === element) {
    clearMasterAudio();
  }
}

function primeStemAudioElementForLivePlayback(
  element: HTMLAudioElement,
  clip: TimelineClip,
  playheadPosition: number,
  isPlaying: boolean,
): void {
  if (!isPlaying) return;
  try {
    element.currentTime = getClipSourceTimeAtPlayhead(clip, playheadPosition);
    element.playbackRate = Math.max(0.25, Math.min(4, Math.abs(clip.speed ?? 1)));
    void element.play().catch(() => {
      // The regular audio sync pass will retry once the element can play.
    });
  } catch {
    // The regular audio sync pass can recover on the next frame.
  }
  playheadState.playbackJustStarted = true;
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
    const nextProgress = update.progress === undefined ? current.progress : clampProgress(update.progress);
    const nextPhase = update.phase ?? current.phase;
    const now = Date.now();
    const phaseChanged = update.phase !== undefined && update.phase !== current.phase;
    const backendChanged = update.backend !== undefined && update.backend !== current.backend;
    const errorChanged = update.error !== undefined && update.error !== current.error;
    const terminalUpdate = update.phase !== undefined && !hasActiveStemJob(nextPhase);
    const progressDelta = Math.abs(nextProgress - current.progress);
    const percentChanged = Math.round(nextProgress * 100) !== Math.round(current.progress * 100);
    const canThrottle = !phaseChanged && !backendChanged && !errorChanged && !terminalUpdate;

    if (
      canThrottle &&
      now - current.updatedAt < STEM_JOB_PROGRESS_UPDATE_MIN_INTERVAL_MS &&
      progressDelta < STEM_JOB_PROGRESS_UPDATE_MIN_DELTA &&
      !percentChanged
    ) {
      return {};
    }

    return {
      clipStemSeparationJobs: {
        ...state.clipStemSeparationJobs,
        [clipId]: {
          ...current,
          ...update,
          progress: nextProgress,
          updatedAt: now,
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

    const stems = createStemChoices(stemSeparation);
    log.info('Stem separation complete; generated stem files are kept detached from timeline clip state', {
      audioClipId,
      requestedClipId,
      stemCount: stems.length,
    });
    updateStemJob(set, get, audioClipId, jobId, {
      phase: 'complete',
      progress: 1,
      sourceMediaFileId: getClipMediaFileId(audioClip),
      stems,
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

    set((state) => ({
      clipStemSeparationJobs: {
        ...state.clipStemSeparationJobs,
        [audioClip.id]: {
          jobId,
          clipId: audioClip.id,
          requestedClipId: requestedClip.id,
          sourceMediaFileId: getClipMediaFileId(audioClip),
          modelId,
          phase: 'queued',
          progress: 0,
          startedAt: now,
          updatedAt: now,
        },
      },
    }));

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

  prewarmStemSourceMediaFiles: (stemMediaFileIds) => {
    if (stemMediaFileIds.length === 0) return 0;

    const uniqueMediaFileIds = new Set(stemMediaFileIds);
    const mediaFilesById = new Map(useMediaStore.getState().files.map(file => [file.id, file]));
    let warmedCount = 0;

    for (const stemMediaFileId of uniqueMediaFileIds) {
      const mediaFile = mediaFilesById.get(stemMediaFileId);
      if (!mediaFile || mediaFile.type !== 'audio' || !mediaFile.file) continue;
      if (prewarmStemSourceAudioElement(mediaFile)) {
        warmedCount++;
      }
    }

    return warmedCount;
  },

  setClipSourceToStem: (clipId, stemMediaFileId) => {
    const { clips, tracks } = get();
    const resolved = resolveAudibleAudioClip(clips, clipId);
    if (!resolved) {
      log.warn('Cannot use stem source for non-audio clip', { clipId, stemMediaFileId });
      return false;
    }

    const { audioClip } = resolved;
    if (isTrackLocked(tracks, audioClip.trackId)) {
      log.warn('Cannot use stem source on locked track', { clipId, audioClipId: audioClip.id, stemMediaFileId });
      return false;
    }

    const mediaFile = useMediaStore.getState().files.find(file => file.id === stemMediaFileId);
    if (!mediaFile || mediaFile.type !== 'audio' || !mediaFile.file) {
      log.warn('Cannot use missing stem media file as clip source', {
        clipId,
        audioClipId: audioClip.id,
        stemMediaFileId,
        mediaType: mediaFile?.type,
        hasFile: !!mediaFile?.file,
      });
      return false;
    }

    const isLivePlaybackSwitch = get().isPlaying && !get().isDraggingPlayhead;
    const sourceFile = mediaFile.file;
    const playheadPosition = playheadState.isUsingInternalPosition
      ? playheadState.position
      : get().playheadPosition;
    const oldAudioElement = audioClip.source?.audioElement;
    const naturalDuration = mediaFile.duration ?? audioClip.source?.naturalDuration ?? audioClip.outPoint ?? audioClip.duration;
    const audioElement = getOrCreateStemSourceAudioElement(mediaFile) ?? createAudioElement(sourceFile);
    const sourcePath = mediaFile.absolutePath ?? mediaFile.filePath ?? mediaFile.projectPath;
    primeStemAudioElementForLivePlayback(audioElement, audioClip, playheadPosition, isLivePlaybackSwitch);
    if (oldAudioElement !== audioElement) {
      disposeReplacedAudioElement(oldAudioElement);
    }

    if (!isLivePlaybackSwitch) {
      captureSnapshot('Use stem source');
    }
    set((state) => ({
      clips: state.clips.map(currentClip => {
        if (currentClip.id !== audioClip.id) return currentClip;

        return {
          ...currentClip,
          file: sourceFile,
          mediaFileId: mediaFile.id,
          waveform: mediaFile.waveform ?? [],
          waveformChannels: mediaFile.waveformChannels,
          waveformGenerating: mediaFile.waveformStatus === 'generating',
          waveformProgress: mediaFile.waveformProgress ?? (mediaFile.waveform ? 100 : 0),
          needsReload: false,
          source: {
            ...(currentClip.source ?? { type: 'audio' as const }),
            type: 'audio' as const,
            audioElement,
            naturalDuration,
            mediaFileId: mediaFile.id,
            file: sourceFile,
            ...(sourcePath ? { filePath: sourcePath } : {}),
          },
          audioState: createStemAudioState(currentClip, mediaFile.id, mediaFile.audioAnalysisRefs),
        };
      }),
    }));
    get().updateDuration();
    get().invalidateCache();
    return true;
  },

  relinkClipStemSeparationJobsFromMediaLibrary: () => {
    const { clips } = get();
    if (clips.length === 0) return 0;

    const mediaState = useMediaStore.getState();
    const nextJobs: ReturnType<typeof get>['clipStemSeparationJobs'] = {};
    const seenAudioClipIds = new Set<string>();
    const now = Date.now();

    for (const clip of clips) {
      const resolved = resolveAudibleAudioClip(clips, clip.id);
      const audioClip = resolved?.audioClip;
      if (!resolved || !audioClip || seenAudioClipIds.has(audioClip.id)) continue;
      seenAudioClipIds.add(audioClip.id);

      const relinked = collectRelinkedStemChoicesForClip(audioClip, mediaState.files, mediaState.folders);
      if (!relinked) continue;

      const firstStemMediaFile = mediaState.files.find(file => file.id === relinked.choices[0]?.mediaFileId);
      const stemInfo = firstStemMediaFile?.stemInfo;
      nextJobs[audioClip.id] = {
        jobId: `${STEM_RELINK_JOB_ID_PREFIX}:${relinked.sourceMediaFileId}`,
        clipId: audioClip.id,
        requestedClipId: resolved.requestedClip.id,
        sourceMediaFileId: relinked.sourceMediaFileId,
        modelId: stemInfo?.modelId ?? DEFAULT_STEM_MODEL_ID,
        phase: 'complete',
        progress: 1,
        stems: relinked.choices,
        message: 'Stem files linked.',
        startedAt: stemInfo?.createdAt ?? now,
        updatedAt: now,
      };
    }

    const relinkedCount = Object.keys(nextJobs).length;
    if (relinkedCount === 0) return 0;

    set((state) => {
      let changed = false;
      const mergedJobs = { ...state.clipStemSeparationJobs };
      for (const [clipId, job] of Object.entries(nextJobs)) {
        if (hasActiveStemJob(mergedJobs[clipId]?.phase)) continue;
        const current = mergedJobs[clipId];
        const sameChoices = JSON.stringify(current?.stems ?? []) === JSON.stringify(job.stems ?? []);
        if (current?.phase === 'complete' && current.jobId === job.jobId && sameChoices) continue;
        mergedJobs[clipId] = job;
        changed = true;
      }
      return changed ? { clipStemSeparationJobs: mergedJobs } : {};
    });

    return relinkedCount;
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
    set((state) => ({
      clips: state.clips.map(clip =>
        clip.id === audioClip.id ? applyStemStateToClip(clip, undefined) : clip
      ),
    }));
    get().invalidateCache();
  },
});
