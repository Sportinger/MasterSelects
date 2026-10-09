import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderLoop } from '../../src/engine/render/RenderLoop';

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

type RenderLoopTestAccess = {
  isRunning: boolean;
  lastSuccessfulRender: number;
  isIdle: boolean;
  renderRequested: boolean;
  lastActivityTime: number;
  hasActiveVideo: boolean;
  isPlaying: boolean;
  isScrubbing: boolean;
  continuousRender: boolean;
  idleSuppressed: boolean;
  checkHealth: () => void;
  stop: () => void;
};

function createLoop() {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(performance, 'now').mockReturnValue(10_000);
  const performanceStats = {
    recordRafGap: vi.fn(),
    resetPerSecondCounters: vi.fn(),
  } as unknown as ConstructorParameters<typeof RenderLoop>[0];
  const loop = new RenderLoop(
    performanceStats,
    {
      isRecovering: vi.fn(() => false),
      isExporting: vi.fn(() => false),
      onRender: vi.fn(),
    }
  );
  const internal = loop as unknown as RenderLoopTestAccess;
  internal.isRunning = true;
  internal.lastSuccessfulRender = performance.now() - 5000;
  internal.lastActivityTime = performance.now() - 5000;
  internal.isIdle = false;
  internal.renderRequested = false;
  internal.hasActiveVideo = false;
  internal.isPlaying = false;
  internal.isScrubbing = false;
  internal.continuousRender = false;
  internal.idleSuppressed = false;
  return internal;
}

afterEach(() => vi.restoreAllMocks());

describe('RenderLoop watchdog', () => {
  it('presents asynchronously decoded playback frames without postponing the next clock sample', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onRender = vi.fn();
    const loop = new RenderLoop({
      recordRafGap: vi.fn(),
      resetPerSecondCounters: vi.fn(),
      setTargetFps: vi.fn(),
    } as unknown as ConstructorParameters<typeof RenderLoop>[0], {
      isRecovering: () => false,
      isExporting: () => false,
      onRender,
    });
    const tick = (timestamp: number) => {
      const callback = callbacks.shift();
      expect(callback).toBeDefined();
      callback!(timestamp);
    };
    try {
      loop.start();
      loop.setIsPlaying(true);
      loop.setVisualTargetFps(25);
      tick(1000);
      tick(1008);
      expect(onRender).toHaveBeenCalledTimes(1);

      loop.requestNewFrameRender();
      tick(1010);
      expect(onRender).toHaveBeenCalledTimes(1);
      tick(1016);
      expect(onRender).toHaveBeenCalledTimes(2);
      expect(onRender).toHaveBeenLastCalledWith({ newFrameReady: true });

      // The early presentation must leave the original 1020ms deadline intact.
      tick(1033);
      expect(onRender).toHaveBeenCalledTimes(3);
      expect(onRender).toHaveBeenLastCalledWith({ newFrameReady: false });
      tick(1036);
      expect(onRender).toHaveBeenCalledTimes(3);
      // Keep coalescing notifications on a 120Hz display at the 60Hz ceiling.
      for (let frame = 1; frame <= 12; frame += 1) {
        loop.requestNewFrameRender();
        tick(1033 + frame * (1000 / 120));
      }
      expect(onRender).toHaveBeenCalledTimes(9);
    } finally {
      loop.stop();
      vi.unstubAllGlobals();
    }
  });

  it('samples playback above the visual target while counting only accepted renders', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    const performanceStats = {
      recordRafGap: vi.fn(),
      resetPerSecondCounters: vi.fn(),
      setTargetFps: vi.fn(),
    } as unknown as ConstructorParameters<typeof RenderLoop>[0];
    let currentTimestamp = 0;
    let lastVisualFrame = -1;
    const onRender = vi.fn(() => {
      const visualFrame = Math.floor(((currentTimestamp - 1000) / 1000) * 30 + 1e-6);
      if (visualFrame === lastVisualFrame) return false;
      lastVisualFrame = visualFrame;
      return true;
    });
    const loop = new RenderLoop(
      performanceStats,
      {
        isRecovering: vi.fn(() => false),
        isExporting: vi.fn(() => false),
        onRender,
      }
    );

    const runNextRaf = (timestamp: number) => {
      const callback = rafCallbacks.shift();
      expect(callback).toBeDefined();
      currentTimestamp = timestamp;
      callback?.(timestamp);
    };

    try {
      loop.start();
      loop.setIsPlaying(true);
      loop.setVisualTargetFps(30);

      runNextRaf(1000);
      expect(onRender).toHaveBeenCalledTimes(1);

      runNextRaf(1000 + 1000 / 60);
      expect(onRender).toHaveBeenCalledTimes(2);
      expect(loop.getRenderCount()).toBe(1);

      runNextRaf(1000 + 2000 / 60);
      expect(onRender).toHaveBeenCalledTimes(3);
      expect(loop.getRenderCount()).toBe(2);
      expect(performanceStats.recordRafGap).toHaveBeenLastCalledWith(
        expect.closeTo(1000 / 30, 6),
        false,
      );
    } finally {
      loop.stop();
      vi.unstubAllGlobals();
    }
  });

  it('does not skip 24fps source frames when the source clock is phase-shifted from 60Hz RAF', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const performanceStats = {
      recordRafGap: vi.fn(),
      resetPerSecondCounters: vi.fn(),
      setTargetFps: vi.fn(),
    } as unknown as ConstructorParameters<typeof RenderLoop>[0];
    let currentTimestamp = 0;
    let lastVisualFrame = -1;
    const acceptedFrames: number[] = [];
    const onRender = vi.fn(() => {
      // Playback begins 35ms into a 24fps source frame. A source-rate-only
      // limiter samples frame 0, 2, 2, 4... on a 60Hz clock.
      const visualFrame = Math.floor(((currentTimestamp - 1000 + 35) / 1000) * 24 + 1e-6);
      if (visualFrame === lastVisualFrame) return false;
      lastVisualFrame = visualFrame;
      acceptedFrames.push(visualFrame);
      return true;
    });
    const loop = new RenderLoop(performanceStats, {
      isRecovering: vi.fn(() => false),
      isExporting: vi.fn(() => false),
      onRender,
    });

    try {
      loop.start();
      loop.setIsPlaying(true);
      loop.setVisualTargetFps(24);

      for (let frame = 0; frame < 60; frame += 1) {
        const callback = rafCallbacks.shift();
        expect(callback).toBeDefined();
        currentTimestamp = 1000 + frame * (1000 / 60);
        callback?.(currentTimestamp);
      }

      expect(onRender).toHaveBeenCalledTimes(48);
      expect(acceptedFrames.length).toBeGreaterThanOrEqual(24);
      expect(acceptedFrames.slice(1).every((value, index) => value - acceptedFrames[index] === 1)).toBe(true);
      expect(loop.getRenderCount()).toBe(acceptedFrames.length);
    } finally {
      loop.stop();
      vi.unstubAllGlobals();
    }
  });

  it('renders paused text/image timelines only once per request, including periodic UI wakes', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const onRender = vi.fn();
    const loop = new RenderLoop({ recordRafGap: vi.fn(), resetPerSecondCounters: vi.fn() } as never,
      { isRecovering: () => false, isExporting: () => false, onRender });
    const tick = () => { now += 1000 / 60; callbacks.shift()!(now); };
    try {
      loop.start();
      tick();
      for (let i = 0; i < 120; i++) tick();
      expect(onRender).toHaveBeenCalledTimes(1);
      expect(loop.getIsIdle()).toBe(true);
      for (let i = 0; i < 8; i++) {
        loop.requestRender();
        for (let frame = 0; frame < 15; frame++) tick();
      }
      expect(onRender).toHaveBeenCalledTimes(9);
      // Changes published during a draw must get their own follow-up frame.
      onRender.mockImplementationOnce(() => loop.requestRender());
      loop.requestRender(); tick(); tick(); tick();
      expect(onRender).toHaveBeenCalledTimes(11);
      loop.setContinuousRender(true);
      for (let i = 0; i < 10; i++) tick();
      expect(onRender).toHaveBeenCalledTimes(21);
      loop.setContinuousRender(false); tick();
      expect(loop.getIsIdle()).toBe(true);
    } finally { loop.stop(); vi.unstubAllGlobals(); }
  });

  it('allows a paused active video preview hold to enter idle after the timeout', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    const performanceStats = {
      recordRafGap: vi.fn(),
      resetPerSecondCounters: vi.fn(),
    } as unknown as ConstructorParameters<typeof RenderLoop>[0];
    const onRender = vi.fn();
    const loop = new RenderLoop(
      performanceStats,
      {
        isRecovering: vi.fn(() => false),
        isExporting: vi.fn(() => false),
        onRender,
      }
    );

    try {
      loop.start();
      loop.setHasActiveVideo(true);

      const callback = rafCallbacks.shift();
      expect(callback).toBeDefined();
      callback?.(performance.now() + 1100);

      expect(loop.getIsIdle()).toBe(true);
      expect(onRender).not.toHaveBeenCalled();
    } finally {
      loop.stop();
      vi.unstubAllGlobals();
    }
  });

  it('settles into idle instead of forcing paused inactive timelines awake', () => {
    const loop = createLoop();
    loop.hasActiveVideo = true;

    loop.checkHealth();

    expect(loop.isIdle).toBe(true);
    expect(loop.renderRequested).toBe(false);
  });

  it('still wakes the loop when playback is active and rendering stalls', () => {
    const loop = createLoop();
    loop.isPlaying = true;

    try {
      loop.checkHealth();

      expect(loop.isIdle).toBe(false);
      expect(loop.renderRequested).toBe(true);
      expect(loop.lastActivityTime).toBeGreaterThan(performance.now() - 1000);
    } finally {
      loop.stop();
    }
  });
});
