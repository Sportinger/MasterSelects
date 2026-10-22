// src/engine/ffmpeg/bridge/rawFrameBuffer.ts
// Bounded RGBA segment buffer for the streaming FFmpeg WASM export.
//
// The export used to reserve the whole uncompressed range at once (4.6 GB for
// 20 s of 1080p30), which Chrome refuses on ordinary machines. Frames are now
// rendered into one buffer of a few hundred MB that holds a single segment;
// FFmpeg encodes the segment, the buffer is cleared and reused, so peak raw
// memory no longer grows with the export length.

const BYTES_PER_GIB = 1024 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;

const ALLOCATION_FAILURE_PATTERN =
  /allocation failed|invalid (typed )?array( buffer)? length|out of memory|array buffer.*(too large|exceeds)/i;

/** Which part of the FFmpeg export ran out of memory. */
export type FFmpegExportMemoryStage = 'frames' | 'encoded' | 'output';

export class FFmpegExportMemoryError extends Error {
  readonly requiredBytes: number;
  readonly stage: FFmpegExportMemoryStage;

  constructor(message: string, requiredBytes: number, stage: FFmpegExportMemoryStage) {
    super(message);
    this.name = 'FFmpegExportMemoryError';
    this.requiredBytes = requiredBytes;
    this.stage = stage;
  }

  /** The uncompressed frame buffer for one segment could not be reserved. */
  static forFrames(requiredBytes: number, frameCount: number, width: number, height: number): FFmpegExportMemoryError {
    return new FFmpegExportMemoryError(
      `Not enough memory for this FFmpeg export: even ${frameCount} uncompressed `
        + `${frameCount === 1 ? 'frame' : 'frames'} at ${width}x${height} (about ${formatBytes(requiredBytes)}) `
        + 'could not be reserved. Close other tabs or apps, lower the resolution, or use the WebCodecs encoder.',
      requiredBytes,
      'frames',
    );
  }

  /** The encoded segments FFmpeg keeps in memory grew too large. */
  static forEncoded(encodedBytes: number, frameCount: number): FFmpegExportMemoryError {
    return new FFmpegExportMemoryError(
      `Not enough memory to keep the encoded FFmpeg video: about ${formatBytes(encodedBytes)} after `
        + `${frameCount} frames. Choose a more compact codec or profile (for example ProRes LT or MJPEG), `
        + 'shorten the export range, or use the WebCodecs encoder.',
      encodedBytes,
      'encoded',
    );
  }

  /** Assembling or reading out the finished file failed. */
  static forOutput(outputBytes: number): FFmpegExportMemoryError {
    return new FFmpegExportMemoryError(
      `Not enough memory to hand over the finished FFmpeg file (about ${formatBytes(outputBytes)} encoded). `
        + 'Choose a more compact codec or profile (for example ProRes LT or MJPEG), shorten the export '
        + 'range, or use the WebCodecs encoder.',
      outputBytes,
      'output',
    );
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

export function formatBytes(bytes: number): string {
  return bytes >= BYTES_PER_GIB
    ? `${(bytes / BYTES_PER_GIB).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / BYTES_PER_MIB))} MB`;
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
        throw FFmpegExportMemoryError.forFrames(totalBytes, capacity, width, height);
      }
      throw error;
    }
    return new RawFrameBuffer(bytes, frameSize, capacity);
  }

  /**
   * Allocate up to `preferredFrames` frames, halving the capacity while the
   * browser refuses the memory. Only fails when a single frame cannot fit.
   */
  static allocateBounded(width: number, height: number, preferredFrames: number): RawFrameBuffer {
    let frames = Math.max(1, Math.floor(preferredFrames));
    for (;;) {
      try {
        return RawFrameBuffer.allocate(width, height, frames);
      } catch (error) {
        if (!(error instanceof FFmpegExportMemoryError) || frames === 1) throw error;
        frames = Math.max(1, Math.floor(frames / 2));
      }
    }
  }

  get frameCount(): number {
    return this.count;
  }

  get byteLength(): number {
    return this.count * this.frameSize;
  }

  get isFull(): boolean {
    return this.count >= this.capacity;
  }

  /** Copy one RGBA frame into the next slot and return a view of that slot. */
  writeFrame(pixels: ArrayLike<number> & { length: number }): Uint8Array<ArrayBuffer> {
    if (!this.bytes) throw new Error('Raw frame buffer was already released');
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
   * View of the frames written since the last clear(). The view aliases the
   * buffer: the consumer must be done with it before clear() and new writes.
   */
  written(): Uint8Array<ArrayBuffer> {
    if (!this.bytes) throw new Error('Raw frame buffer was already released');
    return this.bytes.subarray(0, this.byteLength);
  }

  /** Start the next segment in the same memory. */
  clear(): void {
    this.count = 0;
  }

  release(): void {
    this.bytes = null;
    this.count = 0;
  }
}
