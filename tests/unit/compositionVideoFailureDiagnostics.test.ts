import { afterEach, expect, it, vi } from 'vitest';
import { loadVideoSource } from '../../src/services/compositionRender/sourceLoaders';
import type { CompositionSources } from '../../src/services/compositionRender/sourceTypes';
import type { SerializableClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({ error: vi.fn(), release: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ error: mocks.error, debug: vi.fn() }) } }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({ planSourceRuntimeBindingForOwner: () => null, bindSourceRuntimeForOwner: vi.fn() }));
vi.mock('../../src/services/timeline/runtimeResourceReporting', () => ({ reservePlannedClipRuntimeResources: () => ({ admitted: true, release: mocks.release }) }));
vi.mock('../../src/services/compositionRender/sourceLifecycle', () => ({
  releaseVideoElement: (video: HTMLVideoElement) => { Object.defineProperty(video, 'error', { configurable: true, value: null }); },
  releaseImageElement: vi.fn(), revokeObjectUrls: vi.fn(), reportCompositionSource: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it.each([1, 2, 3, 4, null])('captures browser error %s before cleanup clears the element', async (code) => {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    error: { configurable: true, value: code === null ? null : { code } },
    readyState: { configurable: true, value: 1 },
    networkState: { configurable: true, value: 3 },
  });
  vi.spyOn(document, 'createElement').mockReturnValue(video);
  vi.spyOn(video, 'load').mockImplementation(() => { video.dispatchEvent(new Event('error')); });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-source');
  const sources: CompositionSources = {
    compositionId: 'diagnostic-test', clipSources: new Map(), pendingSourceDisposers: new Map(),
    isReady: false, disposed: false, lastAccessTime: 0,
  };
  const file = new File(['bad'], 'broken.mp4', { type: 'video/mp4' });
  await loadVideoSource(sources, { id: 'clip', name: file.name, duration: 1 } as SerializableClip, file, () => true);
  expect(mocks.error).toHaveBeenCalledWith('Failed to load video: broken.mp4', {
    mediaErrorCode: code, readyState: 1, networkState: 3, fileSize: 3, mimeType: 'video/mp4',
  });
  expect(video.error).toBeNull();
  expect(sources.pendingSourceDisposers.size).toBe(0);
  expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('blob:private-source');
});
