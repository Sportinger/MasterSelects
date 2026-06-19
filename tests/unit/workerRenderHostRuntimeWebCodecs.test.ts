import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerRuntimeWebCodecsMocks = vi.hoisted(() => {
  const makeFrame = (timeSeconds: number): VideoFrame => {
    const frame = {
      timestamp: timeSeconds * 1_000_000,
      displayWidth: 1280,
      displayHeight: 720,
      codedWidth: 1280,
      codedHeight: 720,
      close: vi.fn(),
      clone: vi.fn(() => makeFrame(timeSeconds)),
    };
    return frame as unknown as VideoFrame;
  };

  return {
    instances: [] as Array<{
      currentFrame: VideoFrame | null;
      ready: boolean;
      width: number;
      height: number;
      currentTime: number;
      isPlaying: boolean;
      onDecodedFrame?: (frame: VideoFrame) => void;
      onFrame?: (frame: VideoFrame) => void;
      loadArrayBuffer: ReturnType<typeof vi.fn>;
      getFrameRate: ReturnType<typeof vi.fn>;
      hasFrame: ReturnType<typeof vi.fn>;
      getCurrentFrame: ReturnType<typeof vi.fn>;
      isDecodePending: ReturnType<typeof vi.fn>;
      getDebugInfo: ReturnType<typeof vi.fn>;
      getReverseDecodeWindowForTimeSeconds: ReturnType<typeof vi.fn>;
      seek: ReturnType<typeof vi.fn>;
      advanceToTime: ReturnType<typeof vi.fn>;
      startWorkerStreamPlayback: ReturnType<typeof vi.fn>;
      pumpWorkerStreamPlayback: ReturnType<typeof vi.fn>;
      takeWorkerStreamPlaybackFrame: ReturnType<typeof vi.fn>;
      scrubSeek: ReturnType<typeof vi.fn>;
      fastSeek: ReturnType<typeof vi.fn>;
      seekAsync: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    }>,
    makeFrame,
  };
});

vi.mock('../../src/engine/WebCodecsPlayer', () => {
  class WebCodecsPlayer {
    currentFrame: VideoFrame | null = null;
    ready = true;
    width = 1280;
    height = 720;
    currentTime = 0;
    isPlaying = false;
    loadArrayBuffer = vi.fn(async () => {
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(0);
    });
    getFrameRate = vi.fn(() => 30);
    hasFrame = vi.fn(() => this.currentFrame !== null);
    getCurrentFrame = vi.fn(() => this.currentFrame);
    isDecodePending = vi.fn(() => false);
    getDebugInfo = vi.fn(() => ({
      decodeQueueSize: 0,
      samplesLoaded: 10,
      sampleIndex: Math.round(this.currentTime * 30),
      currentFrameTimestampSeconds: this.currentFrame?.timestamp
        ? this.currentFrame.timestamp / 1_000_000
        : null,
    }));
    getReverseDecodeWindowForTimeSeconds = vi.fn(() => null);
    advanceToTime = vi.fn((timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    startWorkerStreamPlayback = vi.fn((timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    pumpWorkerStreamPlayback = vi.fn();
    takeWorkerStreamPlaybackFrame = vi.fn(() => this.currentFrame);
    seek = vi.fn((timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    scrubSeek = vi.fn((timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    fastSeek = vi.fn((timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    seekAsync = vi.fn(async (timeSeconds: number) => {
      this.currentTime = timeSeconds;
      this.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
    });
    pause = vi.fn(() => {
      this.isPlaying = false;
    });
    destroy = vi.fn();

    constructor(options: {
      onDecodedFrame?: (frame: VideoFrame) => void;
      onFrame?: (frame: VideoFrame) => void;
    } = {}) {
      this.onDecodedFrame = options.onDecodedFrame;
      this.onFrame = options.onFrame;
      workerRuntimeWebCodecsMocks.instances.push(this);
    }
  }

  return { WebCodecsPlayer };
});

import {
  acceptWorkerWebCodecsCommand,
  pauseWorkerWebCodecsPlaybackForSource,
  readWorkerWebCodecsVideoFrameForGpuPresentation,
  resetWorkerWebCodecsRuntime,
} from '../../src/services/render/workerRenderHostRuntimeWebCodecs';

describe('worker render host runtime WebCodecs commands', () => {
  beforeEach(() => {
    resetWorkerWebCodecsRuntime();
    workerRuntimeWebCodecsMocks.instances.length = 0;
    vi.stubGlobal('createImageBitmap', vi.fn(async (frame: VideoFrame) => ({
      width: frame.displayWidth,
      height: frame.displayHeight,
      close: vi.fn(),
    })));
  });

  it('uses strict paused seeks for reverse frame reads', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-a',
      sourceId: 'source-a',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.isPlaying = true;

    const output = await acceptWorkerWebCodecsCommand({
      type: 'readWebCodecsFrame',
      requestId: 'read-reverse-a',
      sourceId: 'source-a',
      timeSeconds: 2.5,
      mode: 'reverse',
      timeoutMs: 20,
    });

    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenCalledWith(2.5, { previewMode: 'strict' });
    expect(player.seekAsync).not.toHaveBeenCalled();
    expect(player.scrubSeek).not.toHaveBeenCalled();
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(output.webCodecs?.frame?.timestampSeconds).toBe(2.5);
  });

  it('pauses and rebases a worker stream source when playback is stopped', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-pause',
      sourceId: 'source-stream-pause',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.takeWorkerStreamPlaybackFrame.mockImplementation((timeSeconds: number) => {
      player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
      return player.currentFrame;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-pause',
      timeSeconds: 1,
      mode: 'stream',
      timeoutMs: 0,
    });
    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-pause',
      timeSeconds: 1.1,
      mode: 'stream',
      timeoutMs: 0,
    });
    expect(player.startWorkerStreamPlayback).toHaveBeenCalledTimes(1);
    expect(player.pumpWorkerStreamPlayback).toHaveBeenCalled();

    pauseWorkerWebCodecsPlaybackForSource('source-stream-pause');

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-pause',
      timeSeconds: 1.2,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.startWorkerStreamPlayback).toHaveBeenCalledTimes(2);
    expect(player.startWorkerStreamPlayback).toHaveBeenLastCalledWith(1.2, { forceRebase: true });
  });

  it('keeps reverse cache capture active while waiting for the decoded frame', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-cache',
      sourceId: 'source-cache',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getCurrentFrame.mockImplementation(() => null);
    player.hasFrame.mockImplementation(() => false);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        const frame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
        player.onDecodedFrame?.(frame);
      }, 0);
    });

    const output = await acceptWorkerWebCodecsCommand({
      type: 'readWebCodecsFrame',
      requestId: 'read-reverse-cache',
      sourceId: 'source-cache',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 20,
    });

    expect(player.seek).toHaveBeenCalledWith(3.25, { previewMode: 'strict' });
    expect(output.webCodecs?.frame?.timestampSeconds).toBe(3.25);
  });

  it('serves GPU reverse frame reads from the reverse cache before seeking', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-cache',
      sourceId: 'source-gpu-reverse-cache',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getCurrentFrame.mockImplementation(() => null);
    player.hasFrame.mockImplementation(() => false);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        const frame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
        player.onDecodedFrame?.(frame);
      }, 0);
    });

    await acceptWorkerWebCodecsCommand({
      type: 'readWebCodecsFrame',
      requestId: 'seed-reverse-cache',
      sourceId: 'source-gpu-reverse-cache',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 20,
    });
    player.seek.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-cache',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 20,
    });

    expect(player.seek).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(3_250_000);
    expect(output.timestampSeconds).toBe(3.25);
    expect(output.status?.reverseFrameCacheSize).toBe(1);
  });

  it('keeps GPU reverse cache capture alive after an immediate near-frame return', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-late-cache',
      sourceId: 'source-gpu-reverse-late-cache',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(3));
      }, 0);
    });

    const immediate = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-late-cache',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    expect(immediate.frame?.timestamp).toBe(3_250_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    player.seek.mockClear();

    const cached = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-late-cache',
      timeSeconds: 3,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(player.seek).not.toHaveBeenCalled();
    expect(cached.frame?.timestamp).toBe(3_000_000);
    expect(cached.status?.reverseFrameCacheSize).toBe(1);
  });

  it('starts a strict seek while holding a stale current frame for GPU reverse reads', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-strict',
      sourceId: 'source-gpu-reverse-strict',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.05);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-strict',
      timeSeconds: 3,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(player.seek).toHaveBeenCalledWith(3, { previewMode: 'strict' });
    expect(output.frame?.timestamp).toBe(3_050_000);
  });

  it('does not present a stale held frame that would move reverse streaming forward', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-monotonic',
      sourceId: 'source-gpu-reverse-monotonic',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.05);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-monotonic',
      timeSeconds: 2.9,
      mode: 'reverse',
      timeoutMs: 0,
      previousPresentedTimestampSeconds: 3,
      allowStaleReverseHold: false,
    });

    expect(player.seek.mock.calls[0]?.[0]).toBeCloseTo(3);
    expect(player.seek.mock.calls[0]?.[1]).toEqual({ previewMode: 'strict' });
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });

  it('waits for an existing GPU reverse decode window instead of seeking again', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-pending',
      sourceId: 'source-gpu-reverse-pending',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(3));
      }, 0);
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-pending',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.seek.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-pending',
      timeSeconds: 3,
      mode: 'reverse',
      timeoutMs: 20,
    });

    expect(player.seek).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(3_000_000);
  });

  it('uses a nearby monotonic held frame while a GPU reverse decode window is pending', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-held-pending',
      sourceId: 'source-gpu-reverse-held-pending',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-held-pending',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.seek.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-held-pending',
      timeSeconds: 3.1,
      mode: 'reverse',
      timeoutMs: 20,
      previousPresentedTimestampSeconds: 3.25,
    });

    expect(player.seek).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(3_250_000);
    expect(output.timestampSeconds).toBe(3.25);
  });

  it('keeps an active GPU reverse decode window when the target moves below the partially filled cache', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-cache-edge',
      sourceId: 'source-gpu-reverse-cache-edge',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(3));
      }, 0);
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-cache-edge',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    player.seek.mockClear();

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-cache-edge',
      timeSeconds: 2,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(player.seek).not.toHaveBeenCalled();
  });

  it('starts a new GPU reverse seek after the target moves below the planned decode window', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-window-edge',
      sourceId: 'source-gpu-reverse-window-edge',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(3.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-window-edge',
      timeSeconds: 3.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.seek.mockClear();

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-window-edge',
      timeSeconds: 0.8,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(player.seek).toHaveBeenCalledWith(0.8, { previewMode: 'strict' });
  });

  it('uses the player keyframe window instead of a fixed reverse lookback window', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-keyframe-window',
      sourceId: 'source-gpu-reverse-keyframe-window',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(4.8);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.getReverseDecodeWindowForTimeSeconds.mockImplementation((timeSeconds: number) => (
      timeSeconds >= 3.9
        ? { targetTimeSeconds: 4.83, minTimeSeconds: 3.9, maxTimeSeconds: 4.83 }
        : { targetTimeSeconds: 3.86, minTimeSeconds: 1.93, maxTimeSeconds: 3.86 }
    ));
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-keyframe-window',
      timeSeconds: 4.2,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.seek.mockClear();

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-keyframe-window',
      timeSeconds: 3.5,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(player.seek).toHaveBeenCalledWith(3.86, { previewMode: 'strict' });
  });

  it('primes the next GPU reverse window while serving a lower-edge cache hit', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-prime-next',
      sourceId: 'source-gpu-reverse-prime-next',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(4.25);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(false);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-prime-next',
      timeSeconds: 4.25,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(4.25));
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(3));
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(2.75));
    player.seek.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-prime-next',
      timeSeconds: 2.79,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(output.frame?.timestamp).toBe(2_750_000);
    expect(player.seek.mock.calls[0]?.[0]).toBeCloseTo(2.83);
    expect(player.seek.mock.calls[0]?.[1]).toEqual({ previewMode: 'strict' });
  });

  it('primes the next GPU reverse window at the lower cache edge even when the old decode is still pending', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-gpu-reverse-prime-pending',
      sourceId: 'source-gpu-reverse-prime-pending',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.getFrameRate.mockReturnValue(60);
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(4);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.isDecodePending.mockReturnValue(true);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-prime-pending',
      timeSeconds: 4,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(4));
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(2.5));
    player.seek.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-gpu-reverse-prime-pending',
      timeSeconds: 2.5,
      mode: 'reverse',
      timeoutMs: 0,
    });

    expect(output.frame?.timestamp).toBe(2_500_000);
    expect(player.seek.mock.calls[0]?.[0]).toBeCloseTo(2.58);
    expect(player.seek.mock.calls[0]?.[1]).toEqual({ previewMode: 'strict' });
  });

  it('uses the worker streaming queue for normal GPU playback without per-frame seeking', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream',
      sourceId: 'source-stream',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream',
      timeSeconds: 1.25,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(1.25, { forceRebase: true });
    expect(player.takeWorkerStreamPlaybackFrame).toHaveBeenCalledWith(1.25, null);
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.seekAsync).not.toHaveBeenCalled();
    expect(player.scrubSeek).not.toHaveBeenCalled();
    expect(player.fastSeek).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(1_250_000);
  });

  it('clears reverse capture and resets the decoder when normal GPU streaming resumes after reverse', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-after-reverse',
      sourceId: 'source-stream-after-reverse',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-after-reverse',
      timeSeconds: 3,
      mode: 'reverse',
      timeoutMs: 0,
    });
    player.onDecodedFrame?.(workerRuntimeWebCodecsMocks.makeFrame(3));
    player.startWorkerStreamPlayback.mockClear();

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-after-reverse',
      timeSeconds: 3.1,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(3.1, {
      forceRebase: true,
      resetDecoder: true,
    });
    expect(player.seek).toHaveBeenCalledTimes(1);
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(output.status?.reverseCaptureTargetSeconds).toBeNull();
    expect(output.status?.reverseCaptureWindowMinSeconds).toBeNull();
    expect(output.status?.reverseCaptureWindowMaxSeconds).toBeNull();
    expect(output.status?.reverseFrameCacheSize).toBe(0);
    expect(output.frame?.timestamp).toBe(3_100_000);
  });

  it('waits briefly for a streaming queue frame after a jump without falling back to seek', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-wait',
      sourceId: 'source-stream-wait',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = null;
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.startWorkerStreamPlayback.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
      }, 0);
    });
    player.takeWorkerStreamPlaybackFrame.mockImplementation(() => player.currentFrame);

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-wait',
      timeSeconds: 4.5,
      mode: 'stream',
      timeoutMs: 40,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(4.5, { forceRebase: true });
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.seekAsync).not.toHaveBeenCalled();
    expect(player.scrubSeek).not.toHaveBeenCalled();
    expect(player.fastSeek).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(4_500_000);
  });

  it('does not present a stale streaming frame as a fresh playback frame', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-stale',
      sourceId: 'source-stream-stale',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.startWorkerStreamPlayback.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });
    player.takeWorkerStreamPlaybackFrame.mockImplementation(() => null);

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-stale',
      timeSeconds: 4,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(4, { forceRebase: true });
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });

  it('waits for an advanced streaming frame instead of repeating a nearby previous frame', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-repeat',
      sourceId: 'source-stream-repeat',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.startWorkerStreamPlayback.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });
    player.takeWorkerStreamPlaybackFrame.mockImplementation(() => null);

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-repeat',
      timeSeconds: 1 + 1 / 30,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(1 + 1 / 30, { forceRebase: true });
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });

  it('can hold a nearby streaming frame for secondary composite layers', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-hold',
      sourceId: 'source-stream-hold',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.startWorkerStreamPlayback.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });
    player.takeWorkerStreamPlaybackFrame.mockImplementation(() => null);

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-hold',
      timeSeconds: 1 + 1 / 30,
      mode: 'stream',
      timeoutMs: 0,
      allowStreamHold: true,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledWith(1 + 1 / 30, { forceRebase: true });
    expect(player.advanceToTime).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBe(1_000_000);
    expect(output.timestampSeconds).toBe(1);
  });

  it('keeps an active normal stream on pump/take calls instead of rebasing every frame', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-continuous',
      sourceId: 'source-stream-continuous',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.takeWorkerStreamPlaybackFrame.mockImplementation((timeSeconds: number) => {
      player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
      return player.currentFrame;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-continuous',
      timeSeconds: 1,
      mode: 'stream',
      timeoutMs: 0,
    });
    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-continuous',
      timeSeconds: 1.5,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.startWorkerStreamPlayback).toHaveBeenCalledTimes(1);
    expect(player.pumpWorkerStreamPlayback).toHaveBeenCalled();
    expect(player.advanceToTime).not.toHaveBeenCalled();
  });

  it('resets the stream presented timestamp when a paused seek jumps to a new position', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stream-seek-reset',
      sourceId: 'source-stream-seek-reset',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.takeWorkerStreamPlaybackFrame.mockImplementation((timeSeconds: number) => {
      player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
      return player.currentFrame;
    });

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-seek-reset',
      timeSeconds: 7,
      mode: 'stream',
      timeoutMs: 0,
    });
    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-seek-reset',
      timeSeconds: 6,
      mode: 'seek',
      timeoutMs: 0,
    });
    vi.mocked(player.takeWorkerStreamPlaybackFrame).mockClear();

    await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stream-seek-reset',
      timeSeconds: 6 + 1 / 30,
      mode: 'stream',
      timeoutMs: 0,
    });

    expect(player.takeWorkerStreamPlaybackFrame).toHaveBeenCalledWith(6 + 1 / 30, null);
  });

  it('waits for paused seek frame stepping instead of re-presenting the previous frame', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-seek-step',
      sourceId: 'source-seek-step',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      setTimeout(() => {
        player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(timeSeconds);
      }, 0);
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-seek-step',
      timeSeconds: 1 + 1 / 30,
      mode: 'seek',
      timeoutMs: 40,
    });

    expect(player.seek).toHaveBeenCalledWith(1 + 1 / 30, { previewMode: 'interactive-preroll' });
    expect(player.seekAsync).not.toHaveBeenCalled();
    expect(output.frame?.timestamp).toBeCloseTo((1 + 1 / 30) * 1_000_000);
  });

  it('does not report the previous frame when paused frame stepping has not resolved yet', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-seek-stale',
      sourceId: 'source-seek-stale',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-seek-stale',
      timeSeconds: 1 + 1 / 30,
      mode: 'seek',
      timeoutMs: 0,
    });

    expect(player.seek).toHaveBeenCalledWith(1 + 1 / 30, { previewMode: 'interactive-preroll' });
    expect(player.seekAsync).not.toHaveBeenCalled();
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });

  it('rejects a far stale current frame when a paused seek has no previous timestamp', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-stale-null-previous',
      sourceId: 'source-stale-null-previous',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    const staleFrame = workerRuntimeWebCodecsMocks.makeFrame(10);
    player.currentFrame = null;
    player.getCurrentFrame
      .mockImplementationOnce(() => null)
      .mockImplementation(() => player.currentFrame);
    player.seek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
      player.currentFrame = staleFrame;
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-stale-null-previous',
      timeSeconds: 0,
      mode: 'seek',
      timeoutMs: 0,
    });

    expect(player.seek).toHaveBeenCalledWith(0, { previewMode: 'interactive-preroll' });
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });

  it('does not report the previous frame when an interactive GPU scrub has not resolved yet', async () => {
    await acceptWorkerWebCodecsCommand({
      type: 'loadWebCodecsSource',
      requestId: 'load-source-scrub-stale',
      sourceId: 'source-scrub-stale',
      buffer: new ArrayBuffer(8),
    });
    const player = workerRuntimeWebCodecsMocks.instances[0]!;
    player.currentFrame = workerRuntimeWebCodecsMocks.makeFrame(1);
    player.getCurrentFrame.mockImplementation(() => player.currentFrame);
    player.scrubSeek.mockImplementation((timeSeconds: number) => {
      player.currentTime = timeSeconds;
    });

    const output = await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: 'source-scrub-stale',
      timeSeconds: 2,
      mode: 'scrub',
      timeoutMs: 0,
    });

    expect(player.scrubSeek).toHaveBeenCalledWith(2);
    expect(player.seek).not.toHaveBeenCalled();
    expect(output.frame).toBeNull();
    expect(output.timestampSeconds).toBeNull();
  });
});
