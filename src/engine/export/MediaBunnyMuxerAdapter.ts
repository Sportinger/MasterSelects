/**
 * MediaBunny Muxer Adapter
 *
 * Wraps the MediaBunny library behind a MuxerAdapter interface that can be
 * consumed by VideoEncoderWrapper.  The old mp4-muxer / webm-muxer had
 * synchronous addVideoChunk / addAudioChunk methods, but MediaBunny's
 * EncodedVideoPacketSource.add() and EncodedAudioPacketSource.add() are
 * async.
 *
 * Strategy: queue + flush.
 *   - The VideoEncoder output callback is synchronous, so we cannot await
 *     inside it.  Instead we push chunks to an internal queue.
 *   - Before finalize() we flush the queue by awaiting all pending adds
 *     sequentially (preserving decode order).
 *   - The same applies to audio chunks added via addAudioChunks().
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  StreamTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  type VideoCodec as MBVideoCodec,
  type AudioCodec as MBAudioCodec,
} from 'mediabunny';
import { Logger } from '../../services/logger';
import type { VideoCodec, ContainerFormat } from './types';
import type { ExportDiskSpill } from './exportDiskSpill';
import type { AudioCodec } from '../audio';

const log = Logger.create('MediaBunnyMuxer');

// ---------------------------------------------------------------------------
// Codec mapping helpers
// ---------------------------------------------------------------------------

/** Map internal video codec name to the MediaBunny VideoCodec identifier. */
export function toMediaBunnyVideoCodec(codec: VideoCodec | 'vp8'): MBVideoCodec {
  switch (codec) {
    case 'h264': return 'avc';
    case 'h265': return 'hevc';
    case 'vp8':  return 'vp8';
    case 'vp9':  return 'vp9';
    case 'av1':  return 'av1';
    default:     return 'avc';
  }
}

/** Map internal audio codec name to the MediaBunny AudioCodec identifier. */
export function toMediaBunnyAudioCodec(codec: AudioCodec): MBAudioCodec {
  switch (codec) {
    case 'aac':  return 'aac';
    case 'opus': return 'opus';
    default:     return 'aac';
  }
}

// ---------------------------------------------------------------------------
// MuxerAdapter interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over a muxer so VideoEncoderWrapper does not depend on any
 * specific muxing library.
 */
export interface MuxerAdapter {
  /** Add a single encoded video chunk. May be sync (old muxers) or async (MediaBunny). */
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void | Promise<void>;
  /** Add a single encoded audio chunk. */
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void | Promise<void>;
  /** Finalize the muxer — all queued data is flushed before the output is closed. */
  finalize(): Promise<void>;
  /** Retrieve the finished buffer. Only valid after finalize(). */
  getBuffer(): ArrayBuffer;
  /** Retrieve the finished file. Only valid after finalize(). */
  getBlob(type: string): Promise<Blob>;
}

// ---------------------------------------------------------------------------
// Queued chunk entry (internal)
// ---------------------------------------------------------------------------

/** Eagerly-converted packet entry. We call EncodedPacket.fromEncodedChunk()
 *  at queue time (not flush time) to avoid holding raw EncodedVideoChunk /
 *  EncodedAudioChunk references that could be neutered by the browser. */
interface QueuedVideoPacket {
  kind: 'video';
  packet: EncodedPacket;
  meta?: EncodedVideoChunkMetadata;
}

interface QueuedAudioPacket {
  kind: 'audio';
  packet: EncodedPacket;
  meta?: EncodedAudioChunkMetadata;
}

type QueuedEntry = QueuedVideoPacket | QueuedAudioPacket;

// ---------------------------------------------------------------------------
// MediaBunnyMuxerAdapter
// ---------------------------------------------------------------------------

export interface MediaBunnyMuxerAdapterOptions {
  container: ContainerFormat;
  videoCodec: VideoCodec | 'vp8';
  fps: number;
  hasAudio: boolean;
  audioCodec: AudioCodec;
  /** Writes the file to disk while it is encoded instead of keeping it in memory. */
  spill?: ExportDiskSpill | null;
}

const DISK_CHUNK_BYTES = 16 * 1024 * 1024;
/** Disk mode: encoded data allowed to wait for the disk before the encoder has to wait. */
const MAX_QUEUED_DISK_BYTES = 256 * 1024 * 1024;

export class MediaBunnyMuxerAdapter implements MuxerAdapter {
  private output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget | StreamTarget>;
  private videoSource: EncodedVideoPacketSource;
  private audioSource: EncodedAudioPacketSource | null = null;
  private target: BufferTarget | StreamTarget;
  private spill: ExportDiskSpill | null;
  private queue: QueuedEntry[] = [];
  /** Disk mode: audio encoded up front, entering the file next to the video of the same time. */
  private primedAudio: Array<Extract<QueuedEntry, { kind: 'audio' }>> = [];
  private draining: Promise<void> | null = null;
  private diskFailure: unknown = null;
  private queuedDiskBytes = 0;
  private nextVideoSequenceNumber = 0;
  private nextAudioSequenceNumber = 0;
  private started = false;
  private cancelled = false;

  constructor(options: MediaBunnyMuxerAdapterOptions) {
    const mbVideoCodec = toMediaBunnyVideoCodec(options.videoCodec);
    const mbAudioCodec = toMediaBunnyAudioCodec(options.audioCodec);

    // Create target
    this.spill = options.spill ?? null;
    this.target = this.spill
      ? new StreamTarget(this.spill.writable, { chunked: true, chunkSize: DISK_CHUNK_BYTES })
      : new BufferTarget();

    // Create format
    const format = options.container === 'webm'
      ? new WebMOutputFormat()
      // 'in-memory' would hold every packet until the end; on disk the index simply follows the media.
      : new Mp4OutputFormat({ fastStart: this.spill ? false : 'in-memory' });

    // Create output
    this.output = new Output({ format, target: this.target });

    // Add video track
    this.videoSource = new EncodedVideoPacketSource(mbVideoCodec);
    this.output.addVideoTrack(this.videoSource, { frameRate: options.fps });

    // Add audio track if needed
    if (options.hasAudio) {
      this.audioSource = new EncodedAudioPacketSource(mbAudioCodec);
      this.output.addAudioTrack(this.audioSource);
    }

    log.info(`Created MediaBunny adapter: ${options.container}/${options.videoCodec}` +
      `${options.hasAudio ? '+' + options.audioCodec : ''}`);
  }

  /**
   * Ensure the output is started.  Called lazily on first chunk add so that
   * construction remains synchronous (matching old muxer behaviour).
   */
  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.output.start();
      this.started = true;
    }
  }

  // -- Sync queue interface (called from VideoEncoder output callback) ------
  // Eagerly convert to EncodedPacket to avoid holding raw chunk references
  // that could be neutered by the browser before flush time.

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    const packet = this.createSequencedPacket(chunk, this.nextVideoSequenceNumber++);
    this.queue.push({ kind: 'video', packet, meta });
    this.queuedDiskBytes += packet.byteLength;
    this.scheduleDiskDrain();
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    const packet = this.createSequencedPacket(chunk, this.nextAudioSequenceNumber++);
    this.queue.push({ kind: 'audio', packet, meta });
    this.queuedDiskBytes += packet.byteLength;
    this.scheduleDiskDrain();
  }

  /** Cancel a pending flush. Safe to call from any context. */
  cancel(): void {
    this.cancelled = true;
    void this.spill?.discard();
  }

  get streamsToDisk(): boolean {
    return this.spill !== null;
  }

  /** A failed disk write, so the export stops at once instead of encoding on for nothing. */
  get failure(): unknown {
    return this.diskFailure;
  }

  /** Disk mode writes in arrival order; given the audio up front, the file stays in time order. */
  primeAudio(chunks: readonly EncodedAudioChunk[], metadata: ReadonlyArray<EncodedAudioChunkMetadata | undefined>): void {
    chunks.forEach((chunk, index) => {
      const packet = this.createSequencedPacket(chunk, this.nextAudioSequenceNumber++);
      this.primedAudio.push({ kind: 'audio', packet, meta: metadata[index] });
    });
  }

  /** Keeps complete audio packets only; compressed packets cannot be split. */
  trimPrimedAudio(maxDurationSeconds: number): void {
    const end = this.primedAudio.findIndex(({ packet }) => packet.timestamp + packet.duration > maxDurationSeconds);
    if (end >= 0) this.primedAudio.length = end;
  }

  /** An encoder faster than the disk waits here, so the export stays out of memory. */
  async waitForDiskCapacity(): Promise<void> {
    while (this.spill && this.draining && this.queuedDiskBytes > MAX_QUEUED_DISK_BYTES && !this.cancelled) {
      await this.draining;
    }
  }

  private scheduleDiskDrain(): void {
    if (!this.spill || this.draining) return;
    this.draining = this.drainToDisk()
      .catch((error: unknown) => {
        this.diskFailure ??= error;
        this.queue.length = 0;
        this.queuedDiskBytes = 0;
        log.error('Writing the export to disk failed', error);
      })
      .finally(() => { this.draining = null; });
  }

  private async drainToDisk(): Promise<void> {
    await this.ensureStarted();
    while (this.queue.length > 0 && !this.cancelled && !this.diskFailure) {
      const entry = this.queue.shift()!;
      await this.addEntry(entry);
      this.queuedDiskBytes -= entry.packet.byteLength;
    }
  }

  private async addEntry(entry: QueuedEntry): Promise<void> {
    if (entry.kind === 'video') {
      while (this.primedAudio.length > 0 && this.primedAudio[0].packet.timestamp <= entry.packet.timestamp) {
        const primed = this.primedAudio.shift()!;
        await this.addEntry(primed);
      }
      await this.videoSource.add(entry.packet, entry.meta);
      return;
    }
    if (!this.audioSource) {
      log.warn('Audio packet queued but no audio source configured — skipping');
      return;
    }
    await this.audioSource.add(entry.packet, entry.meta);
  }

  // -- Flush + finalize -----------------------------------------------------

  /**
   * Drain all queued chunks into the MediaBunny output, then finalize.
   */
  async finalize(): Promise<void> {
    await this.ensureStarted();
    if (this.draining) await this.draining;
    if (this.diskFailure) throw this.diskFailure;
    await this.flushQueue();
    for (const primed of this.primedAudio.splice(0)) await this.addEntry(primed);

    // Close sources to signal no more data
    this.videoSource.close();
    if (this.audioSource) {
      this.audioSource.close();
    }

    await this.output.finalize();
    log.info('MediaBunny output finalized');
  }

  getBuffer(): ArrayBuffer {
    const buf = this.target instanceof BufferTarget ? this.target.buffer : null;
    if (!buf) {
      throw new Error('MediaBunny buffer not available — was finalize() called?');
    }
    return buf;
  }

  async getBlob(type: string): Promise<Blob> {
    return this.spill ? this.spill.finish(type) : new Blob([this.getBuffer()], { type });
  }

  // -- Internal helpers -----------------------------------------------------

  private createSequencedPacket(
    chunk: EncodedVideoChunk | EncodedAudioChunk,
    sequenceNumber: number,
  ): EncodedPacket {
    // MediaBunny relies on packet sequence numbers to preserve decode order.
    // The default fromEncodedChunk() value is -1 for every packet, which makes
    // ordering ambiguous for muxing paths that consume queued packets later.
    return EncodedPacket.fromEncodedChunk(chunk).clone({ sequenceNumber });
  }

  private async flushQueue(): Promise<void> {
    const count = this.queue.length;
    if (count === 0) return;

    log.debug(`Flushing ${count} queued packets to MediaBunny`);

    for (const entry of this.queue) {
      if (this.cancelled) {
        log.info(`Flush cancelled with ${count - this.queue.indexOf(entry)} packets remaining`);
        break;
      }

      await this.addEntry(entry);
    }

    this.queue.length = 0;
    log.debug('Queue flushed');
  }
}
