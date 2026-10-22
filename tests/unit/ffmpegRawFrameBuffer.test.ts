import { afterEach, describe, expect, it, vi } from 'vitest';
import { FFmpegBridge } from '../../src/engine/ffmpeg/FFmpegBridge';
import { FFmpegExportCancelledError } from '../../src/engine/ffmpeg/bridge/ffmpegFrameStream';
import {
  FFmpegExportMemoryError,
  RawFrameBuffer,
  isAllocationFailure,
} from '../../src/engine/ffmpeg/bridge/rawFrameBuffer';
import type { FFmpegExportSettings } from '../../src/engine/ffmpeg/types';

const FRAME_BYTES = 8; // 2x1 RGBA
const settings: FFmpegExportSettings = {
  codec: 'prores',
  container: 'mov',
  width: 2,
  height: 1,
  fps: 30,
  startTime: 0,
  endTime: 1,
  proresProfile: 'hq',
};

function createCore() {
  const files = new Map<string, Uint8Array | string>();
  const rawSizes: number[] = [];
  const core = {
    FS: {
      writeFile: vi.fn((path: string, data: Uint8Array | string) => {
        if (path.endsWith('.raw') && typeof data !== 'string' && path.includes('segment')) rawSizes.push(data.byteLength);
        files.set(path, data);
      }),
      readFile: vi.fn((path: string) => files.get(path) as Uint8Array<ArrayBuffer>),
      unlink: vi.fn((path: string) => { files.delete(path); }),
      readdir: vi.fn((dir: string) => ['.', '..', ...[...files.keys()]
        .filter(path => path.startsWith(`${dir}/`))
        .map(path => path.slice(dir.length + 1))]),
      mkdir: vi.fn(),
      rmdir: vi.fn(),
      stat: vi.fn((path: string) => ({ size: (files.get(path) as Uint8Array | undefined)?.byteLength ?? 0 })),
    },
    // Each run "encodes" its output path into a 3-byte file.
    exec: vi.fn((...args: string[]) => {
      files.set(args[args.length - 1], new Uint8Array([1, 2, 3]));
      return 0;
    }),
    setLogger: vi.fn(),
    setProgress: vi.fn(),
    reset: vi.fn(),
    ret: 0,
  };
  return { core, files, rawSizes };
}

function bridgeWith(core: unknown): FFmpegBridge {
  const bridge = new FFmpegBridge();
  (bridge as unknown as { ffmpeg: unknown }).ffmpeg = core;
  return bridge;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RawFrameBuffer', () => {
  it('reuses one segment buffer: frames are written in place and cleared per segment', () => {
    const buffer = RawFrameBuffer.allocate(2, 1, 2);
    const slot = buffer.writeFrame(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]));
    slot[3] = 255;
    buffer.writeFrame(new Uint8Array(FRAME_BYTES).fill(9));
    expect(buffer.isFull).toBe(true);
    expect(Array.from(buffer.written().subarray(0, 8))).toEqual([1, 2, 3, 255, 5, 6, 7, 8]);
    expect(buffer.written().buffer).toBe(slot.buffer);

    buffer.clear();
    expect(buffer.frameCount).toBe(0);
    expect(buffer.writeFrame(new Uint8Array(FRAME_BYTES)).buffer).toBe(slot.buffer);
    expect(() => buffer.writeFrame(new Uint8Array(4))).toThrow(/expected 8/);
  });

  it('shrinks the segment when memory is short and only fails when one frame cannot fit', () => {
    const allocate = RawFrameBuffer.allocate.bind(RawFrameBuffer);
    vi.spyOn(RawFrameBuffer, 'allocate').mockImplementation((w, h, frames) => {
      if (frames > 3) throw FFmpegExportMemoryError.forFrames(frames * 8, frames, w, h);
      return allocate(w, h, frames);
    });
    expect(RawFrameBuffer.allocateBounded(2, 1, 32).capacity).toBe(2);

    vi.restoreAllMocks();
    let error: unknown;
    try {
      RawFrameBuffer.allocateBounded(134_217_728, 134_217_728, 64);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FFmpegExportMemoryError);
    expect((error as FFmpegExportMemoryError).stage).toBe('frames');
    expect((error as Error).message).toMatch(/even 1 uncompressed frame/);
  });

  it('recognizes browser allocation failures only', () => {
    expect(isAllocationFailure(new RangeError('Array buffer allocation failed'))).toBe(true);
    expect(isAllocationFailure(new RangeError('Invalid typed array length: 5'))).toBe(true);
    expect(isAllocationFailure(new RangeError('Maximum call stack size exceeded'))).toBe(false);
    expect(isAllocationFailure(new Error('Array buffer allocation failed'))).toBe(false);
  });
});

describe('FFmpeg frame stream', () => {
  it('encodes bounded segments while frames arrive and joins them into one file', async () => {
    const { core, files, rawSizes } = createCore();
    const bridge = bridgeWith(core);
    const stream = await bridge.openFrameStream(settings, 5, { segmentBudgetBytes: 2 * FRAME_BYTES });
    expect(stream.segmentFrames).toBe(2);

    for (let i = 0; i < 5; i++) stream.writeFrame(new Uint8Array(FRAME_BYTES).fill(i));
    // Two full segments were encoded before the fifth frame was accepted.
    expect(core.exec).toHaveBeenCalledTimes(2);

    const blob = await stream.finish();
    expect(rawSizes).toEqual([16, 16, 8]);
    const list = [...core.FS.writeFile.mock.calls].find(([path]) => String(path).endsWith('.ffconcat'))?.[1];
    expect(list).toContain("segment-00002.mov'");
    expect(list).toContain('duration 0.033333');
    const joinArgs = core.exec.mock.calls[3];
    expect(joinArgs).toEqual(expect.arrayContaining(['-f', 'concat', '-c:v', 'copy', '-frames:v', '5']));
    expect(blob.size).toBe(3);
    expect(files.size).toBe(0);
  });

  it('stops at the next segment when the export is cancelled', async () => {
    const { core, files } = createCore();
    const bridge = bridgeWith(core);
    const stream = await bridge.openFrameStream(settings, 10, { segmentBudgetBytes: 2 * FRAME_BYTES });
    stream.writeFrame(new Uint8Array(FRAME_BYTES));
    stream.writeFrame(new Uint8Array(FRAME_BYTES));
    stream.writeFrame(new Uint8Array(FRAME_BYTES));
    expect(core.exec).toHaveBeenCalledTimes(1);

    bridge.cancel();
    stream.writeFrame(new Uint8Array(FRAME_BYTES));
    expect(() => stream.writeFrame(new Uint8Array(FRAME_BYTES))).toThrow(FFmpegExportCancelledError);
    await expect(stream.finish()).rejects.toThrow(/already closed|cancelled/);
    stream.abort();
    expect(core.exec).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(0);

    // A new stream starts uncancelled.
    const next = await bridge.openFrameStream(settings, 1);
    next.writeFrame(new Uint8Array(FRAME_BYTES));
    await expect(next.finish()).resolves.toBeInstanceOf(Blob);
  });

  it('blames the finished file, not the raw frames, when reading the output runs out of memory', async () => {
    const { core } = createCore();
    core.FS.readFile.mockImplementation(() => { throw new RangeError('Array buffer allocation failed'); });
    const bridge = bridgeWith(core);
    const stream = await bridge.openFrameStream(settings, 1);
    stream.writeFrame(new Uint8Array(FRAME_BYTES));

    const error = await stream.finish().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FFmpegExportMemoryError);
    expect((error as FFmpegExportMemoryError).stage).toBe('output');
    expect((error as Error).message).toMatch(/finished FFmpeg file/);
    expect((error as Error).message).not.toMatch(/uncompressed/);
  });
});
