import { afterEach, expect, it, vi } from 'vitest';
import { WebCodecsExportMode, type ExportModePlayer } from '../../src/engine/WebCodecsExportMode';
import type { Sample } from '../../src/engine/webCodecsTypes';

afterEach(() => vi.unstubAllGlobals());

it('continues through a short forward cut without exhausting the decoder surface pool', async () => {
  vi.stubGlobal('EncodedVideoChunk', class {
    timestamp: number;
    constructor(init: EncodedVideoChunkInit) { this.timestamp = Math.trunc(init.timestamp); }
  });
  const samples = Array.from({ length: 1800 }, (_, index) => ({
    number: index, track_id: 1, cts: index, dts: index, duration: 1, timescale: 30,
    is_sync: index % 30 === 0, size: 1, data: new ArrayBuffer(1),
  } as Sample));
  let currentFrame: VideoFrame | null = null;
  let liveSurfaces = 0;
  let peakSurfaces = 0;
  const makeFrame = (timestamp: number) => {
    liveSurfaces++;
    peakSurfaces = Math.max(peakSurfaces, liveSurfaces);
    let closed = false;
    return { timestamp, close: vi.fn(() => {
      if (!closed) liveSurfaces--;
      closed = true;
    }) } as unknown as VideoFrame;
  };
  const decoder = {
    state: 'configured', decodeQueueSize: 0, configure: vi.fn(), reset: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    decode: vi.fn((chunk: EncodedVideoChunk) => {
      // Hardware cannot emit more frames while earlier outputs retain its surfaces.
      if (liveSurfaces < 11) mode.handleDecoderOutput(makeFrame(chunk.timestamp));
    }),
  };
  const player: ExportModePlayer = {
    getDecoder: () => decoder as unknown as VideoDecoder, getSamples: () => samples,
    getSampleIndex: () => 1627, setSampleIndex: vi.fn(), getVideoTrackTimescale: () => 30,
    getCodecConfig: () => ({ codec: 'avc1.test' }), getFrameRate: () => 30,
    getCurrentFrame: () => currentFrame, setCurrentFrame: frame => { currentFrame = frame; },
    isSimpleMode: () => false, seekAsync: vi.fn(),
  };
  const mode = new WebCodecsExportMode(player);
  const state = mode as unknown as {
    isActive: boolean; decodeCursorIndex: number;
    exportFrameBuffer: Map<number, VideoFrame>; exportFramesCts: number[];
  };
  state.isActive = true;
  state.decodeCursorIndex = 1627;
  for (let index = 1620; index < 1624; index++) {
    const timestamp = Math.trunc(index * 1e6 / 30);
    const frame = makeFrame(timestamp);
    state.exportFrameBuffer.set(timestamp, frame);
    state.exportFramesCts.push(timestamp);
    currentFrame ??= frame;
  }

  try {
    // Seven unsubmitted samples fit in the continuous forward decode window.
    await mode.seekDuringExport(1634 / 30);
    expect(currentFrame?.timestamp).toBe(Math.trunc(1634 * 1e6 / 30));
    expect(decoder.reset).not.toHaveBeenCalled();
    expect(peakSurfaces).toBeLessThanOrEqual(11);
  } finally {
    mode.destroy();
  }
});
