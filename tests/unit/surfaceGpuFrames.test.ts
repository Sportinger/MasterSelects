import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ samples: [] as any[], getImageData: vi.fn(), draw: vi.fn(), dispose: vi.fn() }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], BlobSource: class {}, UrlSource: class {},
  Input: class { dispose = mock.dispose; async getPrimaryVideoTrack() { return { canDecode: async () => true, rotation: 0 }; } },
  EncodedPacketSink: class { async *packets() { yield { timestamp: 0, duration: 1 }; yield { timestamp: 1, duration: 1 }; } },
  VideoSampleSink: class { async *samplesAtTimestamps() { for (const sample of mock.samples) yield sample; } },
}));
import { openSurfaceFrames } from '../../src/services/planarTracking/surfaceFrameReader';

function sample(rotation = 0) {
  const frame = { close: vi.fn() };
  return { timestamp: 0, duration: 1, displayWidth: 8, displayHeight: 4, rotation,
    close: vi.fn(), toVideoFrame: vi.fn(() => frame), draw: mock.draw, frame };
}
async function setup(maxEdge: number, rotation = 0) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getImageData: mock.getImageData } as unknown as CanvasRenderingContext2D);
  const source = sample(rotation); mock.samples = [source];
  const reader = await openSurfaceFrames('blob:source', new AbortController().signal, undefined, maxEdge);
  return { reader, source };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); mock.samples = []; });

it('borrows the native VideoFrame and releases both handles when iteration is cancelled', async () => {
  const { reader, source } = await setup(8);
  const iterator = reader.readGpuTimes([0]);
  const next = await iterator.next();
  expect(next.value?.source).toBe(source.frame);
  expect(source.close).not.toHaveBeenCalled();
  expect(source.frame.close).not.toHaveBeenCalled();
  await iterator.return(undefined);
  expect(source.close).toHaveBeenCalledTimes(1);
  expect(source.frame.close).toHaveBeenCalledTimes(1);
  expect(mock.getImageData).not.toHaveBeenCalled();
  expect(mock.draw).not.toHaveBeenCalled();
  reader.close();
});

it.each([{ edge: 2, rotation: 0, width: 2, height: 1 }, { edge: 8, rotation: 90, width: 8, height: 4 }])(
  'resizes/rotates on a canvas without reading CPU pixels: $edge/$rotation', async ({ edge, rotation, width, height }) => {
    const { reader, source } = await setup(edge, rotation);
    for await (const frame of reader.readGpuTimes([0])) {
      expect(frame.source).toBeInstanceOf(HTMLCanvasElement);
      expect([frame.width, frame.height]).toEqual([width, height]);
      expect(mock.draw).toHaveBeenCalledTimes(1);
    }
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(source.toVideoFrame).not.toHaveBeenCalled();
    expect(mock.getImageData).not.toHaveBeenCalled();
    reader.close();
  });
