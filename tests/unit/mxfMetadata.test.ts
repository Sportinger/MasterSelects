import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryByteSource } from '../../src/services/mediaMetadata/mxf/mxfByteSource';
import { isMxfSource, readMxfMetadata } from '../../src/services/mediaMetadata/mxf/mxfMetadata';

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/mxf');

interface FfprobeStream {
  codec_type: 'video' | 'audio';
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate: string;
  field_order?: string;
  duration_ts: number;
  channels?: number;
  sample_rate?: string;
  bits_per_raw_sample?: string;
}
interface Golden {
  format: { tags: { operational_pattern_ul: string; timecode?: string } };
  streams: FfprobeStream[];
  packets: { stream_index: number; flags: string }[];
}

function load(name: string): { bytes: Uint8Array; golden: Golden } {
  return {
    bytes: new Uint8Array(readFileSync(resolve(FIXTURE_DIR, `${name}.mxf`))),
    golden: JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.golden.json`), 'utf8')) as Golden,
  };
}

// fixture -> [expected media codec id, expected operational pattern]
const FIXTURES: Record<string, [string, string]> = {
  prores_hq: ['apch', 'op1a'],
  dnxhr_hq_op1a: ['mxf:dnxhd', 'op1a'],
  dnxhr_hq_opatom: ['mxf:dnxhd', 'op-atom'],
  mpeg2_422_lgop: ['mxf:mpeg2-lgop', 'op1a'],
  mpeg2_422_interlaced: ['mxf:mpeg2-lgop', 'op1a'],
  mpeg2_422_pcm: ['mxf:mpeg2-lgop', 'op1a'],
  imx50_d10: ['mxf:mpeg2-intra', 'op1a'],
  h264_422_intra10: ['mxf:avc-intra', 'op1a'],
  h264_high10_intra: ['mxf:avc-intra', 'op1a'],
  h264_422_lgop10: ['mxf:avc-lgop', 'op1a'],
};

function parseRate(rate: string): number {
  const [num, den] = rate.split('/').map(Number);
  return num! / den!;
}

describe('MXF metadata vs ffprobe goldens', () => {
  for (const [name, [codecId, pattern]] of Object.entries(FIXTURES)) {
    it(`${name}`, async () => {
      const { bytes, golden } = load(name);
      const source = createMemoryByteSource(bytes);
      expect(await isMxfSource(source)).toBe(true);
      const meta = await readMxfMetadata(source);
      const gv = golden.streams.find((s) => s.codec_type === 'video')!;

      expect(meta.video).not.toBeNull();
      const video = meta.video!;
      expect(video.codecId).toBe(codecId);
      expect(meta.operationalPattern).toBe(pattern);
      expect(video.width).toBe(gv.width);
      // D-10 stores 608 lines incl. 32 VBI lines; ffprobe reports stored size, we report the 576-line picture.
      expect(video.height).toBe(name === 'imx50_d10' ? 576 : gv.height);
      expect(video.codedHeight).toBe(gv.height);
      expect(video.fps).toBeCloseTo(parseRate(gv.r_frame_rate), 6);
      expect(video.interlaced).toBe(gv.field_order !== undefined && gv.field_order !== 'progressive');
      if (video.interlaced) expect(video.topFieldFirst).toBe(gv.field_order === 'tt');
      expect(meta.durationFrames).toBe(gv.duration_ts);
      if (gv.bits_per_raw_sample) expect(video.bitDepth).toBe(Number(gv.bits_per_raw_sample));

      const goldenAudio = golden.streams.filter((s) => s.codec_type === 'audio');
      expect(meta.audio).toHaveLength(goldenAudio.length);
      goldenAudio.forEach((ga, i) => {
        expect(meta.audio[i]!.channels).toBe(ga.channels);
        expect(meta.audio[i]!.sampleRate).toBe(Number(ga.sample_rate));
        expect(meta.audio[i]!.bitDepth).toBe(Number(ga.bits_per_raw_sample));
      });

      expect(meta.timecode?.startFrame).toBe(0);
      const videoPackets = golden.packets.filter((p) => p.stream_index === 0);
      const allKey = videoPackets.every((p) => p.flags.startsWith('K'));
      expect(meta.intraOnly).toBe(allKey);
    });
  }

  it('rejects non-MXF bytes', async () => {
    const source = createMemoryByteSource(new Uint8Array(64));
    expect(await isMxfSource(source)).toBe(false);
    await expect(readMxfMetadata(source)).rejects.toThrow(/Not an MXF file/);
  });
});

describe('MXF import wiring', () => {
  it('maps metadata to the import shape with explicit codec ids', async () => {
    const { mapMxfMetadata, getMxfCodecLabel } = await import('../../src/services/mediaMetadata/mxf/mxfMediaMetadata');
    const { bytes } = load('imx50_d10');
    const mapped = mapMxfMetadata(await readMxfMetadata(createMemoryByteSource(bytes)));
    expect(mapped).toMatchObject({
      width: 720,
      height: 576,
      codedWidth: 720,
      codedHeight: 608,
      fps: 25,
      duration: 0.16,
      videoCodecId: 'mxf:mpeg2-intra',
      hasAudio: true,
    });
    // Real IMX/D-10 files declare a 4:3 picture over the 576 visible lines -> 16:15 pixels.
    const meta = await readMxfMetadata(createMemoryByteSource(bytes));
    const pal = mapMxfMetadata({ ...meta, video: { ...meta.video!, aspectRatio: { num: 4, den: 3 } } });
    expect(pal.pixelAspectRatio).toEqual({ numerator: 16, denominator: 15 });
    expect(getMxfCodecLabel('mxf:mpeg2-intra')).toBe('MPEG-2 Intra (IMX)');
    expect(getMxfCodecLabel('mxf:unsupported:jpeg2000')).toBe('JPEG 2000 (not supported)');
  });

  it('routes MXF essence to an explicit unsupported plan, never the browser decoder', async () => {
    const { selectRuntimeFrameProviderPlan } = await import('../../src/services/mediaRuntime/providerSelection');
    expect(selectRuntimeFrameProviderPlan({ videoCodecId: 'mxf:dnxhd', turboResEnabled: true }))
      .toEqual({ backend: 'unsupported', reason: 'mxf-decoder-unavailable' });
    expect(selectRuntimeFrameProviderPlan({ videoCodecId: 'mxf:unsupported:jpeg2000', turboResEnabled: true }))
      .toEqual({ backend: 'unsupported', reason: 'mxf-unsupported-essence' });
    // ProRes in MXF keeps its real FourCC and the TurboRes backend.
    expect(selectRuntimeFrameProviderPlan({ videoCodecId: 'apch', turboResEnabled: true }).backend).toBe('turbores');
  });
});
