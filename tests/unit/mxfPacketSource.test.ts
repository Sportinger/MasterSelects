import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryByteSource } from '../../src/services/mediaMetadata/mxf/mxfByteSource';
import { MxfPacketSource } from '../../src/services/mediaRuntime/mxf/MxfPacketSource';

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/mxf');
const FIXTURES = [
  'prores_hq',
  'dnxhr_hq_op1a',
  'dnxhr_hq_opatom',
  'mpeg2_422_lgop',
  'mpeg2_422_interlaced',
  'mpeg2_422_pcm',
  'imx50_d10',
  'h264_422_intra10',
  'h264_high10_intra',
  'h264_422_lgop10',
];

interface GoldenPacket {
  stream_index: number;
  pts: number;
  size: string;
  pos: string;
  flags: string;
}

function load(name: string) {
  const bytes = new Uint8Array(readFileSync(resolve(FIXTURE_DIR, `${name}.mxf`)));
  const golden = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.golden.json`), 'utf8')) as {
    streams: { index: number; codec_type: string }[];
    packets: GoldenPacket[];
  };
  const videoIndex = golden.streams.find((s) => s.codec_type === 'video')!.index;
  return { bytes, packets: golden.packets.filter((p) => p.stream_index === videoIndex) };
}

describe('MxfPacketSource vs ffprobe -show_packets', () => {
  for (const name of FIXTURES) {
    it(`${name}: stored-order packets match offset, size, pts and key flag`, async () => {
      const { bytes, packets } = load(name);
      const source = await MxfPacketSource.createFromSource(createMemoryByteSource(bytes));
      expect(source.frameCount).toBe(packets.length);
      for (let i = 0; i < packets.length; i += 1) {
        const golden = packets[i]!;
        const unit = await source.describeStoredUnit(i);
        expect({ i, pos: unit.position, size: unit.size, pts: unit.displayIndex, key: unit.isKeyframe })
          .toEqual({ i, pos: Number(golden.pos), size: Number(golden.size), pts: golden.pts, key: golden.flags.startsWith('K') });
      }
    });
  }

  it('returns display-ordered packets with bytes and exact timestamps', async () => {
    const { bytes } = load('mpeg2_422_lgop');
    const source = await MxfPacketSource.createFromSource(createMemoryByteSource(bytes));
    const packet = await source.getPacketAt(0.041);
    expect(packet).toMatchObject({ displayIndex: 1, storedIndex: 2, timestamp: 0.04, microsecondTimestamp: 40_000 });
    // MPEG-2 picture data starts with a sequence/picture start code.
    expect([...packet!.data.subarray(0, 3)]).toEqual([0, 0, 1]);
    const next = await source.getNextPacket(packet!);
    expect(next).toMatchObject({ displayIndex: 2, storedIndex: 3 });
    expect(source.keyframeStoredIndexFor(3)).toBe(0);
    // Requests past the end clamp to the last display unit.
    expect((await source.getPacketAt(99))?.displayIndex).toBe(3);
  });

  it('rejects a codec mismatch', async () => {
    const { bytes } = load('dnxhr_hq_op1a');
    await expect(MxfPacketSource.createFromSource(createMemoryByteSource(bytes), 'apch')).rejects.toThrow(/expected apch/);
  });
});

describe('ProRes in MXF through the TurboRes packet reader', () => {
  it('reads ProRes frames from MXF with the real FourCC', async () => {
    const { createProResPacketReader } = await import('../../src/services/mediaRuntime/prores/proResPacketReader');
    const { bytes } = load('prores_hq');
    const file = new File([bytes], 'camera.mxf', { type: 'application/mxf' });
    const reader = await createProResPacketReader(file, 'apch');
    expect(reader.metadata).toMatchObject({ fourCC: 'apch', width: 256, height: 128, fps: 25, duration: 0.16 });
    const packet = await reader.getPacketAt(0.1);
    expect(packet?.timestamp).toBeCloseTo(0.08, 9);
    // A ProRes frame: 4-byte size, then the 'icpf' frame identifier.
    expect(new TextDecoder().decode(packet!.data.subarray(4, 8))).toBe('icpf');
    expect(await reader.getNextPacket!(packet!)).toMatchObject({ microsecondTimestamp: 120_000 });
    reader.dispose();
  });
});
