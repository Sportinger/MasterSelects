import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/engine/core/types';
import type { TextureManager } from '../../src/engine/texture/TextureManager';
import { collectSurfaceVideoFrame, getSurfaceVideoFrameTime, recordSurfaceVideoFrameTime } from '../../src/engine/render/surfaceVideoFrame';

vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestNewFrameRender: vi.fn() } }));

describe('surface HTML video presentation ownership', () => {
  const closed: number[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    closed.length = 0;
    vi.stubGlobal('VideoFrame', class {
      timestamp: number;
      displayWidth = 2160;
      displayHeight = 3840;
      constructor(_source: unknown, init: VideoFrameInit) { this.timestamp = init.timestamp; }
      close() { closed.push(this.timestamp); }
    });
  });
  afterEach(() => { vi.advanceTimersByTime(5000); vi.useRealTimers(); vi.unstubAllGlobals(); });

  function fixture() {
    let callback: VideoFrameRequestCallback;
    const video = {
      currentSrc: 'blob:source', currentTime: 4.02, paused: true, seeking: false,
      requestVideoFrameCallback: vi.fn((next: VideoFrameRequestCallback) => { callback = next; return 1; }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    const layer = { effects: [{ surfaceTrack: {} }], source: { mediaTime: 4.02 } } as unknown as Layer;
    const textures = { importVideoTexture: vi.fn(() => ({})) } as unknown as TextureManager;
    const collect = () => collectSurfaceVideoFrame(layer, video, textures);
    const present = (mediaTime: number) => callback!(0, { mediaTime } as VideoFrameCallbackMetadata);
    return { video, layer, textures, collect, present };
  }

  it('pairs captured pixels with callback PTS and holds both during the next seek', () => {
    const f = fixture();
    expect(f.collect()).toBeNull();
    f.present(4.000033);
    expect(f.collect()?.displayedMediaTime).toBe(4.000033);
    f.video.currentTime = 7; f.video.seeking = true; f.layer.source!.mediaTime = 7;
    expect(f.collect()?.displayedMediaTime).toBe(4.000033);
    expect(getSurfaceVideoFrameTime(f.video)).toBeUndefined();
    f.video.seeking = false; f.present(6.9667);
    expect(f.collect()?.displayedMediaTime).toBe(6.9667);
    expect(closed).toContain(4000033);
  });

  it('stops idle observation while retaining the paused frame, then releases it on relink', () => {
    const f = fixture();
    recordSurfaceVideoFrameTime(f.video, 4.000033);
    expect(f.collect()?.displayedMediaTime).toBe(4.000033);
    vi.advanceTimersByTime(5000);
    expect(closed).not.toContain(4000033);
    expect(f.video.cancelVideoFrameCallback).toHaveBeenCalled();
    expect(f.collect()?.displayedMediaTime).toBe(4.000033);
    f.video.currentSrc = 'blob:relinked';
    expect(f.collect()).toBeNull();
    expect(closed).toContain(4000033);
  });

  it('does not allocate an observer for ordinary video layers', () => {
    const f = fixture(); f.layer.effects = [];
    expect(f.collect()).toBeUndefined();
    expect(f.video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });
});
