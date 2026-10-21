// src/engine/ffmpeg/bridge/rawFrameBuffer.ts
// Single preallocated RGBA frame store for the FFmpeg WASM export.
//
// FFmpeg reads the rendered frames as one rawvideo file from MEMFS. Keeping
// frames as separate arrays, concatenating them, and copying the result into
// MEMFS needed three full copies of the clip at once and failed with
// "Array buffer allocation failed" on long or high-resolution exports. This
// buffer is allocated once before rendering (so an impossible export fails
// immediately with a clear message), frames are written in place, and MEMFS
// takes ownership of the bytes without another copy.

const BYTES_PER_GIB = 1024 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;

const ALLOCATION_FAILURE_PATTERN =
  /allocation failed|invalid (typed )?array( buffer)? length|out of memory|array buffer.*(too large|exceeds)/i;

export class FFmpegExportMemoryError extends Error {
  readonly requiredBytes: number;

  constructor(requiredBytes: number, frameCount: number, width: number, height: number) {
    super(formatExportMemoryMessage(requiredBytes, frameCount, width, height));
    this.name = 'FFmpegExportMemoryError';
    this.requiredBytes = requiredBytes;
  }
}

function isRangeError(error: unknown): error is Error {
  // Name check too: typed arrays from another realm throw a foreign RangeError.
  return error instanceof RangeError
    || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'RangeError');
}

/** True for browser errors raised when a large ArrayBuffer cannot be allocated. */
export function isAllocationFailure(error: unknown): boolean {
  if (error instanceof FFmpegExportMemoryError) return true;
  return isRangeError(error) && ALLOCATION_FAILURE_PATTERN.test(String(error.message));
}

function formatBytes(bytes: number): string {
  return bytes >= BYTES_PER_GIB
    ? `${(bytes / BYTES_PER_GIB).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / BYTES_PER_MIB))} MB`;
}

export function formatExportMemoryMessage(
  requiredBytes: number,
  frameCount: number,
  width: number,
  height: number,
): string {
  return `Not enough memory for this FFmpeg export: ${frameCount} uncompressed frames at `
    + `${width}x${height} need about ${formatBytes(requiredBytes)}. Use the WebCodecs encoder `
    + '(it streams frames instead of holding them all), or shorten the export range or lower '
    + 'the resolution or frame rate.';
}

export class RawFrameBuffer {
  readonly frameSize: number;
  readonly capacity: number;
  private bytes: Uint8Array<ArrayBuffer> | null;
  private count = 0;

  private constructor(bytes: Uint8Array<ArrayBuffer>, frameSize: number, capacity: number) {
    this.bytes = bytes;
    this.frameSize = frameSize;
    this.capacity = capacity;
  }

  /**
   * Allocate room for `maxFrames` RGBA frames of `width`x`height`.
   * Throws FFmpegExportMemoryError when the browser cannot provide the memory.
   */
  static allocate(width: number, height: number, maxFrames: number): RawFrameBuffer {
    const frameSize = Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)) * 4;
    const capacity = Math.max(1, Math.floor(maxFrames));
    const totalBytes = frameSize * capacity;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(totalBytes);
    } catch (error) {
      if (isRangeError(error)) {
        throw new FFmpegExportMemoryError(totalBytes, capacity, width, height);
      }
      throw error;
    }
    return new RawFrameBuffer(bytes, frameSize, capacity);
  }

  get frameCount(): number {
    return this.count;
  }

  get byteLength(): number {
    return this.count * this.frameSize;
  }

  /** Copy one RGBA frame into the next slot and return a view of that slot. */
  writeFrame(pixels: ArrayLike<number> & { length: number }): Uint8Array<ArrayBuffer> {
    if (!this.bytes) throw new Error('Raw frame buffer was already handed to FFmpeg');
    if (pixels.length !== this.frameSize) {
      throw new Error(`Rendered frame has ${pixels.length} bytes, expected ${this.frameSize}`);
    }
    if (this.count >= this.capacity) {
      throw new Error(`Raw frame buffer is full (${this.capacity} frames)`);
    }
    const offset = this.count * this.frameSize;
    const slot = this.bytes.subarray(offset, offset + this.frameSize);
    slot.set(pixels);
    this.count += 1;
    return slot;
  }

  /**
   * Hand the written frames over (no copy) and drop this buffer's reference,
   * so the only owner afterwards is the FFmpeg virtual file.
   */
  take(): Uint8Array<ArrayBuffer> {
    if (!this.bytes) throw new Error('Raw frame buffer was already handed to FFmpeg');
    const written = this.bytes.subarray(0, this.byteLength);
    this.bytes = null;
    return written;
  }

  release(): void {
    this.bytes = null;
  }
}
