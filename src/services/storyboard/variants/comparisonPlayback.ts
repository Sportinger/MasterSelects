import type { TimelineVariantScope } from '../contracts';

export interface StoryboardVariantComparisonPlaybackState {
  scope: TimelineVariantScope;
  playhead: number;
  playing: boolean;
  loop: boolean;
}
function clampToScope(value: number, scope: TimelineVariantScope): number {
  return Math.min(scope.endTime, Math.max(scope.startTime, value));
}

export function createVariantComparisonPlaybackState(
  scope: TimelineVariantScope,
): StoryboardVariantComparisonPlaybackState {
  return {
    scope: structuredClone(scope),
    playhead: scope.startTime,
    playing: false,
    loop: true,
  };
}

export function seekVariantComparisonPlayback(
  state: StoryboardVariantComparisonPlaybackState,
  playhead: number,
): StoryboardVariantComparisonPlaybackState {
  return { ...state, playhead: clampToScope(playhead, state.scope) };
}

export function advanceVariantComparisonPlayback(
  state: StoryboardVariantComparisonPlaybackState,
  elapsedSeconds: number,
): StoryboardVariantComparisonPlaybackState {
  if (!state.playing || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return state;
  }
  const duration = state.scope.endTime - state.scope.startTime;
  const raw = state.playhead + elapsedSeconds;
  if (raw < state.scope.endTime) return { ...state, playhead: raw };
  if (!state.loop) {
    return { ...state, playhead: state.scope.endTime, playing: false };
  }
  return {
    ...state,
    playhead: state.scope.startTime + ((raw - state.scope.startTime) % duration),
  };
}

export function setVariantComparisonPlaying(
  state: StoryboardVariantComparisonPlaybackState,
  playing: boolean,
): StoryboardVariantComparisonPlaybackState {
  return {
    ...state,
    playhead: playing && state.playhead >= state.scope.endTime
      ? state.scope.startTime
      : state.playhead,
    playing,
  };
}

export function setVariantComparisonLoop(
  state: StoryboardVariantComparisonPlaybackState,
  loop: boolean,
): StoryboardVariantComparisonPlaybackState {
  return { ...state, loop };
}
