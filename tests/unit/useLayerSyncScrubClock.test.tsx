import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sync = vi.hoisted(() => ({ cached: vi.fn(() => false), audio: vi.fn() }));
vi.mock('../../src/stores/timeline', async () => {
  const { createStore } = await import('zustand/vanilla');
  const { subscribeWithSelector } = await import('zustand/middleware');
  return { useTimelineStore: createStore(subscribeWithSelector(() => ({
    layers: [], playheadPosition: 0, isPlaying: false, isRamPreviewing: false,
  }))) };
});
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [] }) } }));
vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: { renderCachedFrame: sync.cached, requestRender: vi.fn() },
}));
vi.mock('../../src/services/audio/midiPlaybackScheduler', () => ({ ensureMidiPlaybackScheduler: vi.fn() }));
vi.mock('../../src/services/vectorAnimation/VectorAnimationRuntimeManager', () => ({ vectorAnimationRuntimeManager: {} }));
vi.mock('../../src/services/timeline/lazyImageElements', () => ({ getLazyImageElementForClip: vi.fn() }));
vi.mock('../../src/services/timeline/nativeDecoderRuntimeRegistry', () => ({ getNativeDecoderForTimelineClip: vi.fn() }));
vi.mock('../../src/components/timeline/utils/layerSyncAudioPlayback', () => ({ syncLayerAudioPlayback: sync.audio }));
vi.mock('../../src/components/timeline/utils/layerSyncNestedLayers', () => ({ buildLayerSyncNestedLayers: vi.fn() }));
vi.mock('../../src/components/timeline/utils/layerSyncProxyFrames', () => ({ syncLayerProxyFrame: vi.fn() }));
vi.mock('../../src/components/timeline/utils/layerSyncMotionShape', () => ({ buildLayerSyncMotionShape: vi.fn() }));

import { useTimelineStore } from '../../src/stores/timeline';
import { useLayerSync } from '../../src/components/timeline/hooks/useLayerSync';

function props(): Parameters<typeof useLayerSync>[0] {
  return {
    playheadPosition: 0, clips: [], tracks: [], isPlaying: false, isDraggingPlayhead: true,
    ramPreviewRange: null, isRamPreviewing: false, clipKeyframes: new Map(), clipDrag: null,
    clipMap: new Map(), videoTracks: [], audioTracks: [],
    getClipsAtTime: vi.fn(() => []), getInterpolatedTransform: vi.fn(), getInterpolatedEffects: vi.fn(),
    getInterpolatedVectorAnimationSettings: vi.fn(), getInterpolatedSpeed: vi.fn(), getSourceTimeForClip: vi.fn(),
    isVideoTrackVisible: () => true, isAudioTrackMuted: () => false,
  };
}

describe('paused layer synchronization with an isolated scrub clock', () => {
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });

  beforeEach(() => {
    nextFrame = 0;
    frames = new Map();
    sync.cached.mockReset().mockReturnValue(false);
    sync.audio.mockClear();
    useTimelineStore.setState({ layers: [], playheadPosition: 0, isPlaying: false, isRamPreviewing: false });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('coalesces pointer updates and synchronizes the latest time without rerendering the host', () => {
    const input = props();
    const hostRender = vi.fn();
    renderHook(() => { hostRender(); useLayerSync(input); });
    act(() => {
      useTimelineStore.setState({ playheadPosition: 10 });
      useTimelineStore.setState({ playheadPosition: 25 });
      useTimelineStore.setState({ playheadPosition: 6 });
    });
    expect(frames.size).toBe(1);
    flush();
    expect(hostRender).toHaveBeenCalledOnce();
    expect(input.getClipsAtTime).toHaveBeenCalledExactlyOnceWith(6);
    expect(sync.audio).toHaveBeenCalledWith(expect.objectContaining({ playheadPosition: 6, isDraggingPlayhead: true }));
  });

  it('keeps listening after a cache hit and builds a later uncached scrub target', () => {
    const input = props();
    sync.cached.mockReturnValueOnce(true);
    renderHook(() => useLayerSync(input));
    flush();
    expect(input.getClipsAtTime).not.toHaveBeenCalled();
    act(() => useTimelineStore.setState({ playheadPosition: 12 }));
    flush();
    expect(sync.cached).toHaveBeenLastCalledWith(12);
    expect(input.getClipsAtTime).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('cancels pending work and detaches the time listener on unmount', () => {
    const input = props();
    const hook = renderHook(() => useLayerSync(input));
    expect(frames.size).toBe(1);
    hook.unmount();
    expect(frames.size).toBe(0);
    act(() => useTimelineStore.setState({ playheadPosition: 40 }));
    expect(frames.size).toBe(0);
    expect(input.getClipsAtTime).not.toHaveBeenCalled();
  });

  it('does not run an old paused frame after playback starts', () => {
    const input = props();
    renderHook(() => useLayerSync(input));
    act(() => useTimelineStore.setState({ isPlaying: true }));
    flush();
    expect(input.getClipsAtTime).not.toHaveBeenCalled();
    expect(sync.audio).not.toHaveBeenCalled();
  });
});
