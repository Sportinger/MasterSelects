import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';
import { engine } from '../../src/engine/WebGPUEngine';
import { flags } from '../../src/engine/featureFlags';
import { initWebCodecsPlayer } from '../../src/stores/timeline/helpers/webCodecsHelpers';
import type { WebCodecsPlayerOptions } from '../../src/engine/WebCodecsPlayer';

type WebCodecsTestGlobal = {
  VideoDecoder?: unknown;
  VideoFrame?: unknown;
};

describe('initWebCodecsPlayer', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(WebCodecsPlayer).mockReset();
    vi.mocked(engine.requestNewFrameRender).mockReset();
    vi.mocked(engine.requestRender).mockReset();
    flags.useFullWebCodecsPlayback = true;
    const testWindow = window as unknown as WebCodecsTestGlobal;
    testWindow.VideoDecoder = vi.fn();
    testWindow.VideoFrame = vi.fn();
  });

  it('wakes the renderer when a normal full WebCodecs player emits a frame', async () => {
    const loadFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(WebCodecsPlayer).mockImplementation(function MockWebCodecsPlayer(
      options: WebCodecsPlayerOptions = {}
    ) {
      return {
        loadFile,
        attachToVideoElement: vi.fn(),
        ready: true,
        isFullMode: () => true,
        __options: options,
      } as unknown as WebCodecsPlayer;
    });

    const video = document.createElement('video');
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const player = await initWebCodecsPlayer(video, file.name, file);

    expect(player).toBeTruthy();
    const options = vi.mocked(WebCodecsPlayer).mock.calls[0]?.[0];
    expect(typeof options?.onFrame).toBe('function');

    options?.onFrame?.({} as VideoFrame);

    expect(engine.requestNewFrameRender).toHaveBeenCalledTimes(1);
  });

  it('waits for full WebCodecs readiness before returning', async () => {
    vi.useFakeTimers();

    const loadFile = vi.fn().mockResolvedValue(undefined);
    let ready = false;
    vi.mocked(WebCodecsPlayer).mockImplementation(function MockWebCodecsPlayer() {
      const player = {
        loadFile,
        attachToVideoElement: vi.fn(),
      };
      Object.defineProperty(player, 'ready', {
        configurable: true,
        get: () => ready,
        set: (value: boolean) => {
          ready = value;
        },
      });
      return player as unknown as WebCodecsPlayer;
    });

    const video = document.createElement('video');
    const file = new File(['video'], 'delayed-ready.mp4', { type: 'video/mp4' });

    let resolved = false;
    const playerPromise = initWebCodecsPlayer(video, file.name, file).then((player) => {
      resolved = true;
      return player;
    });

    await vi.runAllTicks();
    expect(loadFile).toHaveBeenCalledWith(file);
    expect(resolved).toBe(false);

    ready = true;
    await vi.advanceTimersByTimeAsync(32);

    await expect(playerPromise).resolves.toBeTruthy();
    expect(resolved).toBe(true);
  });

  it('returns null when preview WebCodecs is disabled by flag', async () => {
    flags.useFullWebCodecsPlayback = false;

    const video = document.createElement('video');
    const file = new File(['video'], 'html-only.mp4', { type: 'video/mp4' });
    const player = await initWebCodecsPlayer(video, file.name, file);

    expect(player).toBeNull();
    expect(vi.mocked(WebCodecsPlayer)).not.toHaveBeenCalled();
  });
});
