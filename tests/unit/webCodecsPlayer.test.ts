import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mp4box', () => ({ default: {} }));

type WebCodecsPlayerModule = typeof import('../../src/engine/WebCodecsPlayer');

class MockEncodedVideoChunk {
  constructor(public readonly init: Record<string, unknown>) {}
}

function makeSamples(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    cts: index,
    duration: 1,
    timescale: 30,
    is_sync: index === 0,
    data: new Uint8Array([index % 255]),
  }));
}

function makeDecoder() {
  const decoder = {
    state: 'configured',
    decodeQueueSize: 0,
    decode: vi.fn(() => {}),
    reset: vi.fn(() => {
      decoder.decodeQueueSize = 0;
    }),
    configure: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };

  return decoder;
}

async function makePlayerHarness() {
  const module = await vi.importActual<WebCodecsPlayerModule>(
    '../../src/engine/WebCodecsPlayer'
  );
  const player = new module.WebCodecsPlayer() as unknown as Record<string, any>;
  const decoder = makeDecoder();

  player.useSimpleMode = false;
  player.ready = true;
  player.decoder = decoder;
  player.codecConfig = { codec: 'avc1.test' };
  player.videoTrack = { timescale: 30 };
  player.samples = makeSamples(120);
  player.frameRate = 30;
  player.frameBuffer = [];
  player.sampleIndex = 0;
  player.feedIndex = 0;
  player.currentFrame = null;
  player.currentFrameTimestampUs = null;
  player.pendingAdvanceSeekTargetIdx = null;
  player.trackedDecodeQueueSize = 0;
  player._isPlaying = false;

  return { player, decoder };
}

describe('WebCodecsPlayer advance playback', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).EncodedVideoChunk = MockEncodedVideoChunk;
  });

  it('caps advance feeding when decodeQueueSize lags behind decode() calls', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.advanceToTime(2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.feedIndex).toBe(24);
    expect(player.trackedDecodeQueueSize).toBe(24);
  });

  it('continues an in-flight advance seek without moving the pending resolve target forward', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.currentFrame = { timestamp: 0, close: vi.fn() };
    player.currentFrameTimestampUs = 0;

    player.advanceToTime(2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);
    expect(player.feedIndex).toBe(24);

    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2.1);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.configure).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(48);
    expect(player.feedIndex).toBe(48);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);
  });

  it('keeps an in-flight advance seek alive while playback moves forward within the timeout window', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.currentFrame = { timestamp: 0, close: vi.fn() };
    player.currentFrameTimestampUs = 0;

    player.advanceToTime(2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);

    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;
    player.pendingSeekStartedAtMs = performance.now() - 500;

    player.advanceToTime(3.2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);
  });

  it('does not treat forward playback as a backward jump when decode-order indices reorder around B-frames', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.samples = [
      { cts: 0, duration: 1, timescale: 1, is_sync: true, data: new Uint8Array([0]) },
      { cts: 3, duration: 1, timescale: 1, is_sync: false, data: new Uint8Array([1]) },
      { cts: 1, duration: 1, timescale: 1, is_sync: false, data: new Uint8Array([2]) },
      { cts: 2, duration: 1, timescale: 1, is_sync: false, data: new Uint8Array([3]) },
      { cts: 4, duration: 1, timescale: 1, is_sync: false, data: new Uint8Array([4]) },
    ];
    player.ctsSortedSampleCount = 0;
    player.ctsSorted = [];
    player._isPlaying = true;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.sampleIndex = 3;
    player.feedIndex = 5;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(3);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
  });

  it('clears a timed-out advance pending target so playback can publish current frames again', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 2_000_000, close: vi.fn() };
    const recoveredFrame = { timestamp: 3_200_000, close: vi.fn() };
    const onFrame = vi.fn();

    player.onFrame = onFrame;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 2_000_000;
    player._isPlaying = true;
    player.sampleIndex = 96;
    player.feedIndex = 110;
    player.frameBuffer = [recoveredFrame];
    player.pendingAdvanceSeekTargetIdx = 60;
    player.pendingSeekKind = 'advance';
    player.pendingSeekStartedAtMs = performance.now() - 3_000;
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(3.2);

    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
    expect(player.pendingSeekKind).toBeNull();
    expect(player.currentFrame).toBe(recoveredFrame);
    expect(player.currentFrameTimestampUs).toBe(3_200_000);
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(recoveredFrame);
  });

  it('restarts a timed-out advance seek with a fresh pending timer', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleStartedAt = performance.now() - 3_000;

    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player._isPlaying = true;
    player.pendingAdvanceSeekTargetIdx = 60;
    player.pendingSeekKind = 'advance';
    player.pendingSeekStartedAtMs = staleStartedAt;
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.sampleIndex = 60;
    player.feedIndex = 70;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(3.2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(96);
    expect(player.pendingSeekKind).toBe('advance');
    expect(player.pendingSeekStartedAtMs).toBeGreaterThan(staleStartedAt + 2_500);
    expect(player.pendingSeekTargetDebugUs).toBe(3_200_000);
  });

  it('reports the pending advance target time while playback warmup is in flight', async () => {
    const { player } = await makePlayerHarness();

    player.currentFrame = { timestamp: 0, close: vi.fn() };
    player.currentFrameTimestampUs = 0;

    player.advanceToTime(2);

    expect(player.getPendingSeekTime()).toBe(2);
  });

  it('caps paused precise seek feeding instead of queueing the whole GOP at once', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.seek(2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(60);
    expect(player.feedIndex).toBe(24);
    expect(player.pendingSeekFeedEndIndex).toBe(71);
  });

  it('reuses the paused seek pipeline for nearby forward scrubs', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.seek(2.2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(17);
    expect(player.sampleIndex).toBe(66);
    expect(player.feedIndex).toBe(78);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('reuses the paused seek pipeline for larger interactive forward scrubs without resetting', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.scrubSeek(2.8);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(84);
    expect(player.feedIndex).toBe(85);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('extends an in-flight paused seek forward without resetting the decoder', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 90;
    player.feedIndex = 84;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 90;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.seek(3.2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(96);
    expect(player.feedIndex).toBe(108);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('does not reuse a dead paused seek when no pending feed or decode backlog remains', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 60;
    player.feedIndex = 75;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.seekTargetUs = 2_466_667;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = null;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.seek(74 / 30);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(74);
    expect(player.feedIndex).toBe(24);
  });

  it('does not extend a stale strict paused seek after the reuse timeout', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 90;
    player.feedIndex = 96;
    player.currentFrame = { timestamp: 3_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 3_000_000;
    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 96;
    player.pendingSeekStartedAtMs = performance.now() - 500;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.seek(3.2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(96);
  });

  it('extends an in-flight interactive scrub seek further forward without resetting the decoder', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 84;
    player.feedIndex = 85;
    player.currentFrame = { timestamp: 2_800_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_800_000;
    player.seekTargetUs = 2_800_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 84;
    player.pendingSeekPreviewMode = 'interactive';
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.scrubSeek(4);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(119);
    expect(player.feedIndex).toBe(109);
    expect(player.pendingSeekFeedEndIndex).toBe(119);
  });

  it('keeps a long forward interactive scrub on the same pending seek pipeline without resetting', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.samples = makeSamples(300);
    player.sampleIndex = 84;
    player.feedIndex = 85;
    player.currentFrame = { timestamp: 2_800_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_800_000;
    player.seekTargetUs = 2_800_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 84;
    player.pendingSeekPreviewMode = 'interactive';
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.scrubSeek(6);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(180);
    expect(player.feedIndex).toBe(109);
    expect(player.pendingSeekFeedEndIndex).toBe(180);
  });

  it('keeps buffered future frames hot when pausing playback', async () => {
    const { player, decoder } = await makePlayerHarness();
    const futureFrameA = { timestamp: 2_033_333, close: vi.fn() };
    const futureFrameB = { timestamp: 2_066_667, close: vi.fn() };

    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 63;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.frameBuffer = [futureFrameA, futureFrameB];
    player.decoder.state = 'configured';

    player.pause();

    expect(player.frameBuffer).toEqual([futureFrameA, futureFrameB]);
    expect(futureFrameA.close).not.toHaveBeenCalled();
    expect(futureFrameB.close).not.toHaveBeenCalled();
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(player.hasBufferedFutureFrame()).toBe(true);
  });

  it('pre-rolls a couple of future frames when pausing without a hot future buffer', async () => {
    const { player, decoder } = await makePlayerHarness();

    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.decoder.state = 'configured';

    player.pause();

    expect(decoder.decode).toHaveBeenCalledTimes(2);
    expect(player.feedIndex).toBe(63);
    expect(player.hasBufferedFutureFrame()).toBe(false);
  });

  it('reuses a hot paused frame without resetting the decoder on resume', async () => {
    const { player, decoder } = await makePlayerHarness();
    const futureFrame = { timestamp: 2_033_333, close: vi.fn() };

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.frameBuffer = [futureFrame];
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(5);
    expect(player.feedIndex).toBe(66);
  });

  it('publishes a much closer buffered future frame during playback startup warmup', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 2_000_000, close: vi.fn() };
    const closerFutureFrame = { timestamp: 2_166_667, close: vi.fn() };
    const onFrame = vi.fn();

    player.onFrame = onFrame;
    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 69;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 2_000_000;
    player.frameBuffer = [closerFutureFrame];
    player.playbackStartupWarmupStartedAtMs = performance.now();
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2.3);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(player.currentFrame).toBe(closerFutureFrame);
    expect(player.currentFrameTimestampUs).toBe(2_166_667);
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(closerFutureFrame);
  });

  it('keeps blocking startup frames that are still too far from the playback target', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 2_000_000, close: vi.fn() };
    const tooFarFutureFrame = { timestamp: 2_700_000, close: vi.fn() };

    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 69;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 2_000_000;
    player.frameBuffer = [tooFarFutureFrame];
    player.playbackStartupWarmupStartedAtMs = performance.now();
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2.3);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(player.currentFrame).toBe(staleFrame);
    expect(player.currentFrameTimestampUs).toBe(2_000_000);
    expect(staleFrame.close).not.toHaveBeenCalled();
    expect(tooFarFutureFrame.close).not.toHaveBeenCalled();
  });

  it('keeps hot resume reset-free and feeds a full lookahead from the current feed position when no future frame is buffered', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(10);
    expect(player.feedIndex).toBe(71);
    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
  });

  it('waits for a fresh paused seek near the playback target instead of replacing it immediately on resume', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.currentFrame = { timestamp: 2_066_667, close: vi.fn() };
    player.currentFrameTimestampUs = 2_066_667;
    player.seekTargetUs = 2_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 60;
    player.pendingSeekStartedAtMs = performance.now();
    player.trackedDecodeQueueSize = 6;
    decoder.decodeQueueSize = 6;

    player.advanceToTime(2);

    expect(player._isPlaying).toBe(false);
    expect(player.pendingSeekKind).toBe('seek');
    expect(player.seekTargetUs).toBe(2_000_000);
    expect(decoder.reset).not.toHaveBeenCalled();
  });

  it('does not wait on resume for a paused seek when the displayed frame is wildly stale', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 3_900_000, close: vi.fn() };

    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 3_900_000;
    player.seekTargetUs = 2_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 60;
    player.pendingSeekStartedAtMs = performance.now();
    player.trackedDecodeQueueSize = 6;
    decoder.decodeQueueSize = 6;

    player.advanceToTime(2);

    expect(player._isPlaying).toBe(true);
    expect(player.pendingSeekKind).toBe('advance');
    expect(player.seekTargetUs).toBeNull();
    expect(player.currentFrame).toBeNull();
    expect(player.currentFrameTimestampUs).toBeNull();
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(decoder.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the closest paused-seek fallback visible when resume replaces a stale strict seek', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 3_900_000, close: vi.fn() };
    const fallbackFrame = { timestamp: 2_133_333, close: vi.fn() };

    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 3_900_000;
    player.seekTargetUs = 2_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.pendingSeekPreviewMode = 'strict';
    player.pendingSeekFeedEndIndex = null;
    player.pendingSeekFallbackFrame = fallbackFrame;
    player.pendingSeekFallbackDiffUs = 133_333;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(2);

    expect(player._isPlaying).toBe(true);
    expect(player.pendingSeekKind).toBe('advance');
    expect(player.seekTargetUs).toBeNull();
    expect(player.currentFrame).toBe(fallbackFrame);
    expect(player.currentFrameTimestampUs).toBe(2_133_333);
    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(fallbackFrame.close).not.toHaveBeenCalled();
    expect(decoder.reset).toHaveBeenCalledTimes(1);
  });

  it('reuses a buffered hot paused frame when only tracked seek backlog is stale', async () => {
    const { player, decoder } = await makePlayerHarness();
    const futureFrame = { timestamp: 2_033_333, close: vi.fn() };

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.frameBuffer = [futureFrame];
    player.trackedDecodeQueueSize = 145;
    decoder.decodeQueueSize = 5;

    player.advanceToTime(2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(player.feedIndex).toBe(61);
    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
    expect(player.trackedDecodeQueueSize).toBe(5);
  });

  it('still restarts playback when the actual decoder queue is heavily backlogged', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.trackedDecodeQueueSize = 145;
    decoder.decodeQueueSize = 48;

    player.advanceToTime(2);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.feedIndex).toBe(24);
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);
    expect(player.trackedDecodeQueueSize).toBe(24);
  });

  it('publishes closer traversal frames during interactive scrub seeks', async () => {
    const { player } = await makePlayerHarness();
    const previousFrame = { timestamp: 2_000_000, close: vi.fn() };
    const traversalFrame = { timestamp: 2_200_000, close: vi.fn() };

    player.currentFrame = previousFrame;
    player.currentFrameTimestampUs = 2_000_000;

    player.scrubSeek(3);
    player.handleDecodedFrame(traversalFrame);

    expect(player.currentFrame).toBe(traversalFrame);
    expect(player.currentFrameTimestampUs).toBe(2_200_000);
    expect(player.getPendingSeekTime()).toBe(3);
    expect(previousFrame.close).toHaveBeenCalledTimes(1);
    expect(traversalFrame.close).not.toHaveBeenCalled();
  });

  it('holds far-behind traversal frames briefly during interactive scrub to stay closer to the cursor', async () => {
    const { player } = await makePlayerHarness();
    const previousFrame = { timestamp: 2_200_000, close: vi.fn() };
    const farTraversalFrame = { timestamp: 2_300_000, close: vi.fn() };

    player.currentFrame = previousFrame;
    player.currentFrameTimestampUs = 2_200_000;
    player.lastInteractivePreviewPublishAtMs = performance.now();

    player.scrubSeek(3);
    player.handleDecodedFrame(farTraversalFrame);

    expect(player.currentFrame).toBe(previousFrame);
    expect(player.currentFrameTimestampUs).toBe(2_200_000);
    expect(player.getPendingSeekTime()).toBe(3);
    expect(previousFrame.close).not.toHaveBeenCalled();
    expect(farTraversalFrame.close).toHaveBeenCalledTimes(1);
  });

  it('still publishes recent interactive scrub frames once they are near the current target', async () => {
    const { player } = await makePlayerHarness();
    const previousFrame = { timestamp: 2_800_000, close: vi.fn() };
    const nearTargetFrame = { timestamp: 2_933_333, close: vi.fn() };

    player.currentFrame = previousFrame;
    player.currentFrameTimestampUs = 2_800_000;
    player.lastInteractivePreviewPublishAtMs = performance.now();

    player.scrubSeek(3);
    player.handleDecodedFrame(nearTargetFrame);

    expect(player.currentFrame).toBe(nearTargetFrame);
    expect(player.currentFrameTimestampUs).toBe(2_933_333);
    expect(player.getPendingSeekTime()).toBe(3);
    expect(previousFrame.close).toHaveBeenCalledTimes(1);
    expect(nearTargetFrame.close).not.toHaveBeenCalled();
  });

  it('keeps strict paused seeks on the last stable frame until the target resolves', async () => {
    const { player } = await makePlayerHarness();
    const previousFrame = { timestamp: 2_000_000, close: vi.fn() };
    const traversalFrame = { timestamp: 2_200_000, close: vi.fn() };

    player.currentFrame = previousFrame;
    player.currentFrameTimestampUs = 2_000_000;

    player.seek(3);
    player.handleDecodedFrame(traversalFrame);

    expect(player.currentFrame).toBe(previousFrame);
    expect(player.currentFrameTimestampUs).toBe(2_000_000);
    expect(player.getPendingSeekTime()).toBe(3);
    expect(previousFrame.close).not.toHaveBeenCalled();
    expect(traversalFrame.close).not.toHaveBeenCalled();
    expect(player.pendingSeekFallbackFrame).toBe(traversalFrame);
  });

  it('keeps feeding a strict paused seek after storing a closer fallback frame', async () => {
    const { player, decoder } = await makePlayerHarness();
    const previousFrame = { timestamp: 2_000_000, close: vi.fn() };
    const traversalFrame = { timestamp: 2_200_000, close: vi.fn() };

    player.currentFrame = previousFrame;
    player.currentFrameTimestampUs = 2_000_000;
    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekPreviewMode = 'strict';
    player.pendingSeekFeedEndIndex = 61;
    player.feedIndex = 61;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.handleDecodedFrame(traversalFrame);

    expect(player.pendingSeekFallbackFrame).toBe(traversalFrame);
    expect(decoder.decode).toHaveBeenCalledTimes(1);
    expect(player.feedIndex).toBe(62);
  });

  it('does not consume pending seek samples when decoder feed throws during strict seek refill', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekPreviewMode = 'strict';
    player.pendingSeekFeedEndIndex = 61;
    player.feedIndex = 61;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;
    decoder.decode.mockImplementationOnce(() => {
      throw new Error('flush pending');
    });

    player.feedPendingSeekSamples('seek');

    expect(player.feedIndex).toBe(61);
    expect(player.pendingSeekFeedEndIndex).toBe(61);
  });

  it('retries pending strict seek feed after flush finishes with no queued work left', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 3_000_000;
    player.pendingSeekPreviewMode = 'strict';
    player.pendingSeekFeedEndIndex = 62;
    player.feedIndex = 61;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.flushStrictPausedSeek();
    await Promise.resolve();
    await Promise.resolve();

    expect(decoder.flush).toHaveBeenCalledTimes(2);
    expect(decoder.decode).toHaveBeenCalledTimes(2);
    expect(player.feedIndex).toBe(63);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('flushes strict paused seeks so stalled decoders can publish the requested frame', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.seek(3);

    expect(decoder.flush).toHaveBeenCalledTimes(1);
  });

  it('publishes the closest decoded frame after a strict seek flush when no exact frame resolves', async () => {
    const { player, decoder } = await makePlayerHarness();
    const fallbackFrame = { timestamp: 2_966_667, close: vi.fn() };
    const onFrame = vi.fn();

    player.onFrame = onFrame;
    player.seekTargetUs = 3_000_000;
    player.seekTargetToleranceUs = 10_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 3_000_000;
    player.pendingSeekPreviewMode = 'strict';
    player.pendingSeekFeedEndIndex = null;
    player.pendingSeekFallbackFrame = fallbackFrame;
    player.pendingSeekFallbackDiffUs = 33_333;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.flushStrictPausedSeek();
    await Promise.resolve();
    await Promise.resolve();

    expect(decoder.flush).toHaveBeenCalledTimes(1);
    expect(player.currentFrame).toBe(fallbackFrame);
    expect(player.currentFrameTimestampUs).toBe(2_966_667);
    expect(player.seekTargetUs).toBeNull();
    expect(player.pendingSeekKind).toBeNull();
    expect(onFrame).toHaveBeenCalledWith(fallbackFrame);
  });

  it('does not flush every interactive scrub seek during drag updates', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.scrubSeek(3);

    expect(decoder.flush).not.toHaveBeenCalled();
  });
});
