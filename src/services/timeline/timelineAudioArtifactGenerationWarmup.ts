import { useTimelineStore } from '../../stores/timeline';
import type { GenerateClipAudioAnalysisOptions } from '../../stores/timeline/types';
import type { Keyframe, TimelineClip } from '../../types';
import { canDeriveProcessedWaveformPyramid } from '../audio/DerivedWaveformPyramidService';
import {
  clipRequiresProcessedWaveformPyramid,
  createProcessedClipAudioStateHash,
} from '../audio/processedWaveformEligibility';
import { Logger } from '../logger';
import {
  clearTimelineWarmupTimers,
  getTimelineWarmupTimerDeps,
} from './timelineWarmupTimers';

type TimerHandle = ReturnType<typeof setTimeout>;

type AudioArtifactGenerationStatus =
  | 'generated'
  | 'ready'
  | 'blocked'
  | 'skipped';

interface TimelineAudioArtifactGenerationState {
  clips: readonly TimelineClip[];
  clipKeyframes: ReadonlyMap<string, Keyframe[]>;
  isPlaying?: boolean;
  clipDragPreview?: unknown;
  generateProcessedWaveformForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateSpectrogramForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateAudioIntelligenceForClip?: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
}

interface TimelineAudioArtifactGenerationDeps {
  getState: () => TimelineAudioArtifactGenerationState;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now?: () => number;
}

interface TimelineAudioArtifactGenerationRequest {
  clipId: string;
  requestKey: string;
}

const DEFAULT_PROCESSED_WAVEFORM_DERIVATION_DELAY_MS = 500;
const DEFAULT_SPECTROGRAM_GENERATION_DELAY_MS = 650;
const DEFAULT_AUDIO_INTELLIGENCE_GENERATION_DELAY_MS = 800;
const AUDIO_INTELLIGENCE_WARMUP_ENABLED = false;

// Attempts for the same clip audio are spaced with growing pauses. A generation that ended without its
// artifact (storage gone, source unreadable) is otherwise restarted by every clip update: one session
// logged the same failing waveform save 1004 times in two hours. The check runs on the next warmup
// call, which reads the clip anyway; a created artifact or an edit to the clip's audio clears it.
const ATTEMPT_PAUSE_BASE_MS = 15_000;
const ATTEMPT_PAUSE_MAX_MS = 10 * 60_000;

interface AudioArtifactGenerationAttempt {
  /** Audio state the last attempt ran for. */
  stateKey: string;
  /** Attempts so far for this audio state. */
  attempts: number;
  /** No new attempt for this audio state before this time. */
  pausedUntilMs: number;
  reported: boolean;
}

const log = Logger.create('TimelineAudioArtifactWarmup');
const scheduledAudioArtifactTimers = new Map<string, TimerHandle>();
const inFlightAudioArtifactGenerations = new Map<string, Promise<AudioArtifactGenerationStatus>>();
const audioArtifactGenerationAttempts = new Map<string, AudioArtifactGenerationAttempt>();

function readNow(deps: TimelineAudioArtifactGenerationDeps): number {
  return deps.now?.() ?? Date.now();
}

/**
 * Called when the artifact is still missing. Returns false while an earlier attempt for the same audio
 * state is pausing (that attempt ended without its artifact); otherwise records this attempt.
 */
function beginPacedAttempt(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
  label: string,
  clip: TimelineClip,
  keyframes: readonly Keyframe[],
): boolean {
  const stateKey = createProcessedClipAudioStateHash(clip, { keyframes });
  const now = readNow(deps);
  const previous = audioArtifactGenerationAttempts.get(request.requestKey);
  const sameState = previous?.stateKey === stateKey;
  if (previous && sameState && now < previous.pausedUntilMs) {
    if (!previous.reported) {
      previous.reported = true;
      log.warn(`${label} was not created; the next attempt waits`, {
        clipId: request.clipId,
        attempts: previous.attempts,
        retryInSeconds: Math.round((previous.pausedUntilMs - now) / 1000),
      });
    }
    return false;
  }
  const attempts = sameState && previous ? previous.attempts + 1 : 1;
  const pauseMs = Math.min(ATTEMPT_PAUSE_MAX_MS, ATTEMPT_PAUSE_BASE_MS * 2 ** (attempts - 1));
  audioArtifactGenerationAttempts.set(request.requestKey, { stateKey, attempts, pausedUntilMs: now + pauseMs, reported: false });
  return true;
}

/** The artifact exists: later losses of it start again without a pause. */
function forgetAttempts(request: TimelineAudioArtifactGenerationRequest): void {
  audioArtifactGenerationAttempts.delete(request.requestKey);
}

function getDefaultDeps(): TimelineAudioArtifactGenerationDeps {
  return {
    getState: () => {
      const state = useTimelineStore.getState();
      return {
        clips: state.clips,
        clipKeyframes: state.clipKeyframes,
        isPlaying: state.isPlaying,
        clipDragPreview: state.clipDragPreview,
        generateProcessedWaveformForClip: state.generateProcessedWaveformForClip,
        generateSpectrogramForClip: state.generateSpectrogramForClip,
        generateAudioIntelligenceForClip: state.generateAudioIntelligenceForClip,
      };
    },
    ...getTimelineWarmupTimerDeps(),
  };
}

function getClipAndKeyframes(
  state: TimelineAudioArtifactGenerationState,
  clipId: string,
): { clip: TimelineClip; keyframes: Keyframe[] } | null {
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  return {
    clip,
    keyframes: state.clipKeyframes.get(clipId) ?? [],
  };
}

async function warmProcessedWaveformDerivation(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
): Promise<AudioArtifactGenerationStatus> {
  const state = deps.getState();
  if (state.isPlaying || state.clipDragPreview) return 'blocked';

  const resolved = getClipAndKeyframes(state, request.clipId);
  if (!resolved) return 'skipped';
  const { clip, keyframes } = resolved;

  if (clip.waveformGenerating) return 'blocked';
  if (clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId) {
    forgetAttempts(request);
    return 'ready';
  }
  if (!clipRequiresProcessedWaveformPyramid(clip, keyframes)) return 'skipped';
  if (!canDeriveProcessedWaveformPyramid(clip, keyframes)) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    if (!beginPacedAttempt(request, deps, 'Processed waveform', clip, keyframes)) return 'blocked';
    generation = state.generateProcessedWaveformForClip(clip.id, { derivedOnly: true })
      .then(() => 'generated' as const)
      .finally(() => {
        inFlightAudioArtifactGenerations.delete(request.requestKey);
      });
    inFlightAudioArtifactGenerations.set(request.requestKey, generation);
  }

  return generation;
}

async function warmSpectrogramTiles(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
): Promise<AudioArtifactGenerationStatus> {
  const state = deps.getState();
  if (state.isPlaying || state.clipDragPreview) return 'blocked';

  const resolved = getClipAndKeyframes(state, request.clipId);
  if (!resolved) return 'skipped';
  const { clip, keyframes } = resolved;

  if (clip.waveformGenerating) return 'blocked';
  const needsProcessedSpectrogram = clipRequiresProcessedWaveformPyramid(clip, keyframes);
  const requiredRef = needsProcessedSpectrogram
    ? clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0]
    : clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
  if (requiredRef) {
    forgetAttempts(request);
    return 'ready';
  }
  if (!clip.isComposition && !clip.file) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    if (!beginPacedAttempt(request, deps, 'Spectrogram', clip, keyframes)) return 'blocked';
    generation = state.generateSpectrogramForClip(clip.id)
      .then(() => 'generated' as const)
      .finally(() => {
        inFlightAudioArtifactGenerations.delete(request.requestKey);
      });
    inFlightAudioArtifactGenerations.set(request.requestKey, generation);
  }

  return generation;
}

async function warmVoiceActivity(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
): Promise<AudioArtifactGenerationStatus> {
  const state = deps.getState();
  if (state.isPlaying || state.clipDragPreview) return 'blocked';
  const resolved = getClipAndKeyframes(state, request.clipId);
  if (!resolved) return 'skipped';
  const { clip, keyframes } = resolved;
  if (clip.waveformGenerating) return 'blocked';
  if (clip.audioState?.sourceAnalysisRefs?.voiceActivityId) {
    forgetAttempts(request);
    return 'ready';
  }
  if (!clip.isComposition && !clip.file) return 'skipped';
  if (!state.generateAudioIntelligenceForClip) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    const vadOnlyOptions = {
      features: new Set(['vad']),
    } as GenerateClipAudioAnalysisOptions;
    if (!beginPacedAttempt(request, deps, 'Voice activity', clip, keyframes)) return 'blocked';
    generation = state.generateAudioIntelligenceForClip(clip.id, vadOnlyOptions)
      .then(() => 'generated' as const)
      .finally(() => {
        inFlightAudioArtifactGenerations.delete(request.requestKey);
      });
    inFlightAudioArtifactGenerations.set(request.requestKey, generation);
  }
  return generation;
}

function scheduleAudioArtifactGeneration(
  request: TimelineAudioArtifactGenerationRequest,
  warm: (
    request: TimelineAudioArtifactGenerationRequest,
    deps: TimelineAudioArtifactGenerationDeps,
  ) => Promise<AudioArtifactGenerationStatus>,
  options: {
    deps?: TimelineAudioArtifactGenerationDeps;
    delayMs: number;
  },
): () => void {
  if (scheduledAudioArtifactTimers.has(request.requestKey) || inFlightAudioArtifactGenerations.has(request.requestKey)) {
    return () => {};
  }

  const deps = options.deps ?? getDefaultDeps();
  const timer = deps.setTimeout(() => {
    if (scheduledAudioArtifactTimers.get(request.requestKey) !== timer) return;
    scheduledAudioArtifactTimers.delete(request.requestKey);
    void warm(request, deps);
  }, options.delayMs);

  scheduledAudioArtifactTimers.set(request.requestKey, timer);

  return () => {
    if (scheduledAudioArtifactTimers.get(request.requestKey) !== timer) return;
    deps.clearTimeout(timer);
    scheduledAudioArtifactTimers.delete(request.requestKey);
  };
}

export function scheduleTimelineProcessedWaveformDerivation(
  request: TimelineAudioArtifactGenerationRequest,
  options: {
    deps?: TimelineAudioArtifactGenerationDeps;
    delayMs?: number;
  } = {},
): () => void {
  return scheduleAudioArtifactGeneration(
    request,
    warmProcessedWaveformDerivation,
    {
      deps: options.deps,
      delayMs: options.delayMs ?? DEFAULT_PROCESSED_WAVEFORM_DERIVATION_DELAY_MS,
    },
  );
}

export function scheduleTimelineSpectrogramTileGeneration(
  request: TimelineAudioArtifactGenerationRequest,
  options: {
    deps?: TimelineAudioArtifactGenerationDeps;
    delayMs?: number;
  } = {},
): () => void {
  return scheduleAudioArtifactGeneration(
    request,
    warmSpectrogramTiles,
    {
      deps: options.deps,
      delayMs: options.delayMs ?? DEFAULT_SPECTROGRAM_GENERATION_DELAY_MS,
    },
  );
}

export function scheduleTimelineAudioIntelligenceWarmup(
  request: TimelineAudioArtifactGenerationRequest,
  options: {
    deps?: TimelineAudioArtifactGenerationDeps;
    delayMs?: number;
  } = {},
): () => void {
  if (!AUDIO_INTELLIGENCE_WARMUP_ENABLED) return () => {};
  return scheduleAudioArtifactGeneration(
    request,
    warmVoiceActivity,
    {
      deps: options.deps,
      delayMs: options.delayMs ?? DEFAULT_AUDIO_INTELLIGENCE_GENERATION_DELAY_MS,
    },
  );
}

export function resetTimelineAudioArtifactGenerationWarmupForTest(): void {
  clearTimelineWarmupTimers(scheduledAudioArtifactTimers.values());
  scheduledAudioArtifactTimers.clear();
  inFlightAudioArtifactGenerations.clear();
  audioArtifactGenerationAttempts.clear();
}

export type {
  AudioArtifactGenerationStatus,
  TimelineAudioArtifactGenerationDeps,
  TimelineAudioArtifactGenerationRequest,
  TimelineAudioArtifactGenerationState,
};
