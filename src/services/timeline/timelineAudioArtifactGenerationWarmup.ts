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
  | 'skipped'
  | 'failed';

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

// A generation that ends without its artifact (storage gone, source unreadable) is retried with
// growing pauses. Without them every clip update re-ran the warmup, and one session logged the
// same failing waveform save 1004 times in two hours.
const FAILED_GENERATION_RETRY_BASE_MS = 15_000;
const FAILED_GENERATION_RETRY_MAX_MS = 10 * 60_000;

interface FailedAudioArtifactGeneration {
  failures: number;
  retryAtMs: number;
  /** Audio state the attempt ran for; an edit to the clip's audio retries right away. */
  stateKey: string;
}

const log = Logger.create('TimelineAudioArtifactWarmup');
const scheduledAudioArtifactTimers = new Map<string, TimerHandle>();
const inFlightAudioArtifactGenerations = new Map<string, Promise<AudioArtifactGenerationStatus>>();
const failedAudioArtifactGenerations = new Map<string, FailedAudioArtifactGeneration>();

function readNow(deps: TimelineAudioArtifactGenerationDeps): number {
  return deps.now?.() ?? Date.now();
}

function createGenerationStateKey(clip: TimelineClip, keyframes: readonly Keyframe[]): string {
  return createProcessedClipAudioStateHash(clip, { keyframes });
}

/** Records whether a finished generation produced its artifact and paces the next attempt. */
function settleAudioArtifactGeneration(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
  label: string,
  stateKey: string,
  hasArtifact: (clip: TimelineClip) => boolean,
): AudioArtifactGenerationStatus {
  const resolved = getClipAndKeyframes(deps.getState(), request.clipId);
  if (!resolved) {
    failedAudioArtifactGenerations.delete(request.requestKey);
    return 'skipped';
  }
  if (hasArtifact(resolved.clip)) {
    failedAudioArtifactGenerations.delete(request.requestKey);
    return 'generated';
  }
  if (createGenerationStateKey(resolved.clip, resolved.keyframes) !== stateKey) {
    // The clip's audio changed meanwhile; the result was discarded as stale, not failed.
    failedAudioArtifactGenerations.delete(request.requestKey);
    return 'skipped';
  }
  const previous = failedAudioArtifactGenerations.get(request.requestKey);
  const failures = previous?.stateKey === stateKey ? previous.failures + 1 : 1;
  const retryInMs = Math.min(
    FAILED_GENERATION_RETRY_MAX_MS,
    FAILED_GENERATION_RETRY_BASE_MS * 2 ** (failures - 1),
  );
  failedAudioArtifactGenerations.set(request.requestKey, {
    failures,
    retryAtMs: readNow(deps) + retryInMs,
    stateKey,
  });
  log.warn(`${label} was not created; retrying later`, {
    clipId: request.clipId,
    failures,
    retryInSeconds: Math.round(retryInMs / 1000),
  });
  return 'failed';
}

/** Remaining pause before a failed request may run again; 0 when it may run now. */
function getFailedGenerationDelayMs(
  request: TimelineAudioArtifactGenerationRequest,
  deps: TimelineAudioArtifactGenerationDeps,
): number {
  const failure = failedAudioArtifactGenerations.get(request.requestKey);
  if (!failure) return 0;
  const resolved = getClipAndKeyframes(deps.getState(), request.clipId);
  if (!resolved || createGenerationStateKey(resolved.clip, resolved.keyframes) !== failure.stateKey) {
    failedAudioArtifactGenerations.delete(request.requestKey);
    return 0;
  }
  return Math.max(0, failure.retryAtMs - readNow(deps));
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
  if (clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId) return 'ready';
  if (!clipRequiresProcessedWaveformPyramid(clip, keyframes)) return 'skipped';
  if (!canDeriveProcessedWaveformPyramid(clip, keyframes)) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    const stateKey = createGenerationStateKey(clip, keyframes);
    generation = state.generateProcessedWaveformForClip(clip.id, { derivedOnly: true })
      .then(() => settleAudioArtifactGeneration(
        request,
        deps,
        'Processed waveform',
        stateKey,
        (current) => Boolean(current.audioState?.processedAnalysisRefs?.processedWaveformPyramidId),
      ))
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
  if (requiredRef) return 'ready';
  if (!clip.isComposition && !clip.file) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    const stateKey = createGenerationStateKey(clip, keyframes);
    generation = state.generateSpectrogramForClip(clip.id)
      .then(() => settleAudioArtifactGeneration(
        request,
        deps,
        'Spectrogram',
        stateKey,
        (current) => Boolean(needsProcessedSpectrogram
          ? current.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0]
          : current.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0]),
      ))
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
  if (clip.audioState?.sourceAnalysisRefs?.voiceActivityId) return 'ready';
  if (!clip.isComposition && !clip.file) return 'skipped';
  if (!state.generateAudioIntelligenceForClip) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    const vadOnlyOptions = {
      features: new Set(['vad']),
    } as GenerateClipAudioAnalysisOptions;
    const stateKey = createGenerationStateKey(clip, keyframes);
    generation = state.generateAudioIntelligenceForClip(clip.id, vadOnlyOptions)
      .then(() => settleAudioArtifactGeneration(
        request,
        deps,
        'Voice activity',
        stateKey,
        (current) => Boolean(current.audioState?.sourceAnalysisRefs?.voiceActivityId),
      ))
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
  const delayMs = Math.max(options.delayMs, getFailedGenerationDelayMs(request, deps));
  const timer = deps.setTimeout(() => {
    if (scheduledAudioArtifactTimers.get(request.requestKey) !== timer) return;
    scheduledAudioArtifactTimers.delete(request.requestKey);
    void warm(request, deps);
  }, delayMs);

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
  failedAudioArtifactGenerations.clear();
}

export type {
  AudioArtifactGenerationStatus,
  TimelineAudioArtifactGenerationDeps,
  TimelineAudioArtifactGenerationRequest,
  TimelineAudioArtifactGenerationState,
};
