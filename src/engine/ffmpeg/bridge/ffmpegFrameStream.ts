// src/engine/ffmpeg/bridge/ffmpegFrameStream.ts
// Streaming FFmpeg export: rendered frames go into a bounded RGBA buffer,
// every full buffer is encoded into a compressed segment file in MEMFS, and
// finish() joins the segments (plus audio) into the final container. Peak raw
// memory is one segment instead of the whole range; only the compressed video
// grows with the export length.

import type { FFmpegExportSettings, FFmpegProgress } from '../types';
import { Logger } from '../../../services/logger';
import {
  audioBufferToPCM,
  buildSegmentAssemblyArgs,
  buildSegmentConcatList,
  buildSegmentEncodeArgs,
  segmentContainer,
} from './ffmpegEncodeArgs';
import { containerMimeType } from './ffmpegLogParsing';
import { FFmpegExportMemoryError, RawFrameBuffer, isAllocationFailure } from './rawFrameBuffer';

const log = Logger.create('FFmpegFrameStream');

/** Raw RGBA bytes held per segment before FFmpeg compresses them. */
export const DEFAULT_SEGMENT_BUDGET_BYTES = 256 * 1024 * 1024;

export class FFmpegExportCancelledError extends Error {
  constructor() {
    super('FFmpeg export cancelled');
    this.name = 'FFmpegExportCancelledError';
  }
}

export interface FFmpegFrameStreamFS {
  writeFile: (path: string, data: Uint8Array | string, opts?: { canOwn?: boolean }) => void;
  readFile: (path: string) => Uint8Array<ArrayBuffer>;
  unlink: (path: string) => void;
  readdir: (path: string) => string[];
  mkdir: (path: string) => void;
  rmdir?: (path: string) => void;
  stat?: (path: string) => { size: number };
}

/** The pieces of the FFmpeg bridge a stream needs; keeps the core private. */
export interface FFmpegFrameStreamHost {
  readonly fs: FFmpegFrameStreamFS;
  /** Run one FFmpeg command; throws with the log tail on a non-zero exit. */
  run(args: string[], label: string, progress?: { totalFrames: number; onProgress?: (p: FFmpegProgress) => void }): void;
  /** Called once the stream finished or was aborted. */
  onClosed(stream: FFmpegFrameStream): void;
}

export interface FFmpegFrameStreamOptions {
  settings: FFmpegExportSettings;
  /** Frames the caller plans to write; only sizes the segment buffer. */
  expectedFrames: number;
  directory: string;
  segmentBudgetBytes?: number;
}

interface EncodedSegment {
  path: string;
  frameCount: number;
}

export class FFmpegFrameStream {
  private readonly host: FFmpegFrameStreamHost;
  private readonly settings: FFmpegExportSettings;
  private readonly directory: string;
  private readonly extension: string;
  private buffer: RawFrameBuffer | null;
  private readonly segments: EncodedSegment[] = [];
  private encodedBytes = 0;
  private framesWritten = 0;
  private cancelled = false;
  private closed = false;

  constructor(host: FFmpegFrameStreamHost, options: FFmpegFrameStreamOptions) {
    this.host = host;
    this.settings = options.settings;
    this.directory = options.directory;
    this.extension = segmentContainer(options.settings);
    const frameBytes = Math.max(1, options.settings.width * options.settings.height * 4);
    const budget = options.segmentBudgetBytes ?? DEFAULT_SEGMENT_BUDGET_BYTES;
    const preferredFrames = Math.max(1, Math.min(
      Math.ceil(Math.max(1, options.expectedFrames)),
      Math.floor(budget / frameBytes),
    ));
    this.buffer = RawFrameBuffer.allocateBounded(options.settings.width, options.settings.height, preferredFrames);
    if (this.buffer.capacity < preferredFrames) {
      log.warn('FFmpeg segment buffer reduced to fit the available memory', {
        preferredFrames,
        frames: this.buffer.capacity,
      });
    }
    try { host.fs.mkdir(this.directory); } catch { /* exists */ }
  }

  /** Frames accepted so far, including those not yet encoded. */
  get frameCount(): number {
    return this.framesWritten;
  }

  get segmentFrames(): number {
    return this.buffer?.capacity ?? 0;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Copy one RGBA frame into the segment buffer and return its slot, which the
   * caller may still adjust (e.g. force opaque alpha). A full segment is
   * encoded at the start of the following write, never before that.
   */
  writeFrame(pixels: ArrayLike<number> & { length: number }): Uint8Array<ArrayBuffer> {
    const buffer = this.requireOpen();
    if (buffer.isFull) this.encodePendingSegment();
    const slot = buffer.writeFrame(pixels);
    this.framesWritten += 1;
    return slot;
  }

  /** Encode the remaining frames, join all segments with audio, and return the file. */
  async finish(
    audioBuffer?: AudioBuffer | null,
    onProgress?: (progress: FFmpegProgress) => void,
  ): Promise<Blob> {
    this.requireOpen();
    try {
      if (this.framesWritten === 0) throw new Error('No frames to encode');
      this.encodePendingSegment();
      this.buffer?.release();
      this.buffer = null;
      this.throwIfCancelled();

      const listPath = `${this.directory}/segments.ffconcat`;
      this.host.fs.writeFile(listPath, buildSegmentConcatList(this.segments, this.settings.fps));
      let audio: { path: string; buffer: AudioBuffer } | null = null;
      const supportsAudio = this.settings.container !== 'gif' && this.settings.codec !== 'gif';
      if (supportsAudio && audioBuffer && audioBuffer.length > 0) {
        const path = `${this.directory}/audio.raw`;
        const pcm = audioBufferToPCM(audioBuffer);
        this.host.fs.writeFile(path, new Uint8Array(pcm.buffer), { canOwn: true });
        audio = { path, buffer: audioBuffer };
        log.debug(`Audio: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);
      }

      const outputPath = `${this.directory}/output.${this.settings.container}`;
      const args = buildSegmentAssemblyArgs(this.settings, listPath, this.framesWritten, audio, outputPath);
      try {
        this.host.run(args, `joining ${this.segments.length} segments`, { totalFrames: this.framesWritten, onProgress });
      } catch (error) {
        throw isAllocationFailure(error) ? FFmpegExportMemoryError.forOutput(this.encodedBytes) : error;
      }
      // Segments and audio are no longer needed once the final file exists.
      for (const segment of this.segments) this.unlinkQuietly(segment.path);
      if (audio) this.unlinkQuietly(audio.path);
      this.throwIfCancelled();

      let data: Uint8Array<ArrayBuffer>;
      try {
        data = this.host.fs.readFile(outputPath);
      } catch (error) {
        throw isAllocationFailure(error)
          ? FFmpegExportMemoryError.forOutput(this.fileSize(outputPath) ?? this.encodedBytes)
          : error;
      }
      log.info(`Output file size: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB from ${this.segments.length} segments`);
      return new Blob([data], { type: containerMimeType(this.settings.container) });
    } finally {
      this.close();
    }
  }

  /** Drop all frames and temporary files. Safe to call more than once. */
  abort(): void {
    if (!this.closed) this.close();
  }

  private encodePendingSegment(): void {
    const buffer = this.buffer;
    if (!buffer || buffer.frameCount === 0) return;
    this.throwIfCancelled();
    const index = this.segments.length;
    const rawPath = `${this.directory}/segment.raw`;
    const segmentPath = `${this.directory}/segment-${String(index).padStart(5, '0')}.${this.extension}`;
    const firstFrame = this.framesWritten - buffer.frameCount;
    // MEMFS keeps a view of our buffer (canOwn); it is unlinked before reuse.
    this.host.fs.writeFile(rawPath, buffer.written(), { canOwn: true });
    try {
      this.host.run(
        buildSegmentEncodeArgs(this.settings, rawPath, buffer.frameCount, segmentPath),
        `segment ${index + 1} (frames ${firstFrame + 1}-${this.framesWritten})`,
      );
    } catch (error) {
      throw isAllocationFailure(error)
        ? FFmpegExportMemoryError.forEncoded(this.encodedBytes, this.framesWritten)
        : error;
    } finally {
      this.unlinkQuietly(rawPath);
    }
    const size = this.fileSize(segmentPath);
    if (size !== null) this.encodedBytes += size;
    this.segments.push({ path: segmentPath, frameCount: buffer.frameCount });
    log.debug(`Encoded segment ${index + 1}: ${buffer.frameCount} frames, ${size ?? '?'} bytes`);
    buffer.clear();
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new FFmpegExportCancelledError();
  }

  private requireOpen(): RawFrameBuffer {
    if (this.closed || !this.buffer) throw new Error('FFmpeg frame stream is already closed');
    return this.buffer;
  }

  private fileSize(path: string): number | null {
    try {
      return this.host.fs.stat?.(path).size ?? null;
    } catch {
      return null;
    }
  }

  private unlinkQuietly(path: string): void {
    try { this.host.fs.unlink(path); } catch { /* already gone */ }
  }

  private close(): void {
    this.closed = true;
    this.buffer?.release();
    this.buffer = null;
    let entries: string[] = [];
    try { entries = this.host.fs.readdir(this.directory); } catch { /* never created */ }
    for (const entry of entries) {
      if (entry === '.' || entry === '..') continue;
      try { this.host.fs.unlink(`${this.directory}/${entry}`); } catch (error) {
        log.warn(`Could not remove FFmpeg export file ${entry}`, error);
      }
    }
    try { this.host.fs.rmdir?.(this.directory); } catch { /* not empty or missing */ }
    this.host.onClosed(this);
  }
}
