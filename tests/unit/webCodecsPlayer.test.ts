import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';
import type { MP4VideoTrack, Sample } from '../../src/engine/webCodecsTypes';

vi.mock('mp4box', () => ({ default: {} }));

type WebCodecsPlayerModule = typeof import('../../src/engine/WebCodecsPlayer');
type MockVideoDecoder = ReturnType<typeof makeDecoder>;
type TestVideoFrame = {
  timestamp: number;
  close: ReturnType<typeof vi.fn>;
};
type WebCodecsPlayerTestAccess = WebCodecsPlayer & {
  useSimpleMode: boolean;
  ready: boolean;
  decoder: MockVideoDecoder;
  codecConfig: VideoDecoderConfig;
  videoTrack: Pick<MP4VideoTrack, 'timescale'>;
  samples: Sample[];
  frameRate: number;
  frameBuffer: TestVideoFrame[];
  sampleIndex: number;
  feedIndex: number;
  currentFrame: TestVideoFrame | null;
  currentFrameTimestampUs: number | null;
  pendingAdvanceSeekTargetIdx: number | null;
  pendingSeekFeedEndIndex: number | null;
  pendingSeekKind: 'seek' | 'advance' | null;
  pendingSeekStartedAtMs: number | null;
  pendingSeekTargetDebugUs: number | null;
  pendingSeekPreviewMode: 'strict' | 'interactive' | 'interactive-preroll';
  seekTargetUs: number | null;
  seekTargetToleranceUs: number;
  trackedDecodeQueueSize: number;
  ctsSortedSampleCount: number;
  ctsSorted: Array<{ idx: number; cts: number }>;
  _isPlaying: boolean;
  onFrame?: (frame: TestVideoFrame) => void;
  handleDecodedFrame: (frame: TestVideoFrame) => void;
  promoteBufferedFrameNearTime: (timeSeconds: number, maxFrameDelta?: number) => TestVideoFrame | null;
  decodeReverseWindowForTimeSeconds: (timeSeconds: number) => void;
};

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
  const player = new module.WebCodecsPlayer() as unknown as WebCodecsPlayerTestAccess;
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

  it('chooses a reverse decode target inside the current GOP', async () => {
    const { player } = await makePlayerHarness();
    player.samples = makeSamples(90).map((sample, index) => ({
      ...sample,
      is_sync: index % 30 === 0,
    }));

    expect(player.getReverseDecodeTargetTimeSeconds(0.6)).toBeCloseTo(29 / 30);
  });

  it('reports the reverse decode window from keyframe to capture target', async () => {
    const { player } = await makePlayerHarness();
    player.samples = makeSamples(120).map((sample, index) => ({
      ...sample,
      is_sync: index % 30 === 0,
    }));

    const window = player.getReverseDecodeWindowForTimeSeconds(2.6);
    expect(window?.targetTimeSeconds).toBeCloseTo(89 / 30);
    expect(window?.minTimeSeconds).toBeCloseTo(2);
    expect(window?.maxTimeSeconds).toBeCloseTo(89 / 30);
  });

  it('feeds a whole reverse decode window instead of stopping at the seek queue cap', async () => {
    const { player, decoder } = await makePlayerHarness();
    player.samples = makeSamples(120).map((sample, index) => ({
      ...sample,
      is_sync: index % 30 === 0,
    }));

    player.decodeReverseWindowForTimeSeconds(2.6);

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.configure).toHaveBeenCalledWith(player.codecConfig);
    expect(decoder.decode).toHaveBeenCalledTimes(41);
    expect(player.sampleIndex).toBe(89);
    expect(player.feedIndex).toBe(101);
    expect(player.trackedDecodeQueueSize).toBe(41);
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

  it('clears a stale advance target once decode coverage reaches the current stream target', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 10_933_333, close: vi.fn() };
    const recoveredFrame = { timestamp: 11_200_000, close: vi.fn() };
    const onFrame = vi.fn();

    player.samples = makeSamples(800);
    player.onFrame = onFrame;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = 10_933_333;
    player._isPlaying = true;
    player.sampleIndex = 336;
    player.feedIndex = 346;
    player.frameBuffer = [recoveredFrame];
    player.pendingAdvanceSeekTargetIdx = 329;
    player.pendingSeekKind = 'advance';
    player.pendingSeekStartedAtMs = performance.now() - 500;
    player.pendingSeekTargetDebugUs = 10_966_667;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.advanceToTime(11.2);

    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
    expect(player.pendingSeekKind).toBeNull();
    expect(player.currentFrame).toBe(recoveredFrame);
    expect(onFrame).toHaveBeenCalledWith(recoveredFrame);
  });

  it('continues feeding a pending worker stream startup without another advance seek', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.pendingAdvanceSeekTargetIdx = 60;
    player.pendingSeekKind = 'advance';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.feedIndex = 24;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.pumpWorkerStreamPlayback();

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.feedIndex).toBe(48);
  });

  it('takes the next worker stream frame from the queue without calling advanceToTime', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    const queuedFrame = { timestamp: 2_033_333, close: vi.fn() };
    const onFrame = vi.fn();

    player.onFrame = onFrame;
    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 70;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [queuedFrame];
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    const frame = player.takeWorkerStreamPlaybackFrame(2 + 1 / 30, 2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(frame).toBe(queuedFrame);
    expect(player.currentFrame).toBe(queuedFrame);
    expect(currentFrame.close).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(queuedFrame);
  });

  it('holds a future 30fps worker stream frame until a 60fps target reaches its timestamp', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    const futureThirtyFpsFrame = { timestamp: 2_033_333, close: vi.fn() };

    player.onFrame = vi.fn();
    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 70;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [futureThirtyFpsFrame];
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    const heldFrame = player.takeWorkerStreamPlaybackFrame(2 + 1 / 60, 2);

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(heldFrame).toBeNull();
    expect(player.currentFrame).toBe(currentFrame);
    expect(futureThirtyFpsFrame.close).not.toHaveBeenCalled();
    expect(player.onFrame).not.toHaveBeenCalled();

    const advancedFrame = player.takeWorkerStreamPlaybackFrame(2 + 1 / 30, 2);

    expect(advancedFrame).toBe(futureThirtyFpsFrame);
    expect(player.currentFrame).toBe(futureThirtyFpsFrame);
    expect(currentFrame.close).toHaveBeenCalledTimes(1);
    expect(player.onFrame).toHaveBeenCalledWith(futureThirtyFpsFrame);
  });

  it('unsticks a stale worker stream startup target by presenting the latest queued frame not ahead of target', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    const olderQueuedFrame = { timestamp: 2_300_000, close: vi.fn() };
    const newestQueuedFrame = { timestamp: 2_500_000, close: vi.fn() };

    player._isPlaying = true;
    player.sampleIndex = 60;
    player.feedIndex = 90;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [olderQueuedFrame, newestQueuedFrame];
    player.pendingAdvanceSeekTargetIdx = 60;
    player.pendingSeekKind = 'advance';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    const frame = player.takeWorkerStreamPlaybackFrame(3, 2);

    expect(frame).toBe(newestQueuedFrame);
    expect(player.pendingAdvanceSeekTargetIdx).toBeNull();
    expect(player.pendingSeekKind).toBeNull();
    expect(olderQueuedFrame.close).toHaveBeenCalledTimes(1);
    expect(newestQueuedFrame.close).not.toHaveBeenCalled();
  });

  it('starts a hot worker stream resume without resetting the decoder', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    const queuedFrame = { timestamp: 2_033_333, close: vi.fn() };

    player.sampleIndex = 60;
    player.feedIndex = 61;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [queuedFrame];
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.startWorkerStreamPlayback(2);

    expect(player._isPlaying).toBe(true);
    expect(decoder.reset).not.toHaveBeenCalled();
  });

  it('replaces a pending paused seek when a worker stream force-rebases', async () => {
    const { player } = await makePlayerHarness();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };

    player.sampleIndex = 60;
    player.feedIndex = 60;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.seekTargetUs = 2_000_000;
    player.seekTargetToleranceUs = 1_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_000_000;
    player.pendingSeekFeedEndIndex = 72;

    player.startWorkerStreamPlayback(2, { forceRebase: true });

    expect(player._isPlaying).toBe(true);
    expect(player.pendingSeekKind).toBeNull();
    expect(player.seekTargetUs).toBeNull();
  });

  it('resets decoder backlog when a worker stream force-rebase explicitly requests it', async () => {
    const { player, decoder } = await makePlayerHarness();
    const staleFrame = { timestamp: 5_000_000, close: vi.fn() };

    player.sampleIndex = 90;
    player.feedIndex = 100;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = staleFrame.timestamp;
    player.seekTargetUs = 5_000_000;
    player.seekTargetToleranceUs = 1_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 5_000_000;
    player.pendingSeekFeedEndIndex = 110;
    player.trackedDecodeQueueSize = 12;
    decoder.decodeQueueSize = 12;

    player.startWorkerStreamPlayback(2, { forceRebase: true, resetDecoder: true });

    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.configure).toHaveBeenCalledWith(player.codecConfig);
    expect(player.seekTargetUs).toBeNull();
    expect(player.pendingSeekFeedEndIndex).toBeNull();
    expect(player.pendingSeekKind).toBe('advance');
    expect(player.pendingAdvanceSeekTargetIdx).toBe(60);
    expect(player.sampleIndex).toBe(60);
    expect(player.feedIndex).toBeGreaterThan(0);
    expect(player.trackedDecodeQueueSize).toBeGreaterThan(0);
    expect(player._isPlaying).toBe(true);
  });

  it('clears a stale displayed frame when force-rebasing a still-marked-playing worker stream', async () => {
    const { player } = await makePlayerHarness();
    const staleFrame = { timestamp: 5_000_000, close: vi.fn() };

    player._isPlaying = true;
    player.sampleIndex = 150;
    player.feedIndex = 160;
    player.currentFrame = staleFrame;
    player.currentFrameTimestampUs = staleFrame.timestamp;

    player.startWorkerStreamPlayback(0, { forceRebase: true });

    expect(staleFrame.close).toHaveBeenCalledTimes(1);
    expect(player.currentFrame).toBeNull();
    expect(player.currentFrameTimestampUs).toBeNull();
    expect(player._isPlaying).toBe(true);
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
    // feedEndIndex includes reorder lookahead (target + max(FEED_LOOKAHEAD, ceil(fps*0.35)))
    expect(player.pendingSeekFeedEndIndex).toBe(71);
  });

  it('snaps paused seek resolution to the nearest sample timestamp', async () => {
    const { player } = await makePlayerHarness();

    player.seek(2.02);

    const expectedTargetUs = (61 * 1_000_000) / 30;
    expect(player.sampleIndex).toBe(61);
    expect(player.seekTargetUs).toBeCloseTo(expectedTargetUs, 3);
    expect(player.getPendingSeekTime()).toBeCloseTo(61 / 30, 6);
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
    // Feeds from 61 to 77 (target 66 + 11 reorder lookahead) = 17 samples
    expect(decoder.decode).toHaveBeenCalledTimes(17);
    expect(player.sampleIndex).toBe(66);
    expect(player.feedIndex).toBe(78);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('promotes a buffered paused target frame instead of waiting for new decoder output', async () => {
    const { player, decoder } = await makePlayerHarness();
    const onFrame = vi.fn();
    const currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    const targetFrame = { timestamp: 2_033_333, close: vi.fn() };
    const laterFrame = { timestamp: 2_066_667, close: vi.fn() };

    player.sampleIndex = 60;
    player.feedIndex = 64;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [targetFrame, laterFrame];
    player.trackedDecodeQueueSize = 0;
    player.decoder.decodeQueueSize = 0;
    player.onFrame = onFrame;

    player.seek(2 + 1 / 30, { previewMode: 'interactive-preroll' });

    expect(decoder.reset).not.toHaveBeenCalled();
    expect(player.currentFrame).toBe(targetFrame);
    expect(player.currentFrameTimestampUs).toBe(targetFrame.timestamp);
    expect(player.frameBuffer).toContain(laterFrame);
    expect(currentFrame.close).toHaveBeenCalledTimes(1);
    expect(targetFrame.close).not.toHaveBeenCalled();
    expect(laterFrame.close).not.toHaveBeenCalled();
    expect(player.pendingSeekKind).toBeNull();
    expect(onFrame).toHaveBeenCalledWith(targetFrame);
  });

  it('promotes buffered frames for paused worker seek reads', async () => {
    const { player } = await makePlayerHarness();
    const onFrame = vi.fn();
    const currentFrame = { timestamp: 4_933_333, close: vi.fn() };
    const nearFrame = { timestamp: 4_966_667, close: vi.fn() };
    const targetFrame = { timestamp: 5_000_000, close: vi.fn() };

    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = currentFrame.timestamp;
    player.frameBuffer = [nearFrame, targetFrame];
    player.onFrame = onFrame;

    const promoted = player.promoteBufferedFrameNearTime(5);

    expect(promoted).toBe(targetFrame);
    expect(player.currentFrame).toBe(targetFrame);
    expect(player.currentFrameTimestampUs).toBe(5_000_000);
    expect(currentFrame.close).toHaveBeenCalledTimes(1);
    expect(nearFrame.close).toHaveBeenCalledTimes(1);
    expect(targetFrame.close).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledWith(targetFrame);
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

  it('feeds reorder lookahead for interactive preroll seeks without strict flush', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.seek(2, { previewMode: 'interactive-preroll' });

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.flush).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(60);
    expect(player.feedIndex).toBe(24);
    expect(player.pendingSeekPreviewMode).toBe('interactive-preroll');
    expect(player.pendingSeekFeedEndIndex).toBe(71);
  });

  it('resolves an interactive paused seek when its frames arrive after playback starts', async () => {
    const { player } = await makePlayerHarness();
    const onFrame = vi.fn();
    const frame = { timestamp: 2_016_667, close: vi.fn() };

    player._isPlaying = true;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.seekTargetUs = 2_020_000;
    player.seekTargetToleranceUs = 2_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_020_000;
    player.pendingSeekPreviewMode = 'interactive-preroll';
    player.onFrame = onFrame;

    player.handleDecodedFrame(frame);

    expect(player.currentFrame).toBe(frame);
    expect(player.seekTargetUs).toBeNull();
    expect(player.pendingSeekKind).toBeNull();
    expect(player.frameBuffer).toHaveLength(0);
    expect(onFrame).toHaveBeenCalledWith(frame);
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
    // Feeds from 84 to 107 (target 96 + 11 reorder lookahead) = 24 samples (hits queue cap)
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(96);
    expect(player.feedIndex).toBe(108);
    expect(player.pendingSeekFeedEndIndex).toBeNull();
  });

  it('resets an in-flight paused seek instead of extending when the decode queue is full', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.sampleIndex = 90;
    player.feedIndex = 84;
    player.currentFrame = { timestamp: 2_000_000, close: vi.fn() };
    player.currentFrameTimestampUs = 2_000_000;
    player.seekTargetUs = 3_000_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekFeedEndIndex = 90;
    player.pendingSeekPreviewMode = 'interactive-preroll';
    player.trackedDecodeQueueSize = 24;
    decoder.decodeQueueSize = 24;

    player.seek(3.2, { previewMode: 'interactive-preroll' });

    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.configure).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(24);
    expect(player.sampleIndex).toBe(96);
    expect(player.feedIndex).toBe(24);
    expect(player.pendingSeekFeedEndIndex).toBe(107);
  });

  it('decrements tracked queue size when decoder output arrives with a stale reported queue', async () => {
    const { player, decoder } = await makePlayerHarness();
    const frame = { timestamp: 3_000_000, close: vi.fn() };

    player._isPlaying = true;
    player.trackedDecodeQueueSize = 24;
    decoder.decodeQueueSize = 24;

    player.handleDecodedFrame(frame);

    expect(player.trackedDecodeQueueSize).toBe(23);
    expect(player.frameBuffer).toEqual([frame]);
  });

  it('resolves a paused seek immediately when the displayed frame already matches the target', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 3_000_000, close: vi.fn() };
    const onFrame = vi.fn();

    player.sampleIndex = 90;
    player.feedIndex = 84;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = 3_000_000;
    player.seekTargetUs = 2_800_000;
    player.pendingSeekKind = 'seek';
    player.pendingSeekStartedAtMs = performance.now();
    player.pendingSeekTargetDebugUs = 2_800_000;
    player.pendingSeekFeedEndIndex = 90;
    player.pendingSeekPreviewMode = 'interactive-preroll';
    player.trackedDecodeQueueSize = 24;
    decoder.decodeQueueSize = 24;
    player.onFrame = onFrame;

    player.seek(3, { previewMode: 'interactive-preroll' });

    expect(player.pendingSeekKind).toBeNull();
    expect(player.pendingSeekFeedEndIndex).toBeNull();
    expect(player.getPendingSeekTime()).toBe(3);
    expect(decoder.reset).toHaveBeenCalledTimes(1);
    expect(decoder.configure).toHaveBeenCalledTimes(1);
    expect(decoder.decode).toHaveBeenCalledTimes(5);
    expect(player.trackedDecodeQueueSize).toBe(5);
    expect(player.currentFrame).toBe(currentFrame);
    expect(currentFrame.close).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledWith(currentFrame);
  });

  it('does not resolve a one-frame paused seek from the previous displayed frame', async () => {
    const { player, decoder } = await makePlayerHarness();
    const currentFrame = { timestamp: 3_000_000, close: vi.fn() };

    player.sampleIndex = 90;
    player.feedIndex = 91;
    player.currentFrame = currentFrame;
    player.currentFrameTimestampUs = 3_000_000;
    player.trackedDecodeQueueSize = 0;
    decoder.decodeQueueSize = 0;

    player.seek(3 + 1 / 30, { previewMode: 'interactive-preroll' });

    expect(player.pendingSeekKind).toBe('seek');
    expect(player.currentFrame).toBe(currentFrame);
    expect(decoder.reset).not.toHaveBeenCalled();
    expect(decoder.decode).toHaveBeenCalled();
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
    const { player } = await makePlayerHarness();
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
    // startPausedPreroll feeds additional samples beyond the hot buffer
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

    // startPausedPreroll feeds up to 6 frames ahead, limited by FEED_QUEUE_TARGET (5)
    expect(decoder.decode).toHaveBeenCalledTimes(5);
    expect(player.feedIndex).toBe(66);
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

  it('flushes strict paused seeks so stalled decoders can publish the requested frame', async () => {
    const { player, decoder } = await makePlayerHarness();

    // Seek to a nearby position so all GOP samples fit within
    // ADVANCE_SEEK_QUEUE_TARGET (24) and flush fires immediately.
    player.seek(0.1);

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
    // seekTargetUs is re-set by holdCurrentFrameDuringPause after fallback publish
    expect(player.seekTargetUs).toBe(2_966_667);
    expect(player.pendingSeekKind).toBeNull();
    expect(onFrame).toHaveBeenCalledWith(fallbackFrame);
  });

  it('flushes seekAsync only after the target GOP has been decoded', async () => {
    const { player, decoder } = await makePlayerHarness();

    await player.seekAsync(3);

    expect(decoder.decode).toHaveBeenCalledTimes(91);
    expect(decoder.flush).toHaveBeenCalledTimes(1);
    expect(player.sampleIndex).toBe(90);
    expect(player.feedIndex).toBe(91);
  });

  it('does not flush every interactive scrub seek during drag updates', async () => {
    const { player, decoder } = await makePlayerHarness();

    player.scrubSeek(3);

    expect(decoder.flush).not.toHaveBeenCalled();
  });
});
