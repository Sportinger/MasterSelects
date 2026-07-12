import { describe, expect, it } from 'vitest';
import { BufferSource, EncodedPacket, Input, MP4 } from 'mediabunny';
import { CaptureMuxer, type CaptureMuxerPositionedRun } from '../recording/captureMuxer';

function assemble(runs: readonly CaptureMuxerPositionedRun[]): Uint8Array {
  const size = runs.reduce((result, run) => Math.max(result, run.position + run.data.byteLength), 0);
  const output = new Uint8Array(size);
  for (const run of runs.toSorted((a, b) => a.runIndex - b.runIndex)) output.set(run.data, run.position);
  return output;
}

describe('CaptureMuxer streaming output', () => {
  it('persists a fragmented MP4 initialization prefix through positioned writes', async () => {
    const runs: CaptureMuxerPositionedRun[] = [];
    const muxer = new CaptureMuxer({
      fps: 30,
      writeRun: async run => { runs.push(run); },
      toPacket: (chunk, sequence) => new EncodedPacket(
        new Uint8Array([0, 0, 0, 2, 0x65, 0x80]), 'key', chunk.timestamp / 1_000_000, 1 / 30, sequence,
      ),
    });

    const sps = new Uint8Array([0x67, 0x42, 0xc0, 0x1e, 0xda, 0x02, 0x80, 0xb7, 0xfe, 0x05, 0x01, 0xed, 0x00, 0xf0, 0x88, 0x45]);
    const pps = new Uint8Array([0x68, 0xce, 0x06, 0xe2]);
    const avcc = new Uint8Array([1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, sps.length, ...sps, 1, 0, pps.length, ...pps]);
    await muxer.addVideoChunk({ timestamp: 0, byteLength: 6 } as EncodedVideoChunk, {
      decoderConfig: { codec: 'avc1.42c01e', codedWidth: 640, codedHeight: 480, description: avcc },
    });
    await muxer.addVideoChunk({ timestamp: 2_000_000, byteLength: 6 } as EncodedVideoChunk);
    const prefix = assemble(runs);
    expect(runs.some(run => run.recoverableFragment)).toBe(true);
    const prefixInput = new Input({ formats: [MP4], source: new BufferSource(prefix.buffer) });
    const [prefixTrack] = await prefixInput.getVideoTracks();
    expect(prefixTrack).toBeDefined();
    prefixInput.dispose();
    expect(await muxer.finalize()).toBeNull();
    const file = assemble(runs);
    const text = new TextDecoder('latin1').decode(file);
    expect(runs.length).toBeGreaterThan(0);
    expect(text).toContain('ftyp');
    expect(text).toContain('moov');
    expect(text).toContain('mvex');
    expect(muxer.getStats()).toMatchObject({ artifactBytes: expect.any(Number), outputBytes: file.byteLength });
    const input = new Input({ formats: [MP4], source: new BufferSource(file.buffer) });
    expect(await input.getVideoTracks()).toHaveLength(1);
    input.dispose();
  });
});
