import { beforeEach, expect, it, vi } from 'vitest';
import { WebCodecsExportMode, type ExportModePlayer } from '../../src/engine/WebCodecsExportMode';
import type { Sample } from '../../src/engine/webCodecsTypes';

beforeEach(() => {
  vi.stubGlobal('EncodedVideoChunk', class {
    timestamp: number;
    constructor(init: EncodedVideoChunkInit) { this.timestamp = Math.trunc(init.timestamp); }
  });
});

function createExport(missing: boolean) {
  let currentFrame: VideoFrame | null = null;
  let decoderMissing = false;
  let recovered = false;
  const samples = Array.from({ length: 60 }, (_, index) => ({ number: index, track_id: 1,
    cts: index, dts: index, duration: 1, timescale: 30, is_sync: index % 30 === 0,
    size: 1, data: new ArrayBuffer(1) } as Sample));
  const emit = (timestamp: number) => mode.handleDecoderOutput({ timestamp, close: vi.fn() } as unknown as VideoFrame);
  const decoder = { state: 'configured', decodeQueueSize: 0, reset: vi.fn(), configure: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined), decode: vi.fn((chunk: EncodedVideoChunk) => {
      if (Math.abs(chunk.timestamp - 4e6 / 30) < 1) {
        if (!missing || recovered) setTimeout(() => emit(chunk.timestamp), 20);
      } else emit(chunk.timestamp);
    }) };
  const recreateExportDecoder = vi.fn(() => {
    decoderMissing = false;
    recovered = true;
    return decoder as unknown as VideoDecoder;
  });
  const player: ExportModePlayer = { getDecoder: () => decoderMissing ? null : decoder as unknown as VideoDecoder,
    getSamples: () => samples, getSampleIndex: () => 0, setSampleIndex: vi.fn(),
    getVideoTrackTimescale: () => 30, getCodecConfig: () => ({ codec: 'avc1.test' }),
    getFrameRate: () => 30, getCurrentFrame: () => currentFrame,
    setCurrentFrame: frame => { currentFrame = frame; }, isSimpleMode: () => false, seekAsync: vi.fn() };
  const mode = new WebCodecsExportMode(player);
  return { mode, current: () => currentFrame, loseDecoder: () => {
    decoderMissing = true;
    player.recreateExportDecoder = recreateExportDecoder;
  }, recreateExportDecoder };
}

it('waits for the requested source frame instead of exporting its buffered neighbor', async () => {
  const { mode, current } = createExport(false);
  await mode.prepareForSequentialExport(0);
  await mode.seekDuringExport(4 / 30);
  expect(current()?.timestamp).toBe(Math.trunc(4e6 / 30));
  mode.endSequentialExport();
});

it('submits later samples when a reordered target frame is withheld beyond the first decode window', async () => {
  let currentFrame: VideoFrame | null = null;
  const samples = Array.from({ length: 60 }, (_, index) => ({ number: index, track_id: 1,
    cts: index, dts: index, duration: 1, timescale: 30, is_sync: index % 30 === 0,
    size: 1, data: new ArrayBuffer(1) } as Sample));
  const delayedTargetCts = Math.trunc(4e6 / 30);
  let heldTarget: number | null = null;
  const emit = (timestamp: number) => mode.handleDecoderOutput({ timestamp, close: vi.fn() } as unknown as VideoFrame);
  const decoder = { state: 'configured', decodeQueueSize: 0, reset: vi.fn(), configure: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined), decode: vi.fn((chunk: EncodedVideoChunk) => {
      if (chunk.timestamp === delayedTargetCts) {
        heldTarget = chunk.timestamp;
      } else {
        emit(chunk.timestamp);
      }
      if (chunk.timestamp >= Math.trunc(10e6 / 30) && heldTarget !== null) {
        emit(heldTarget);
        heldTarget = null;
      }
    }) };
  const player: ExportModePlayer = { getDecoder: () => decoder as unknown as VideoDecoder,
    getSamples: () => samples, getSampleIndex: () => 0, setSampleIndex: vi.fn(),
    getVideoTrackTimescale: () => 30, getCodecConfig: () => ({ codec: 'avc1.test' }),
    getFrameRate: () => 30, getCurrentFrame: () => currentFrame,
    setCurrentFrame: frame => { currentFrame = frame; }, isSimpleMode: () => false, seekAsync: vi.fn() };
  const mode = new WebCodecsExportMode(player);

  await mode.prepareForSequentialExport(0);
  await expect(mode.seekDuringExport(4 / 30)).resolves.toBeUndefined();
  expect(currentFrame?.timestamp).toBe(delayedTargetCts);
  expect(decoder.decode.mock.calls.some(([chunk]) => chunk.timestamp >= Math.trunc(10e6 / 30))).toBe(true);
  mode.endSequentialExport();
});

it('fails FAST export when the exact source frame never arrives instead of substituting a hold', async () => {
  const { mode } = createExport(true);
  await mode.prepareForSequentialExport(0);
  await expect(mode.seekDuringExport(4 / 30)).rejects.toThrow('could not decode frame');
  expect((mode as unknown as { exportFrameBuffer: Map<number, VideoFrame> }).exportFrameBuffer.size)
    .toBeLessThanOrEqual(8);
  mode.endSequentialExport();
});

it('recovers a decoder lost while waiting for the exact source frame', async () => {
  const { mode, current, loseDecoder, recreateExportDecoder } = createExport(true);
  await mode.prepareForSequentialExport(0);
  const pendingFrame = mode.seekDuringExport(4 / 30);
  setTimeout(loseDecoder, 10);
  await pendingFrame;
  expect(recreateExportDecoder).toHaveBeenCalledTimes(1);
  expect(current()?.timestamp).toBe(Math.trunc(4e6 / 30));
  mode.endSequentialExport();
});

it('fails explicitly when the lost decoder cannot be recreated', async () => {
  const { mode, loseDecoder, recreateExportDecoder } = createExport(true);
  await mode.prepareForSequentialExport(0);
  recreateExportDecoder.mockImplementation(() => { throw new Error('Decoder unavailable'); });
  const pendingFrame = mode.seekDuringExport(4 / 30);
  setTimeout(loseDecoder, 10);
  await expect(pendingFrame).rejects.toThrow('Decoder unavailable');
  expect(recreateExportDecoder).toHaveBeenCalledTimes(1);
  mode.endSequentialExport();
});
