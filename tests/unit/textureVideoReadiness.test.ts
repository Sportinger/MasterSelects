import { expect, it, vi } from 'vitest';
import { TextureManager } from '../../src/engine/texture/TextureManager';

it('waits for the first live video frame even when the element reports enough data', () => {
  const texture = { label: 'external-video' };
  const importExternalTexture = vi.fn(() => texture);
  const manager = new TextureManager({ importExternalTexture } as unknown as GPUDevice);
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 640 },
    videoHeight: { value: 360 }, paused: { value: false } });
  let producedFrames = 0;
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: producedFrames } as VideoPlaybackQuality);
  expect(manager.importVideoTexture(video)).toBeNull();
  expect(importExternalTexture).not.toHaveBeenCalled();
  producedFrames = 1;
  expect(manager.importVideoTexture(video)).toBe(texture);
  expect(importExternalTexture).toHaveBeenCalledWith({ source: video });
});

it('retains paused precise-export import behavior', () => {
  const texture = { label: 'paused-frame' };
  const importExternalTexture = vi.fn(() => texture);
  const manager = new TextureManager({ importExternalTexture } as unknown as GPUDevice);
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 640 },
    videoHeight: { value: 360 }, paused: { value: true } });
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 } as VideoPlaybackQuality);
  expect(manager.importVideoTexture(video)).toBe(texture);
});
