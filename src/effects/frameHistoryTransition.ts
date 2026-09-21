export type FrameHistoryLoopPolicy = 'reset' | 'continuous';
export type FrameHistoryDiscontinuity = 'seek' | 'loop' | 'export-start';
export type FrameHistoryTransitionAction = 'reset' | 'hold' | 'advance';

export interface FrameHistoryState {
  readonly stateClass: 'frame-history';
  readonly timelineTimeSeconds: number;
  readonly ownerRevision: string | number;
  readonly resetActive: boolean;
}

export interface FrameHistoryTransitionInput {
  readonly timelineTimeSeconds: number;
  readonly ownerRevision: string | number;
  readonly resetRequested: boolean;
  readonly discontinuity?: FrameHistoryDiscontinuity;
  readonly loopPolicy?: FrameHistoryLoopPolicy;
}

export interface FrameHistoryTransition {
  readonly action: FrameHistoryTransitionAction;
  readonly reason: 'initial' | 'explicit-reset' | 'seek' | 'loop' | 'export-start' | 'owner-revision' | 'backwards' | 'same-frame' | 'advance';
  readonly state: FrameHistoryState;
}

/** Pure frame-history policy. Runtime owners still decide how reset/hold/advance affect their resources. */
export function transitionFrameHistory(
  previous: FrameHistoryState | null,
  input: FrameHistoryTransitionInput,
): FrameHistoryTransition {
  const timelineTimeSeconds = Number.isFinite(input.timelineTimeSeconds) ? input.timelineTimeSeconds : 0;
  const state: FrameHistoryState = {
    stateClass: 'frame-history',
    timelineTimeSeconds,
    ownerRevision: input.ownerRevision,
    resetActive: input.resetRequested,
  };
  if (!previous) return { action: 'reset', reason: 'initial', state };
  if (input.discontinuity === 'export-start') return { action: 'reset', reason: 'export-start', state };
  if (input.discontinuity === 'seek') return { action: 'reset', reason: 'seek', state };
  if (input.discontinuity === 'loop' && input.loopPolicy !== 'continuous') return { action: 'reset', reason: 'loop', state };
  if (input.ownerRevision !== previous.ownerRevision) return { action: 'reset', reason: 'owner-revision', state };
  if (input.resetRequested && !previous.resetActive) return { action: 'reset', reason: 'explicit-reset', state };
  const continuousLoop = input.discontinuity === 'loop' && input.loopPolicy === 'continuous';
  if (!continuousLoop && timelineTimeSeconds < previous.timelineTimeSeconds) return { action: 'reset', reason: 'backwards', state };
  if (!continuousLoop && timelineTimeSeconds === previous.timelineTimeSeconds) return { action: 'hold', reason: 'same-frame', state };
  return { action: 'advance', reason: 'advance', state };
}
