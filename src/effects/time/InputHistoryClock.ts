import { transitionFrameHistory, type FrameHistoryState, type FrameHistoryDiscontinuity } from '../frameHistoryTransition';

export const INPUT_HISTORY_CAPACITY = 64;
export const INPUT_HISTORY_SECONDS = 4;

/** Timeline timestamps, not render counts, determine the history sampling clock. */
export class InputHistoryClock {
  readonly times = new Float64Array(INPUT_HISTORY_CAPACITY);
  count = 0;
  newest = 0;
  private lifecycle: FrameHistoryState | null = null;
  private eventRevision?: number;
  private horizon = 0;

  update(time: number, horizon: number, context?: { ownerRevision: number; eventRevision: number; discontinuity?: FrameHistoryDiscontinuity }): boolean {
    const changedEvent = context && context.eventRevision !== this.eventRevision;
    const transition = transitionFrameHistory(this.lifecycle, {
      timelineTimeSeconds: time, ownerRevision: context?.ownerRevision ?? 0,
      resetRequested: false, loopPolicy: 'reset', discontinuity: changedEvent ? context.discontinuity : undefined,
    });
    const gap = this.lifecycle && time - this.lifecycle.timelineTimeSeconds > INPUT_HISTORY_SECONDS;
    this.lifecycle = transition.state;
    this.eventRevision = context?.eventRevision;
    if (transition.action === 'reset' || gap || horizon !== this.horizon) this.count = 0;
    this.horizon = horizon;
    if (this.count && time - this.times[this.newest] < Math.max(1 / 60, horizon / (INPUT_HISTORY_CAPACITY - 2)) - 1e-6) return false;
    this.newest = this.count ? (this.newest + 1) % INPUT_HISTORY_CAPACITY : 0;
    this.times[this.newest] = time;
    this.count = Math.min(INPUT_HISTORY_CAPACITY, this.count + 1);
    return true;
  }

  metadata(time: number): Float32Array {
    const data = new Float32Array((INPUT_HISTORY_CAPACITY + 1) * 4);
    for (let i = 0; i < INPUT_HISTORY_CAPACITY; i++) data[i * 4] = Math.max(0, time - this.times[i]);
    data[INPUT_HISTORY_CAPACITY * 4] = this.count;
    data[INPUT_HISTORY_CAPACITY * 4 + 1] = this.newest;
    return data;
  }
}

export function inputHistorySize(width: number, height: number, maxEdge = 640): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(230400 / (width * height)));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
