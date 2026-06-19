import { describe, expect, it, vi } from 'vitest';
import type { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';
import {
  createWorkerWebCodecsStreamState,
  readWorkerWebCodecsStreamFrame,
} from '../../src/services/render/workerRenderHostRuntimeWebCodecsStream';

describe('workerRenderHostRuntimeWebCodecsStream', () => {
  it('clears stale presented timestamps when force-rebasing a worker stream', async () => {
    const state = createWorkerWebCodecsStreamState();
    state.active = false;
    state.lastTargetTimeSeconds = null;
    state.lastPresentedTimestampSeconds = 14.366666;
    const frame = { timestamp: 0 } as VideoFrame;
    const player = {
      getFrameRate: vi.fn(() => 60),
      getCurrentFrame: vi.fn(() => null),
      startWorkerStreamPlayback: vi.fn(),
      pumpWorkerStreamPlayback: vi.fn(),
      takeWorkerStreamPlaybackFrame: vi.fn(() => frame),
    } as unknown as WebCodecsPlayer;

    const result = await readWorkerWebCodecsStreamFrame({
      player,
      state,
      timeSeconds: 0,
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(0, { forceRebase: true });
    expect(player.takeWorkerStreamPlaybackFrame).toHaveBeenCalledWith(0, null);
    expect(result.timestampSeconds).toBe(0);
    expect(state.lastPresentedTimestampSeconds).toBe(0);
  });

  it('passes an explicit decoder reset request through a stream force-rebase', async () => {
    const state = createWorkerWebCodecsStreamState();
    const frame = { timestamp: 1_000_000 } as VideoFrame;
    const player = {
      getFrameRate: vi.fn(() => 60),
      getCurrentFrame: vi.fn(() => null),
      startWorkerStreamPlayback: vi.fn(),
      pumpWorkerStreamPlayback: vi.fn(),
      takeWorkerStreamPlaybackFrame: vi.fn(() => frame),
    } as unknown as WebCodecsPlayer;

    await readWorkerWebCodecsStreamFrame({
      player,
      state,
      timeSeconds: 1,
      timeoutMs: 0,
      resetDecoder: true,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(1, {
      forceRebase: true,
      resetDecoder: true,
    });
  });
});
