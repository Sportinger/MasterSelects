import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaBunnyMuxerAdapter } from '../../src/engine/export/MediaBunnyMuxerAdapter';
import type { ExportDiskSpill } from '../../src/engine/export/exportDiskSpill';

class FakeChunk {
  readonly byteLength: number; readonly type: 'key' | 'delta'; readonly timestamp: number; readonly duration: number;
  constructor({ size, type = 'key', timestamp, duration }: { size: number; type?: 'key' | 'delta'; timestamp: number; duration: number }) {
    this.byteLength = size; this.type = type; this.timestamp = timestamp; this.duration = duration;
  }
  copyTo(target: Uint8Array) { target.fill(1); }
}
class FakeVideoChunk extends FakeChunk {}
class FakeAudioChunk extends FakeChunk {}

const VIDEO_META = { decoderConfig: { codec: 'avc1.640028', codedWidth: 64, codedHeight: 64,
  description: new Uint8Array([1, 100, 0, 40, 255, 225, 0, 4, 103, 100, 0, 40, 1, 0, 4, 104, 235, 227, 203]) } } as unknown as EncodedVideoChunkMetadata;
const AUDIO_META = { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2,
  description: new Uint8Array([0x11, 0x90]) } } as unknown as EncodedAudioChunkMetadata;

function fakeSpill(failWrites = false) {
  const writes: Array<{ position: number; size: number }> = [];
  const discard = vi.fn(async () => undefined);
  const finish = vi.fn(async (type: string) => new Blob(['file'], { type }));
  const spill: ExportDiskSpill = {
    writable: new WritableStream({
      write(chunk: { position: number; data: Uint8Array }) {
        if (failWrites) throw new Error('disk full');
        writes.push({ position: chunk.position, size: chunk.data.byteLength });
      },
    }),
    finish, discard,
  };
  return { spill, writes, discard, finish };
}

const options = { container: 'mp4' as const, videoCodec: 'h264' as const, fps: 30, audioCodec: 'aac' as const };
const video = (i: number, size = 1024) => new FakeVideoChunk({ size, timestamp: Math.round(i * 1e6 / 30), duration: Math.round(1e6 / 30) }) as unknown as EncodedVideoChunk;
const audio = (i: number) => new FakeAudioChunk({ size: 16, timestamp: Math.round(i * 1024 * 1e6 / 48000), duration: Math.round(1024 * 1e6 / 48000) }) as unknown as EncodedAudioChunk;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
  vi.stubGlobal('EncodedVideoChunk', FakeVideoChunk);
  vi.stubGlobal('EncodedAudioChunk', FakeAudioChunk);
});
afterEach(() => vi.unstubAllGlobals());

describe('MediaBunnyMuxerAdapter writing to disk', () => {
  it('moves packets out of memory while encoding instead of holding them until the end', async () => {
    const { spill, writes, finish } = fakeSpill();
    const muxer = new MediaBunnyMuxerAdapter({ ...options, hasAudio: false, spill });
    expect(muxer.streamsToDisk).toBe(true);
    // 40 MB of packets: more than the 16 MB write block, far less than a whole export.
    for (let i = 0; i < 40; i += 1) muxer.addVideoChunk(video(i, 1024 * 1024), VIDEO_META);
    await settle();
    expect(writes.length, 'written before finalize').toBeGreaterThan(0);
    await muxer.finalize();
    const blob = await muxer.getBlob('video/mp4');
    expect(blob.type).toBe('video/mp4');
    expect(finish).toHaveBeenCalledWith('video/mp4');
  });

  it('adds audio next to the video of the same time, and cuts it where the video ended', async () => {
    const { spill } = fakeSpill();
    const muxer = new MediaBunnyMuxerAdapter({ ...options, hasAudio: true, spill });
    const added: string[] = [];
    const internals = muxer as unknown as { videoSource: { add: (...args: unknown[]) => Promise<void> }; audioSource: { add: (...args: unknown[]) => Promise<void> } };
    const record = (kind: string, source: { add: (...args: unknown[]) => Promise<void> }) => {
      const original = source.add.bind(source);
      source.add = (...args) => { added.push(kind); return original(...args); };
    };
    record('v', internals.videoSource);
    record('a', internals.audioSource);
    const packets = Array.from({ length: 200 }, (_, i) => audio(i));
    muxer.primeAudio(packets, packets.map(() => AUDIO_META));
    for (let i = 0; i < 3; i += 1) muxer.addVideoChunk(video(i), VIDEO_META);
    await settle();
    // Three frames span 0.1 s: only the audio up to the last frame's start has entered the file.
    expect(added.filter(kind => kind === 'a').length).toBeLessThan(5);
    expect(added.indexOf('a')).toBeLessThan(added.lastIndexOf('v'));
    muxer.trimPrimedAudio(0.5);
    await muxer.finalize();
    // 0.5 s holds 23 complete AAC packets of 1024 samples at 48 kHz.
    expect(added.filter(kind => kind === 'a')).toHaveLength(23);
  });

  it('reports a failed disk write while encoding, so the export does not go on for nothing', async () => {
    const { spill } = fakeSpill(true);
    const muxer = new MediaBunnyMuxerAdapter({ ...options, hasAudio: false, spill });
    // The library stores the write error and raises it at its next flush, within a second of media.
    for (let i = 0; i < 120; i += 1) muxer.addVideoChunk(video(i, 1024 * 1024), VIDEO_META);
    await vi.waitFor(() => expect(String(muxer.failure)).toContain('disk full'), { timeout: 5_000 });
    await expect(muxer.finalize()).rejects.toThrow('disk full');
  });

  it('makes an encoder faster than the disk wait, so the export stays out of memory', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spill: ExportDiskSpill = {
      writable: new WritableStream({ write: () => gate }),
      finish: async type => new Blob(['file'], { type }),
      discard: async () => undefined,
    };
    const muxer = new MediaBunnyMuxerAdapter({ ...options, hasAudio: false, spill });
    for (let i = 0; i < 40; i += 1) muxer.addVideoChunk(video(i, 16 * 1024 * 1024), VIDEO_META);
    let waited = false;
    const capacity = muxer.waitForDiskCapacity().then(() => { waited = true; });
    await settle();
    expect(waited, 'hold the encoder while the disk is behind').toBe(false);
    release();
    await capacity;
    expect(waited).toBe(true);
  }, 15_000);

  it('removes the file when the export is cancelled', () => {
    const { spill, discard } = fakeSpill();
    new MediaBunnyMuxerAdapter({ ...options, hasAudio: false, spill }).cancel();
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-memory target without a spill', async () => {
    const muxer = new MediaBunnyMuxerAdapter({ ...options, hasAudio: false });
    expect(muxer.streamsToDisk).toBe(false);
    muxer.addVideoChunk(video(0), VIDEO_META);
    await muxer.finalize();
    const blob = await muxer.getBlob('video/mp4');
    expect(blob.size).toBeGreaterThan(1024);
  });
});
