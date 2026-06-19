import type { WebCodecsPlayer } from '../../engine/WebCodecsPlayer';

export interface WorkerWebCodecsStreamState {
  active: boolean;
  lastTargetTimeSeconds: number | null;
  lastPresentedTimestampSeconds: number | null;
}

export interface WorkerWebCodecsStreamFrameResult {
  readonly frame: VideoFrame | null;
  readonly timestampSeconds: number | null;
}

export function createWorkerWebCodecsStreamState(): WorkerWebCodecsStreamState {
  return {
    active: false,
    lastTargetTimeSeconds: null,
    lastPresentedTimestampSeconds: null,
  };
}

export function pauseWorkerWebCodecsStream(
  state: WorkerWebCodecsStreamState,
  options: { readonly clearPresentedTimestamp?: boolean } = {},
): void {
  state.active = false;
  state.lastTargetTimeSeconds = null;
  if (options.clearPresentedTimestamp === true) {
    state.lastPresentedTimestampSeconds = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function frameTimestampSeconds(frame: VideoFrame | null): number | null {
  return frame ? frame.timestamp / 1_000_000 : null;
}

function frameRateForPlayer(player: WebCodecsPlayer): number {
  return Math.max(player.getFrameRate?.() ?? 0, 1);
}

function streamNeedsRebase(input: {
  readonly player: WebCodecsPlayer;
  readonly state: WorkerWebCodecsStreamState;
  readonly timeSeconds: number;
}): boolean {
  if (!input.state.active) {
    return true;
  }

  const frameInterval = 1 / frameRateForPlayer(input.player);
  const lastTarget = input.state.lastTargetTimeSeconds;
  if (lastTarget !== null) {
    if (input.timeSeconds < lastTarget - frameInterval * 2) {
      return true;
    }
    if (input.timeSeconds > lastTarget + Math.max(1.2, frameInterval * 72)) {
      return true;
    }
  }

  const currentTimestampSeconds = frameTimestampSeconds(input.player.getCurrentFrame());
  return currentTimestampSeconds !== null &&
    input.timeSeconds < currentTimestampSeconds - frameInterval * 3;
}

function takeStreamFrame(input: {
  readonly player: WebCodecsPlayer;
  readonly state: WorkerWebCodecsStreamState;
  readonly timeSeconds: number;
}): WorkerWebCodecsStreamFrameResult {
  const frame = input.player.takeWorkerStreamPlaybackFrame(
    input.timeSeconds,
    input.state.lastPresentedTimestampSeconds,
  );
  const timestampSeconds = frameTimestampSeconds(frame);
  if (timestampSeconds !== null) {
    input.state.lastPresentedTimestampSeconds = timestampSeconds;
  }
  input.state.lastTargetTimeSeconds = input.timeSeconds;
  return { frame, timestampSeconds };
}

export async function readWorkerWebCodecsStreamFrame(input: {
  readonly player: WebCodecsPlayer;
  readonly state: WorkerWebCodecsStreamState;
  readonly timeSeconds: number;
  readonly timeoutMs?: number;
  readonly resetDecoder?: boolean;
}): Promise<WorkerWebCodecsStreamFrameResult> {
  const forceRebase = streamNeedsRebase(input);
  if (forceRebase) {
    input.player.startWorkerStreamPlayback(
      input.timeSeconds,
      input.resetDecoder === true ? { forceRebase, resetDecoder: true } : { forceRebase },
    );
    input.state.active = true;
    input.state.lastPresentedTimestampSeconds = null;
  } else {
    input.player.pumpWorkerStreamPlayback();
  }

  let result = takeStreamFrame(input);
  const timeoutMs = Math.max(0, input.timeoutMs ?? 0);
  const startedAt = performance.now();
  while (!result.frame && performance.now() - startedAt < timeoutMs) {
    await sleep(2);
    input.player.pumpWorkerStreamPlayback();
    result = takeStreamFrame(input);
  }

  return result;
}
