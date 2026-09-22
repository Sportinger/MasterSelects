import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ starts: vi.fn(), stops: vi.fn(), dispose: vi.fn(), samples: [] as any[] }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], BlobSource: class {}, UrlSource: class {},
  Input: class { dispose = mock.dispose; async getPrimaryVideoTrack() {
    return { canDecode: async () => true, rotation: 0, displayWidth: 8, displayHeight: 4 };
  } },
  EncodedPacketSink: class { async *packets() {
    for (let i = 0; i < 90; i++) yield { timestamp: i / 30, duration: 1 / 30 };
  } },
  VideoSampleSink: class { async *samples(start: number) {
    mock.starts(start);
    try {
      for (let i = Math.max(0, Math.ceil(start * 30)); i < 90; i++) {
        const frame = { close: vi.fn() };
        const sample = { timestamp: Math.round(i / 30 * 1e6) / 1e6, duration: 1 / 30,
          displayWidth: 8, displayHeight: 4, rotation: 0, close: vi.fn(), toVideoFrame: () => frame, frame };
        mock.samples.push(sample); yield sample;
      }
    } finally { mock.stops(); }
  } },
}));
import { openSourceFrameReader } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameReader';
afterEach(() => { vi.clearAllMocks(); mock.samples = []; });

it('keeps one sequential decoder cursor for adjacent requests and closes skipped samples', async () => {
  const reader = await openSourceFrameReader({ id: 'video', url: 'blob:video' }, new AbortController().signal);
  const seen: number[] = [];
  for await (const frame of reader.read([0, 2 / 30])) seen.push(frame.time);
  for await (const frame of reader.read([4 / 30, 6 / 30])) seen.push(frame.time);
  expect(seen).toEqual([0, 2 / 30, 4 / 30, 6 / 30]);
  expect(mock.starts).toHaveBeenCalledTimes(1);
  mock.samples.forEach(sample => expect(sample.close).toHaveBeenCalledOnce());
  expect(mock.samples[1].frame.close).not.toHaveBeenCalled(); // Never converted the skipped frame.
  expect(mock.samples[2].frame.close).toHaveBeenCalledOnce();
  await reader.idle(); expect(mock.stops).toHaveBeenCalledOnce(); reader.close();
});

it('seeks directly on distant/backward requests and frees both borrowed handles on cancellation', async () => {
  const reader = await openSourceFrameReader({ id: 'video', url: 'blob:video' }, new AbortController().signal);
  for await (const _ of reader.read([0])) { /* consume */ }
  for await (const _ of reader.read([2])) { /* consume */ }
  const iterator = reader.read([1]); await iterator.next();
  const sample = mock.samples.at(-1);
  expect(sample.close).not.toHaveBeenCalled();
  await iterator.return(undefined);
  expect(sample.close).toHaveBeenCalledOnce(); expect(sample.frame.close).toHaveBeenCalledOnce();
  expect(mock.starts.mock.calls.map(call => Math.round(call[0]) || 0)).toEqual([0, 2, 1]);
  reader.close();
});
