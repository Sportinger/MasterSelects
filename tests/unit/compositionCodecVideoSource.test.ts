import { afterEach, expect, it, vi } from 'vitest';
import { loadVideoSource } from '../../src/services/compositionRender/sourceLoaders';
import type { CompositionSources } from '../../src/services/compositionRender/sourceTypes';
import type { SerializableClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({ warn: vi.fn(), bind: vi.fn(), report: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ error: vi.fn(), warn: mocks.warn, debug: vi.fn() }) } }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({ planSourceRuntimeBindingForOwner: () => null, bindSourceRuntimeForOwner: mocks.bind }));
vi.mock('../../src/services/timeline/runtimeResourceReporting', () => ({ reservePlannedClipRuntimeResources: () => ({ admitted: true, release: vi.fn() }) }));
vi.mock('../../src/services/compositionRender/sourceLifecycle', () => ({
  releaseVideoElement: vi.fn(), releaseImageElement: vi.fn(), revokeObjectUrls: vi.fn(), reportCompositionSource: mocks.report,
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
const sourcesFor = (): CompositionSources => ({ compositionId: 'nested', clipSources: new Map(), pendingSourceDisposers: new Map(), isReady: false, disposed: false, lastAccessTime: 0 });
const clip = { id: 'clip', name: 'Jonas1.MXF', duration: 10, mediaFileId: 'media-mxf' } as SerializableClip;

it('binds an MXF clip of a nested composition to its codec decoder instead of a video element', async () => {
  const createElement = vi.spyOn(document, 'createElement');
  mocks.bind.mockReturnValue({ runtimeSourceId: 'runtime-mxf', runtimeSessionKey: 'session-mxf' });
  const sources = sourcesFor();
  await loadVideoSource(sources, clip, new File(['mxf'], 'Jonas1.MXF'), () => true, 'mxf:avc-lgop');

  expect(createElement).not.toHaveBeenCalledWith('video');
  expect(sources.clipSources.get('clip')).toMatchObject({ type: 'video', runtimeSourceId: 'runtime-mxf', runtimeSessionKey: 'session-mxf', mediaFileId: 'media-mxf' });
  expect(sources.clipSources.get('clip')?.videoElement).toBeUndefined();
  expect(mocks.report).toHaveBeenCalledTimes(1);
});

it('reports an undecodable MXF essence instead of failing silently in a video element', async () => {
  const createElement = vi.spyOn(document, 'createElement');
  const sources = sourcesFor();
  await loadVideoSource(sources, clip, new File(['mxf'], 'Jonas1.MXF'), () => true, 'mxf:unsupported:jpeg2000');

  expect(createElement).not.toHaveBeenCalledWith('video');
  expect(sources.clipSources.size).toBe(0);
  expect(mocks.warn).toHaveBeenCalledWith('Composition video cannot be decoded: Jonas1.MXF', expect.objectContaining({ clipId: 'clip' }));
});
