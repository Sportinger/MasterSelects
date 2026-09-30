import { describe, expect, it } from 'vitest';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import type { RuntimeFrameProvider } from '../../src/services/mediaRuntime/types';

let liveClones = 0;

function makeFrame(timestamp: number): VideoFrame {
  const frame = {
    timestamp,
    displayWidth: 64,
    displayHeight: 64,
    clone: () => {
      liveClones += 1;
      let closed = false;
      return { ...frame, close: () => { if (!closed) { closed = true; liveClones -= 1; } } };
    },
    close: () => undefined,
  };
  return frame as unknown as VideoFrame;
}

function makeProvider(frameCacheLimit: number | undefined): RuntimeFrameProvider & { frame: VideoFrame | null } {
  return {
    frameCacheLimit,
    frame: null,
    currentTime: 0,
    isPlaying: true,
    isFullMode: () => true,
    isSimpleMode: () => false,
    getCurrentFrame() { return this.frame; },
    getFrameRate: () => 25,
    seek: () => undefined,
    pause: () => undefined,
  };
}

function renderFrames(sourceId: string, provider: ReturnType<typeof makeProvider>, count: number) {
  const runtime = mediaRuntimeRegistry.retainRuntime({ sourceId, kind: 'video' }, `${sourceId}:owner`)!;
  runtime.getSession('session', { policy: 'interactive' });
  runtime.setSessionFrameProvider('session', provider);
  const handles = [];
  for (let i = 0; i < count; i += 1) {
    const time = i / 25;
    provider.frame = makeFrame(Math.round(time * 1e6));
    handles.push(runtime.getFrameSync({ sourceId, sessionKey: 'session', sourceTime: time, playbackMode: 'interactive', allowCache: true }));
  }
  return { runtime, handles };
}

describe('source runtime frame cache limit', () => {
  it('keeps no clones for providers whose frames pin hardware decoder surfaces', () => {
    liveClones = 0;
    const { runtime, handles } = renderFrames('media:mxf-limit', makeProvider(0), 30);
    expect(handles.every((handle) => handle?.frame)).toBe(true);
    expect(runtime.frameCache.size).toBe(0);
    expect(liveClones).toBe(0);
    mediaRuntimeRegistry.releaseRuntime('media:mxf-limit', 'media:mxf-limit:owner');
  });

  it('keeps the default clone cache for other providers', () => {
    liveClones = 0;
    const { runtime } = renderFrames('media:default-limit', makeProvider(undefined), 30);
    expect(runtime.frameCache.size).toBe(12);
    expect(liveClones).toBe(12);
    mediaRuntimeRegistry.releaseRuntime('media:default-limit', 'media:default-limit:owner');
    expect(liveClones).toBe(0);
  });
});
