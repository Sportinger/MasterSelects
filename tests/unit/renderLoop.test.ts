import { describe, expect, it, vi } from 'vitest';
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
};

function createLoop() {
  const loop = new RenderLoop(
    {} as ConstructorParameters<typeof RenderLoop>[0],
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

describe('RenderLoop watchdog', () => {
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

    loop.checkHealth();

    expect(loop.isIdle).toBe(false);
    expect(loop.renderRequested).toBe(true);
    expect(loop.lastActivityTime).toBeGreaterThan(performance.now() - 1000);
  });
});
