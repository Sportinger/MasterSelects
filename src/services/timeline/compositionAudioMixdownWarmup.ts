import type { TimelineClip } from '../../types';
import { Logger } from '../logger';
import {
  getCompositionAudioMixdownKey,
  requestCompositionAudioMixdown,
  type CompositionAudioMixdownRequestResult,
} from './compositionAudioMixdownCache';
import {
  applyCompositionAudioMixdownToClips,
  setCompositionAudioMixdownGenerating,
} from './compositionAudioMixdownClipState';
import {
  hasLinkedCompositionAudioClip,
  isCompositionAudioClip,
} from './compositionAudioClipLinks';
import { getTimelineWarmupTimerDeps } from './timelineWarmupTimers';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface CompositionAudioMixdownWarmupState {
  clips: readonly TimelineClip[];
  timelineSessionId: number;
}

export interface CompositionAudioMixdownWarmupRequest {
  clipId: string;
  requestKey: string;
  timelineSessionId: number;
}

export interface CompositionAudioMixdownWarmupDeps {
  getWarmupState: () => CompositionAudioMixdownWarmupState;
  setClips: (updater: (clips: readonly TimelineClip[]) => TimelineClip[]) => void;
  requestMixdown?: (clip: TimelineClip) => Promise<CompositionAudioMixdownRequestResult | null>;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface CompositionAudioMixdownWarmupOptions {
  deps: CompositionAudioMixdownWarmupDeps;
  delayMs?: number;
}

export type CompositionAudioMixdownWarmupStatus =
  | 'warmed'
  | 'ready'
  | 'stale'
  | 'skipped';

export interface CompositionAudioMixdownWarmupResult {
  clipId: string;
  status: CompositionAudioMixdownWarmupStatus;
}

const DEFAULT_COMPOSITION_AUDIO_MIXDOWN_WARMUP_DELAY_MS = 600;
const scheduledCompositionMixdownTimers = new Map<string, TimerHandle>();
const inFlightCompositionMixdownWarmups = new Map<string, Promise<CompositionAudioMixdownWarmupResult>>();
const log = Logger.create('CompositionAudioMixdownWarmup');

function getRequestMixdown(deps: CompositionAudioMixdownWarmupDeps): (clip: TimelineClip) => Promise<CompositionAudioMixdownRequestResult | null> {
  return deps.requestMixdown ?? requestCompositionAudioMixdown;
}

function getTimerDeps(deps: CompositionAudioMixdownWarmupDeps): Required<Pick<CompositionAudioMixdownWarmupDeps, 'setTimeout' | 'clearTimeout'>> {
  if (deps.setTimeout && deps.clearTimeout) {
    return {
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout,
    };
  }
  return getTimelineWarmupTimerDeps();
}

function isCompositionAudioWarmupCandidate(
  clip: TimelineClip,
  clips: readonly TimelineClip[],
): boolean {
  if (
    !clip.isComposition ||
    !clip.compositionId ||
    clip.mixdownBuffer ||
    clip.mixdownGenerating
  ) {
    return false;
  }

  if (isCompositionAudioClip(clip)) return true;

  return clip.source?.type === 'video' && !hasLinkedCompositionAudioClip(clips, clip);
}

export function createCompositionAudioMixdownWarmupRequest(
  clip: TimelineClip,
  timelineSessionId: number,
  clips: readonly TimelineClip[] = [clip],
): CompositionAudioMixdownWarmupRequest | null {
  if (!isCompositionAudioWarmupCandidate(clip, clips)) return null;
  const key = getCompositionAudioMixdownKey(clip);
  if (!key) return null;
  return {
    clipId: clip.id,
    requestKey: `${timelineSessionId}:${clip.id}:${key}`,
    timelineSessionId,
  };
}

export function collectCompositionAudioMixdownWarmupRequests(
  state: CompositionAudioMixdownWarmupState,
): CompositionAudioMixdownWarmupRequest[] {
  const requests: CompositionAudioMixdownWarmupRequest[] = [];
  const seen = new Set<string>();

  for (const clip of state.clips.toSorted((a, b) => a.startTime - b.startTime)) {
    const request = createCompositionAudioMixdownWarmupRequest(clip, state.timelineSessionId, state.clips);
    if (!request || seen.has(request.requestKey)) continue;
    seen.add(request.requestKey);
    requests.push(request);
  }

  return requests;
}

function findCurrentClip(
  deps: CompositionAudioMixdownWarmupDeps,
  request: CompositionAudioMixdownWarmupRequest,
): TimelineClip | null {
  const state = deps.getWarmupState();
  if (state.timelineSessionId !== request.timelineSessionId) return null;
  return state.clips.find((clip) => clip.id === request.clipId) ?? null;
}

function updateWarmupGenerating(
  deps: CompositionAudioMixdownWarmupDeps,
  request: CompositionAudioMixdownWarmupRequest,
  mixdownGenerating: boolean,
): void {
  if (deps.getWarmupState().timelineSessionId !== request.timelineSessionId) return;
  deps.setClips((clips) => setCompositionAudioMixdownGenerating(clips, request.clipId, mixdownGenerating));
}

export async function warmCompositionAudioMixdownRequest(
  request: CompositionAudioMixdownWarmupRequest,
  options: CompositionAudioMixdownWarmupOptions,
): Promise<CompositionAudioMixdownWarmupResult> {
  const deps = options.deps;
  const existing = inFlightCompositionMixdownWarmups.get(request.requestKey);
  if (existing) return existing;

  const warmup = (async (): Promise<CompositionAudioMixdownWarmupResult> => {
    const currentState = deps.getWarmupState();
    const clip = currentState.timelineSessionId === request.timelineSessionId
      ? currentState.clips.find((candidate) => candidate.id === request.clipId) ?? null
      : null;
    if (!clip) return { clipId: request.clipId, status: 'stale' };
    const currentRequest = createCompositionAudioMixdownWarmupRequest(clip, request.timelineSessionId, currentState.clips);
    if (!currentRequest) return { clipId: request.clipId, status: clip.mixdownBuffer ? 'ready' : 'skipped' };
    if (currentRequest.requestKey !== request.requestKey) {
      return { clipId: request.clipId, status: 'stale' };
    }

    updateWarmupGenerating(deps, request, true);

    try {
      const result = await getRequestMixdown(deps)(clip);
      const latestClip = findCurrentClip(deps, request);
      if (!latestClip) return { clipId: request.clipId, status: 'stale' };

      if (!result) {
        updateWarmupGenerating(deps, request, false);
        return { clipId: request.clipId, status: 'skipped' };
      }

      deps.setClips((clips) => applyCompositionAudioMixdownToClips(clips, request.clipId, result));
      return { clipId: request.clipId, status: 'warmed' };
    } catch (error) {
      log.warn('Composition audio mixdown warmup failed', { clipId: request.clipId, error });
      updateWarmupGenerating(deps, request, false);
      return { clipId: request.clipId, status: 'skipped' };
    }
  })().finally(() => {
    inFlightCompositionMixdownWarmups.delete(request.requestKey);
  });

  inFlightCompositionMixdownWarmups.set(request.requestKey, warmup);
  return warmup;
}

export async function warmCompositionAudioMixdowns(
  requests: readonly CompositionAudioMixdownWarmupRequest[],
  options: CompositionAudioMixdownWarmupOptions,
): Promise<CompositionAudioMixdownWarmupResult[]> {
  const results: CompositionAudioMixdownWarmupResult[] = [];
  for (const request of requests) {
    if (options.deps.getWarmupState().timelineSessionId !== request.timelineSessionId) {
      results.push({ clipId: request.clipId, status: 'stale' });
      continue;
    }
    results.push(await warmCompositionAudioMixdownRequest(request, options));
  }
  return results;
}

export function scheduleCompositionAudioMixdownWarmup(
  options: CompositionAudioMixdownWarmupOptions,
): () => void {
  const deps = options.deps;
  const requests = collectCompositionAudioMixdownWarmupRequests(deps.getWarmupState());
  if (requests.length === 0) return () => {};

  const { setTimeout: scheduleTimeout, clearTimeout: cancelTimeout } = getTimerDeps(deps);
  const scheduled: Array<{ key: string; timer: TimerHandle }> = [];

  for (const request of requests) {
    if (
      scheduledCompositionMixdownTimers.has(request.requestKey) ||
      inFlightCompositionMixdownWarmups.has(request.requestKey)
    ) {
      continue;
    }

    const timer = scheduleTimeout(() => {
      if (scheduledCompositionMixdownTimers.get(request.requestKey) !== timer) return;
      scheduledCompositionMixdownTimers.delete(request.requestKey);
      void warmCompositionAudioMixdownRequest(request, options);
    }, options.delayMs ?? DEFAULT_COMPOSITION_AUDIO_MIXDOWN_WARMUP_DELAY_MS);

    scheduledCompositionMixdownTimers.set(request.requestKey, timer);
    scheduled.push({ key: request.requestKey, timer });
  }

  return () => {
    for (const { key, timer } of scheduled) {
      if (scheduledCompositionMixdownTimers.get(key) !== timer) continue;
      cancelTimeout(timer);
      scheduledCompositionMixdownTimers.delete(key);
    }
  };
}

export function resetCompositionAudioMixdownWarmupForTest(): void {
  const { clearTimeout: cancelTimeout } = getTimelineWarmupTimerDeps();
  for (const timer of scheduledCompositionMixdownTimers.values()) {
    cancelTimeout(timer);
  }
  scheduledCompositionMixdownTimers.clear();
  inFlightCompositionMixdownWarmups.clear();
}
