import { afterEach, expect, it, vi } from 'vitest';
import { loadVideoSource } from '../../src/services/compositionRender/sourceLoaders';
import { disposeCompositionSources } from '../../src/services/compositionRender/sourceLifecycle';
import type { CompositionSources } from '../../src/services/compositionRender/sourceTypes';
import type { SerializableClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({ error: vi.fn(), releaseAdmission: vi.fn(), releaseRuntime: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ error: mocks.error, debug: vi.fn() }) } }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  planSourceRuntimeBindingForOwner: () => null,
  bindSourceRuntimeForOwner: () => ({ runtimeSourceId: 'source', runtimeSessionKey: 'background:source' }),
}));
vi.mock('../../src/services/mediaRuntime/registry', () => ({ mediaRuntimeRegistry: { releaseRuntime: mocks.releaseRuntime } }));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({ releaseRuntimePlaybackSession: vi.fn() }));
vi.mock('../../src/services/timeline/runtimeResourceReporting', () => ({
  reservePlannedClipRuntimeResources: () => ({ admitted: true, release: mocks.releaseAdmission }),
}));
vi.mock('../../src/services/timeline/compositionRenderRuntimeReporting', () => ({
  reportCompositionRenderSource: vi.fn(), releaseCompositionRenderSourceResource: vi.fn(),
}));
vi.mock('../../src/services/timeline/imageRuntimeHydrator', () => ({ startTimelineImageHydration: vi.fn() }));
vi.mock('../../src/services/vectorAnimation/VectorAnimationRuntimeManager', () => ({ vectorAnimationRuntimeManager: {} }));
vi.mock('../../src/services/compositionRender/sourceSetup', () => ({
  getRuntimeOwnerId: (compositionId: string, clipId: string) => `composition:${compositionId}:clip:${clipId}`,
  getRuntimeAdmissionClip: (_compositionId: string, clip: SerializableClip) => clip,
  buildSerializableVectorAnimationClip: vi.fn(), createImageHydrationDemand: vi.fn(), getTimelineImageSource: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function sources(): CompositionSources {
  return {
    compositionId: 'preview', clipSources: new Map(), pendingSourceDisposers: new Map(),
    isReady: false, disposed: false, lastAccessTime: 0,
  };
}

function videoFixture() {
  const video = document.createElement('video');
  vi.spyOn(document, 'createElement').mockReturnValue(video);
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:composition-video');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
    expect(video.hasAttribute('src')).toBe(false);
  });
  const file = new File(['valid media'], 'preview.mp4', { type: 'video/mp4' });
  const clip = { id: 'clip', name: file.name, duration: 5 } as SerializableClip;
  return { video, revoke, file, clip };
}

it('disposes a successfully loaded source without empty-src requests or stale load errors', async () => {
  const { video, revoke, file, clip } = videoFixture();
  const cache = sources();
  vi.spyOn(video, 'load').mockImplementation(() => {
    if (video.getAttribute('src') === 'blob:composition-video') {
      video.dispatchEvent(new Event('canplaythrough'));
    } else {
      // Browsers may deliver a queued event from the old resource at teardown.
      Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
      video.dispatchEvent(new Event('error'));
    }
  });

  await loadVideoSource(cache, clip, file, () => !cache.disposed);
  expect(cache.clipSources.get(clip.id)?.videoElement).toBe(video);
  expect(cache.pendingSourceDisposers.size).toBe(0);
  disposeCompositionSources(cache);

  expect(video.getAttribute('src')).toBeNull();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:composition-video');
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.releaseAdmission).not.toHaveBeenCalled();
  expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  expect(cache.clipSources.size).toBe(0);
});

it('cancels a pending source before teardown can deliver media error events', async () => {
  const { video, revoke, file, clip } = videoFixture();
  const cache = sources();
  vi.spyOn(video, 'load').mockImplementation(() => {
    if (!video.hasAttribute('src')) video.dispatchEvent(new Event('error'));
  });
  const pending = loadVideoSource(cache, clip, file, () => !cache.disposed);
  expect(cache.pendingSourceDisposers.size).toBe(1);
  disposeCompositionSources(cache);
  await pending;

  expect(video.getAttribute('src')).toBeNull();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.releaseAdmission).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
  expect(cache.pendingSourceDisposers.size).toBe(0);
});
