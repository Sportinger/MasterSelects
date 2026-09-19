import { afterEach, expect, it, vi } from 'vitest';
import { TextureManager } from '../../src/engine/texture/TextureManager';

afterEach(() => vi.unstubAllGlobals());

function videoSource(frames = 1) {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    videoWidth: { configurable: true, value: 640 },
    videoHeight: { configurable: true, value: 360 },
    paused: { configurable: true, value: false },
    getVideoPlaybackQuality: { value: () => ({ totalVideoFrames: frames }) },
  });
  return video;
}

it('avoids GPU import before a playable frame exists', () => {
  const importExternalTexture = vi.fn();
  const manager = new TextureManager({ importExternalTexture } as unknown as GPUDevice);
  expect(manager.importVideoTexture(videoSource(0))).toBeNull();
  const unready = videoSource();
  Object.defineProperty(unready, 'readyState', { value: 1 });
  expect(manager.importVideoTexture(unready)).toBeNull();
  const empty = videoSource();
  Object.defineProperty(empty, 'videoWidth', { value: 0 });
  expect(manager.importVideoTexture(empty)).toBeNull();
  expect(importExternalTexture).not.toHaveBeenCalled();
});

it('contains missing backing-resource failure and retries the same source on a later render', () => {
  const texture = {} as GPUExternalTexture;
  const importExternalTexture = vi.fn()
    .mockImplementationOnce(() => { throw new DOMException('Video has no back resource', 'OperationError'); })
    .mockReturnValue(texture);
  const manager = new TextureManager({ importExternalTexture } as unknown as GPUDevice);
  const video = videoSource();
  expect(manager.importVideoTexture(video)).toBeNull();
  expect(manager.importVideoTexture(video)).toBe(texture);
  expect(importExternalTexture).toHaveBeenCalledTimes(2);
  expect(importExternalTexture).toHaveBeenLastCalledWith({ source: video });
});

it('does not pass a closed or empty VideoFrame to the GPU', () => {
  class Frame { codedWidth = 0; codedHeight = 0; }
  vi.stubGlobal('VideoFrame', Frame);
  const importExternalTexture = vi.fn();
  const manager = new TextureManager({ importExternalTexture } as unknown as GPUDevice);
  expect(manager.importVideoTexture(new Frame() as unknown as VideoFrame)).toBeNull();
  expect(importExternalTexture).not.toHaveBeenCalled();
});
