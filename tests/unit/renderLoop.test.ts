import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderLoop } from '../../src/engine/render/RenderLoop';

const loopLog = vi.hoisted(() => ({ warn: [] as unknown[][] }));
vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: () => ({
      debug: () => undefined,
      info: () => undefined,
      warn: (...args: unknown[]) => { loopLog.warn.push(args); },
      error: () => undefined,
    }),
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
  start: () => void;
  animationId: number | null;
  lastRafTick: number;
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
  it('does not count pause time or a hidden-tab interval as dropped playback frames', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const recordRafGap = vi.fn();
    const loop = new RenderLoop({ recordRafGap, resetPerSecondCounters: vi.fn() } as never,
      { onRender: () => true, isRecovering: () => false, isExporting: () => false });
    const tick = (at: number) => callbacks.shift()!(at);
    try {
      loop.start(); loop.setIsPlaying(true);
      tick(1000); tick(1040);
      expect(recordRafGap).toHaveBeenLastCalledWith(40, false);
      loop.setIsPlaying(false); tick(2000); tick(62_000);
      loop.setIsPlaying(true); tick(62_100); tick(62_140);
      hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
      hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
      tick(120_100); tick(120_140);
      expect(recordRafGap.mock.calls.map(args => args[0])).toEqual([40, 40, 40]);
      loop.stop(); callbacks.length = 0; loop.start(); tick(180_100); tick(180_140);
      expect(recordRafGap.mock.calls.map(args => args[0])).toEqual([40, 40, 40, 40]);
    } finally { loop.stop(); vi.unstubAllGlobals(); }
  });
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

  it('keeps calling the render callback while playback crosses a gap and renders the next clip at once', () => {
    // Owner report 2026-10-29: the loop went idle in a gap (no visual clip, no active video) and only an
    // unrelated wake noticed that the playhead had entered the next clip, so it stayed black for seconds.
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
      loop.setTimelineVisualDemand(false);
      loop.setHasActiveVideo(false);
      loop.setIsPlaying(true);
      for (let i = 0; i < 90; i++) tick();
      // One callback per display frame through 1.5 s of gap (no lead reported: treated as near), never idle.
      expect(onRender.mock.calls.length).toBeGreaterThanOrEqual(88);
      expect(loop.getIsIdle()).toBe(false);
      // The callback reports the next clip; the very next frame renders it.
      const before = onRender.mock.calls.length;
      loop.setTimelineVisualDemand(true);
      tick();
      expect(onRender.mock.calls.length).toBe(before + 1);
      // Paused in a gap the loop still idles (the static-preview rule stays).
      loop.setTimelineVisualDemand(false);
      loop.setIsPlaying(false);
      for (let i = 0; i < 120; i++) tick();
      const paused = onRender.mock.calls.length;
      for (let i = 0; i < 60; i++) tick();
      expect(onRender.mock.calls.length).toBe(paused);
      expect(loop.getIsIdle()).toBe(true);
    } finally { loop.stop(); vi.unstubAllGlobals(); }
  });

  it('runs a gap far from the next clip at a few callbacks per second and at display rate shortly before it', () => {
    // Review 2026-10-29: audio-only playback or a long gap at the end ran the full callback and video
    // sync at display rate. Only the 2 s before the next clip need it (warmup and pre-roll there).
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const clipEntryAt = 6000;
    const renderTimes: number[] = [];
    // Like the engine callback in a gap: report the wall-clock lead to the next clip.
    const onRender = vi.fn(() => { renderTimes.push(now); loop.setPlaybackGapLeadMs(clipEntryAt - now); });
    const loop = new RenderLoop({ recordRafGap: vi.fn(), resetPerSecondCounters: vi.fn() } as never,
      { isRecovering: () => false, isExporting: () => false, onRender });
    const tick = () => { now += 1000 / 60; callbacks.shift()!(now); };
    const rendersBetween = (from: number, to: number) => renderTimes.filter((time) => time > from && time <= to).length;
    try {
      loop.start();
      loop.setTimelineVisualDemand(false);
      loop.setHasActiveVideo(false);
      loop.setIsPlaying(true);
      while (now < 5900) tick();
      // The gap's first frame runs at once (lead unknown), then 8 Hz while the clip is further than 2 s ahead.
      expect(renderTimes[0]).toBeLessThan(20);
      expect(rendersBetween(500, 3500)).toBeGreaterThanOrEqual(22);
      expect(rendersBetween(500, 3500)).toBeLessThanOrEqual(26);
      // From 2 s before the clip one callback per display frame.
      expect(rendersBetween(4200, 5900)).toBeGreaterThanOrEqual(100);
      expect(loop.getIsIdle()).toBe(false);

      // A far gap still serves a requested frame (an edit) at display cadence, not on the next 8 Hz tick.
      loop.setPlaybackGapLeadMs(Number.POSITIVE_INFINITY);
      tick();
      const before = onRender.mock.calls.length;
      tick();
      expect(onRender.mock.calls.length).toBe(before);
      loop.requestRender();
      tick();
      expect(onRender.mock.calls.length).toBe(before + 1);

      // Entering a clip (the playback loop wakes the host with the visual demand) renders on the next frame.
      tick();
      const atEntry = onRender.mock.calls.length;
      loop.setTimelineVisualDemand(true);
      tick();
      expect(onRender.mock.calls.length).toBe(atEntry + 1);

      // The next gap starts at display rate again until its lead is reported.
      loop.setTimelineVisualDemand(false);
      const gapStart = onRender.mock.calls.length;
      onRender.mockImplementation(() => undefined);
      for (let i = 0; i < 6; i++) tick();
      expect(onRender.mock.calls.length).toBeGreaterThanOrEqual(gapStart + 5);
    } finally { loop.stop(); vi.unstubAllGlobals(); }
  });

  it('treats a stalled playback gap as render demand and wakes the loop', () => {
    // Since 4471270e0 playback renders through gaps, so the watchdog counts playback without a visual
    // clip at the playhead as demand. Before, it treated the gap as an expected idle and let the loop
    // sleep there.
    loopLog.warn.length = 0;
    const loop = createLoop();
    loop.isPlaying = true;
    (loop as unknown as { timelineVisualDemand: boolean }).timelineVisualDemand = false;
    try {
      loop.checkHealth();
      expect(loop.isIdle).toBe(false);
      expect(loop.renderRequested).toBe(true);
      expect(String(loopLog.warn[0]?.[0])).toContain('Render stall detected');
    } finally {
      loop.stop();
    }
  });

  it('does not report the slow far-gap cadence as a render stall', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    loopLog.warn.length = 0;
    const onRender = vi.fn(() => { loop.setPlaybackGapLeadMs(Number.POSITIVE_INFINITY); });
    const loop = new RenderLoop({ recordRafGap: vi.fn(), resetPerSecondCounters: vi.fn() } as never,
      { isRecovering: () => false, isExporting: () => false, onRender });
    const checkHealth = () => (loop as unknown as RenderLoopTestAccess).checkHealth();
    try {
      loop.start();
      loop.setTimelineVisualDemand(false);
      loop.setHasActiveVideo(false);
      loop.setIsPlaying(true);
      for (let i = 0; i < 600; i++) {
        now += 1000 / 60;
        callbacks.shift()!(now);
        if (i % 120 === 119) checkHealth();
      }
      expect(onRender.mock.calls.length).toBeLessThan(90);
      expect(loopLog.warn).toEqual([]);
      expect(loop.getIsIdle()).toBe(false);
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

  it('does not report a stall while the browser withholds animation frames from a visible page', () => {
    const probes: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { probes.push(callback); return probes.length; });
    loopLog.warn.length = 0;
    const loop = createLoop();
    loop.isPlaying = true;
    loop.animationId = 7;
    loop.lastRafTick = performance.now() - 13_000;
    const start = vi.spyOn(loop, 'start').mockImplementation(() => undefined);
    try {
      loop.checkHealth();
      loop.checkHealth();
      expect(loopLog.warn).toEqual([]);
      expect(loop.renderRequested).toBe(false);
      expect(probes).toHaveLength(1);

      // Frames resume: the loop ticks before the probe in the same frame.
      loop.lastRafTick = performance.now() + 16;
      probes[0](performance.now() + 16);
      expect(start).not.toHaveBeenCalled();
      expect(loopLog.warn).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restarts a loop whose animation frame callback was lost while the probe frame still runs', () => {
    const probes: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { probes.push(callback); return probes.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const loop = createLoop();
    loop.isPlaying = true;
    loop.animationId = 7;
    loop.lastRafTick = performance.now() - 13_000;
    const start = vi.spyOn(loop, 'start').mockImplementation(() => undefined);
    try {
      loop.checkHealth();
      probes[0](performance.now() + 16);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not report a deliberate render hold (export, recovery, editing handover) as a stall once it ends', () => {
    loopLog.warn.length = 0;
    const loop = createLoop();
    loop.isPlaying = true;
    const callbacks = (loop as unknown as { callbacks: { isExporting: ReturnType<typeof vi.fn> } }).callbacks;
    try {
      callbacks.isExporting.mockReturnValue(true);
      loop.checkHealth();
      callbacks.isExporting.mockReturnValue(false);
      loop.checkHealth();
      expect(loopLog.warn).toEqual([]);
      expect(loop.renderRequested).toBe(false);
    } finally {
      loop.stop();
    }
  });

  it('measures a stall from when render demand began, not from the last render before an idle period', () => {
    loopLog.warn.length = 0;
    const loop = createLoop();
    const now = vi.mocked(performance.now);
    try {
      // Idle for a long time (no demand): the watchdog keeps advancing its baseline.
      loop.lastSuccessfulRender = 10_000 - 30_000;
      loop.checkHealth();
      // A request arrives just before the next watchdog tick.
      now.mockReturnValue(12_000);
      loop.renderRequested = true;
      loop.checkHealth();
      expect(loopLog.warn).toEqual([]);
      // Still not rendered three watchdog ticks later: that is a real stall.
      now.mockReturnValue(16_000);
      loop.checkHealth();
      expect(String(loopLog.warn[0]?.[0])).toContain('Render stall detected: 6000ms');
    } finally {
      loop.stop();
    }
  });
});

