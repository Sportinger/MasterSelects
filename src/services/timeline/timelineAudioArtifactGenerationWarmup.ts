import { useTimelineStore } from '../../stores/timeline';
import type { GenerateClipAudioAnalysisOptions } from '../../stores/timeline/types';
import type { Keyframe, TimelineClip } from '../../types';
import { canDeriveProcessedWaveformPyramid } from '../audio/DerivedWaveformPyramidService';
import { clipRequiresProcessedWaveformPyramid } from '../audio/processedWaveformEligibility';
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
}

interface TimelineAudioArtifactGenerationDeps {
  getState: () => TimelineAudioArtifactGenerationState;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface TimelineAudioArtifactGenerationRequest {
  clipId: string;
  requestKey: string;
}

const DEFAULT_PROCESSED_WAVEFORM_DERIVATION_DELAY_MS = 500;
const DEFAULT_SPECTROGRAM_GENERATION_DELAY_MS = 650;

const scheduledAudioArtifactTimers = new Map<string, TimerHandle>();
const inFlightAudioArtifactGenerations = new Map<string, Promise<AudioArtifactGenerationStatus>>();

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
  if (requiredRef) return 'ready';
  if (!clip.isComposition && !clip.file) return 'skipped';

  let generation = inFlightAudioArtifactGenerations.get(request.requestKey);
  if (!generation) {
    generation = state.generateSpectrogramForClip(clip.id)
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

export function resetTimelineAudioArtifactGenerationWarmupForTest(): void {
  clearTimelineWarmupTimers(scheduledAudioArtifactTimers.values());
  scheduledAudioArtifactTimers.clear();
  inFlightAudioArtifactGenerations.clear();
}

export type {
  AudioArtifactGenerationStatus,
  TimelineAudioArtifactGenerationDeps,
  TimelineAudioArtifactGenerationRequest,
  TimelineAudioArtifactGenerationState,
};
