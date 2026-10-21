import { describe, expect, it, vi } from 'vitest';
import { FFmpegBridge } from '../../src/engine/ffmpeg/FFmpegBridge';
import {
  FFmpegExportMemoryError,
  RawFrameBuffer,
  isAllocationFailure,
} from '../../src/engine/ffmpeg/bridge/rawFrameBuffer';
import type { FFmpegExportSettings } from '../../src/engine/ffmpeg/types';

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

function createCore(readFile: (path: string) => Uint8Array<ArrayBuffer>) {
  const files = new Map<string, Uint8Array>();
  const writeFile = vi.fn((path: string, data: Uint8Array) => { files.set(path, data); });
  return {
    files,
    writeFile,
    core: {
      FS: {
        writeFile,
        readFile: vi.fn(readFile),
        unlink: vi.fn((path: string) => { files.delete(path); }),
        readdir: vi.fn((dir: string) => ['.', '..', ...[...files.keys()]
          .filter(path => path.startsWith(`${dir}/`))
          .map(path => path.slice(dir.length + 1))]),
        mkdir: vi.fn(),
      },
      exec: vi.fn(() => 0),
      setLogger: vi.fn(),
      setProgress: vi.fn(),
      reset: vi.fn(),
      ret: 0,
    },
  };
}

function attachCore(bridge: FFmpegBridge, core: unknown): void {
  (bridge as unknown as { ffmpeg: unknown }).ffmpeg = core;
}

describe('RawFrameBuffer', () => {
  it('writes frames in place and hands them to FFmpeg without a copy', () => {
    const buffer = RawFrameBuffer.allocate(2, 1, 3);
    const slot = buffer.writeFrame(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]));
    slot[3] = 255;
    buffer.writeFrame(new Uint8Array(8).fill(9));

    const bytes = buffer.take();
    expect(buffer.frameCount).toBe(2);
    expect(bytes.byteLength).toBe(16);
    expect(bytes.buffer).toBe(slot.buffer);
    expect(Array.from(bytes.subarray(0, 8))).toEqual([1, 2, 3, 255, 5, 6, 7, 8]);
    expect(() => buffer.writeFrame(new Uint8Array(8))).toThrow(/already handed/);
  });

  it('rejects frames of the wrong size', () => {
    const buffer = RawFrameBuffer.allocate(2, 1, 1);
    expect(() => buffer.writeFrame(new Uint8Array(4))).toThrow(/expected 8/);
  });

  it('turns an impossible allocation into an actionable memory error', () => {
    let error: unknown;
    try {
      RawFrameBuffer.allocate(100_000, 100_000, 1_000_000);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FFmpegExportMemoryError);
    expect((error as Error).message).toMatch(/Not enough memory.*WebCodecs/);
    expect(isAllocationFailure(error)).toBe(true);
  });

  it('recognizes browser allocation failures only', () => {
    expect(isAllocationFailure(new RangeError('Array buffer allocation failed'))).toBe(true);
    expect(isAllocationFailure(new RangeError('Invalid typed array length: 5'))).toBe(true);
    expect(isAllocationFailure(new RangeError('Maximum call stack size exceeded'))).toBe(false);
    expect(isAllocationFailure(new Error('Array buffer allocation failed'))).toBe(false);
  });
});

describe('FFmpegBridge.encodeRawFrames', () => {
  it('lets MEMFS own the frame bytes and frees the input before reading the output', async () => {
    const bridge = new FFmpegBridge();
    const output = new Uint8Array([7, 7, 7]);
    const { core, files, writeFile } = createCore((path) => {
      expect(files.has('/input/frames.raw')).toBe(false);
      expect(path).toBe('/output/output.mov');
      return output;
    });
    core.exec.mockImplementation(() => {
      files.set('/output/output.mov', output);
      return 0;
    });
    attachCore(bridge, core);

    const buffer = RawFrameBuffer.allocate(2, 1, 4);
    const slot = buffer.writeFrame(new Uint8Array(8).fill(1));
    buffer.writeFrame(new Uint8Array(8).fill(2));

    const blob = await bridge.encodeRawFrames(buffer, settings);

    const [path, data, opts] = writeFile.mock.calls[0];
    expect(path).toBe('/input/frames.raw');
    expect(opts).toEqual({ canOwn: true });
    expect(data.buffer).toBe(slot.buffer);
    expect(data.byteLength).toBe(16);
    expect(blob.size).toBe(3);
  });

  it('reports an allocation failure during encoding as an export memory error', async () => {
    const bridge = new FFmpegBridge();
    const { core } = createCore(() => {
      throw new RangeError('Array buffer allocation failed');
    });
    attachCore(bridge, core);

    const buffer = RawFrameBuffer.allocate(2, 1, 1);
    buffer.writeFrame(new Uint8Array(8));

    await expect(bridge.encodeRawFrames(buffer, settings)).rejects.toBeInstanceOf(FFmpegExportMemoryError);
  });
});
