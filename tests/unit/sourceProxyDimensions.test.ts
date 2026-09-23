import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn(), rotation: 0 }));
vi.mock('../../src/services/proxyFrameCache', () => ({ proxyFrameCache: {
  getNearestCachedFrameEntry: () => undefined, getFrame: mock.load,
} }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: {
  acquire: () => ({ ready: Promise.resolve({ rotation: mock.rotation }), release: mock.release }),
} }));
import { SourceProxyDimensions } from '../../src/effects/time/SourceProxyDimensions';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import type { MediaFile } from '../../src/stores/mediaStore/types';

const media = { id: '4k', width: 3840, height: 2160, proxyStatus: 'ready', proxyFrameCount: 100 } as MediaFile;
afterEach(() => { vi.clearAllMocks(); mock.rotation = 0; });
it('awaits actual proxy dimensions, rotates them and shares the preparation', async () => {
  mock.rotation = 90;
  mock.load.mockResolvedValue({ complete: true, naturalWidth: 1280, naturalHeight: 720 });
  const sizes = new SourceProxyDimensions(), ready = vi.fn(), finish = collectTemporalPreparations();
  expect(sizes.resolve(media, 30, ready)).toBeNull();
  expect(sizes.resolve(media, 30, ready)).toBeNull();
  const pending = finish();
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(sizes.resolve(media, 30)).toEqual({ width: 720, height: 1280 });
  expect(mock.load).toHaveBeenCalledOnce();
  expect(mock.load).toHaveBeenCalledWith(media.id, 0, 30, false);
  expect(mock.release).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  sizes.destroy();
});
it('falls back for a missing JPEG, and retries when proxy generation advances', async () => {
  const sizes = new SourceProxyDimensions();
  mock.load.mockResolvedValueOnce(null).mockResolvedValueOnce({ complete: true, naturalWidth: 960, naturalHeight: 540 });
  let finish = collectTemporalPreparations();
  sizes.resolve(media, 30); await Promise.all(finish());
  expect(sizes.resolve(media, 30)).toBeUndefined();
  const updated = { ...media, proxyFrameCount: 101 };
  finish = collectTemporalPreparations();
  sizes.resolve(updated, 30); await Promise.all(finish());
  expect(sizes.resolve(updated, 30)).toEqual({ width: 960, height: 540 });
  sizes.destroy();
});
