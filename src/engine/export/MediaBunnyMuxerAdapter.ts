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
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  type VideoCodec as MBVideoCodec,
  type AudioCodec as MBAudioCodec,
} from 'mediabunny';
import { Logger } from '../../services/logger';
import type { VideoCodec, ContainerFormat } from './types';
import type { AudioCodec } from '../audio';

const log = Logger.create('MediaBunnyMuxer');

// ---------------------------------------------------------------------------
// Codec mapping helpers
// ---------------------------------------------------------------------------

/** Map internal video codec name to the MediaBunny VideoCodec identifier. */
export function toMediaBunnyVideoCodec(codec: VideoCodec): MBVideoCodec {
  switch (codec) {
    case 'h264': return 'avc';
    case 'h265': return 'hevc';
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
  videoCodec: VideoCodec;
  fps: number;
  hasAudio: boolean;
  audioCodec: AudioCodec;
}

export class MediaBunnyMuxerAdapter implements MuxerAdapter {
  private output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget>;
  private videoSource: EncodedVideoPacketSource;
  private audioSource: EncodedAudioPacketSource | null = null;
  private target: BufferTarget;
  private queue: QueuedEntry[] = [];
  private started = false;
  private cancelled = false;

  constructor(options: MediaBunnyMuxerAdapterOptions) {
    const mbVideoCodec = toMediaBunnyVideoCodec(options.videoCodec);
    const mbAudioCodec = toMediaBunnyAudioCodec(options.audioCodec);

    // Create target
    this.target = new BufferTarget();

    // Create format
    const format = options.container === 'webm'
      ? new WebMOutputFormat()
      : new Mp4OutputFormat({ fastStart: 'in-memory' });

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
    const packet = EncodedPacket.fromEncodedChunk(chunk);
    this.queue.push({ kind: 'video', packet, meta });
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    const packet = EncodedPacket.fromEncodedChunk(chunk);
    this.queue.push({ kind: 'audio', packet, meta });
  }

  /** Cancel a pending flush. Safe to call from any context. */
  cancel(): void {
    this.cancelled = true;
  }

  // -- Flush + finalize -----------------------------------------------------

  /**
   * Drain all queued chunks into the MediaBunny output, then finalize.
   */
  async finalize(): Promise<void> {
    await this.ensureStarted();
    await this.flushQueue();

    // Close sources to signal no more data
    this.videoSource.close();
    if (this.audioSource) {
      this.audioSource.close();
    }

    await this.output.finalize();
    log.info('MediaBunny output finalized');
  }

  getBuffer(): ArrayBuffer {
    const buf = this.target.buffer;
    if (!buf) {
      throw new Error('MediaBunny buffer not available — was finalize() called?');
    }
    return buf;
  }

  // -- Internal helpers -----------------------------------------------------

  private async flushQueue(): Promise<void> {
    const count = this.queue.length;
    if (count === 0) return;

    log.debug(`Flushing ${count} queued packets to MediaBunny`);

    for (const entry of this.queue) {
      if (this.cancelled) {
        log.info(`Flush cancelled with ${count - this.queue.indexOf(entry)} packets remaining`);
        break;
      }

      if (entry.kind === 'video') {
        await this.videoSource.add(entry.packet, entry.meta);
      } else {
        if (!this.audioSource) {
          log.warn('Audio packet queued but no audio source configured — skipping');
          continue;
        }
        await this.audioSource.add(entry.packet, entry.meta);
      }
    }

    this.queue.length = 0;
    log.debug('Queue flushed');
  }
}
