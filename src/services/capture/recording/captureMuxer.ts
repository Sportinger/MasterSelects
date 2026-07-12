import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';

export interface CaptureMuxerPositionedRun {
  runIndex: number;
  position: number;
  data: Uint8Array<ArrayBuffer>;
  recoverableFragment: boolean;
}

export type CaptureMuxerRunSink = (run: CaptureMuxerPositionedRun) => Promise<void>;
const DEFAULT_MAX_QUEUED_PACKET_BYTES = 64 * 1024 * 1024;

function containsAscii(data: Uint8Array, value: string): boolean {
  const bytes = [...value].map(character => character.charCodeAt(0));
  return data.some((_, index) => bytes.every((byte, offset) => data[index + offset] === byte));
}

interface CaptureMuxerWriter {
  start(): Promise<void>;
  addVideo(packet: unknown, metadata?: EncodedVideoChunkMetadata): Promise<void>;
  addAudio(packet: unknown, metadata?: EncodedAudioChunkMetadata): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
  getBuffer?(): ArrayBuffer | null;
  getStats?(): { artifactBytes: number; outputBytes: number };
}

function createWriter(fps: number, audioCodec?: 'aac' | 'opus', writeRun?: CaptureMuxerRunSink): CaptureMuxerWriter {
  let runIndex = 0;
  let artifactBytes = 0;
  let outputBytes = 0;
  const bufferTarget = writeRun ? null : new BufferTarget();
  const target = writeRun
    ? new StreamTarget(new WritableStream<StreamTargetChunk>({
        async write(chunk) {
          const data = chunk.data.slice();
          await writeRun({
            runIndex: runIndex++,
            position: chunk.position,
            data,
            recoverableFragment: containsAscii(data, 'moof') && containsAscii(data, 'mdat'),
          });
          artifactBytes += data.byteLength;
          outputBytes = Math.max(outputBytes, chunk.position + data.byteLength);
        },
      }))
    : bufferTarget!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target });
  const video = new EncodedVideoPacketSource('avc');
  const audio = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
  output.addVideoTrack(video, { frameRate: fps });
  if (audio) output.addAudioTrack(audio);
  return {
    start: () => output.start(),
    addVideo: (packet, metadata) => video.add(packet as EncodedPacket, metadata),
    addAudio: async (packet, metadata) => {
      if (!audio) throw new Error('Capture muxer has no audio track.');
      await audio.add(packet as EncodedPacket, metadata);
    },
    finalize: async () => {
      video.close();
      audio?.close();
      await output.finalize();
    },
    cancel: () => output.cancel(),
    getBuffer: () => bufferTarget?.buffer ?? null,
    getStats: () => ({ artifactBytes, outputBytes }),
  };
}

export interface CaptureMuxerStats {
  queuedPacketBytes: number;
  maxQueuedPacketBytes: number;
  artifactBytes: number;
  outputBytes: number;
}

export class CaptureMuxer {
  private readonly writer: CaptureMuxerWriter;
  private readonly toPacket: (chunk: EncodedVideoChunk, sequenceNumber: number) => unknown;
  private pendingWrite = Promise.resolve();
  private started = false;
  private sequenceNumber = 0;
  private audioSequenceNumber = 0;
  private queuedPacketBytes = 0;
  private maxQueuedPacketBytes = 0;
  private writeError: unknown;
  private readonly queuedPacketByteLimit: number;

  constructor(options: {
    fps: number;
    writer?: CaptureMuxerWriter;
    toPacket?: (chunk: EncodedVideoChunk, sequenceNumber: number) => unknown;
    toAudioPacket?: (chunk: EncodedAudioChunk, sequenceNumber: number) => unknown;
    audioCodec?: 'aac' | 'opus';
    writeRun?: CaptureMuxerRunSink;
    maxQueuedPacketBytes?: number;
  }) {
    this.writer = options.writer ?? createWriter(options.fps, options.audioCodec, options.writeRun);
    this.toPacket = options.toPacket ?? ((chunk, sequenceNumber) => (
      EncodedPacket.fromEncodedChunk(chunk).clone({ sequenceNumber })
    ));
    this.toAudioPacket = options.toAudioPacket ?? ((chunk, sequenceNumber) => (
      EncodedPacket.fromEncodedChunk(chunk).clone({ sequenceNumber })
    ));
    this.queuedPacketByteLimit = options.maxQueuedPacketBytes ?? DEFAULT_MAX_QUEUED_PACKET_BYTES;
  }

  private readonly toAudioPacket: (chunk: EncodedAudioChunk, sequenceNumber: number) => unknown;

  addVideoChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): Promise<void> {
    if (this.queuedPacketBytes + chunk.byteLength >= this.queuedPacketByteLimit) {
      return Promise.reject(new Error('Screen capture mux queue reached its 64 MB safety limit.'));
    }
    const packet = this.toPacket(chunk, this.sequenceNumber++);
    const byteLength = chunk.byteLength;
    this.queuedPacketBytes += byteLength;
    this.maxQueuedPacketBytes = Math.max(this.maxQueuedPacketBytes, this.queuedPacketBytes);
    const write = this.pendingWrite.then(async () => {
      if (!this.started) {
        await this.writer.start();
        this.started = true;
      }
      await this.writer.addVideo(packet, metadata);
    }).finally(() => {
      this.queuedPacketBytes -= byteLength;
    });
    this.pendingWrite = write.catch(error => {
      this.writeError = error;
    });
    return write;
  }

  addAudioChunk(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): Promise<void> {
    if (this.queuedPacketBytes + chunk.byteLength >= this.queuedPacketByteLimit) {
      return Promise.reject(new Error('Screen capture mux queue reached its 64 MB safety limit.'));
    }
    const packet = this.toAudioPacket(chunk, this.audioSequenceNumber++);
    const byteLength = chunk.byteLength;
    this.queuedPacketBytes += byteLength;
    this.maxQueuedPacketBytes = Math.max(this.maxQueuedPacketBytes, this.queuedPacketBytes);
    const write = this.pendingWrite.then(async () => {
      if (!this.started) {
        await this.writer.start();
        this.started = true;
      }
      await this.writer.addAudio(packet, metadata);
    }).finally(() => {
      this.queuedPacketBytes -= byteLength;
    });
    this.pendingWrite = write.catch(error => { this.writeError = error; });
    return write;
  }

  async finalize(): Promise<ArrayBuffer | null> {
    await this.pendingWrite;
    if (this.writeError) throw this.writeError;
    if (!this.started) {
      await this.writer.start();
      this.started = true;
    }
    await this.writer.finalize();
    return this.writer.getBuffer?.() ?? null;
  }

  async cancel(): Promise<void> {
    await this.pendingWrite;
    await this.writer.cancel();
  }

  canAcceptVideoFrame(): boolean {
    return this.queuedPacketBytes < this.queuedPacketByteLimit * 0.75;
  }

  getStats(): CaptureMuxerStats {
    const writer = this.writer.getStats?.() ?? { artifactBytes: 0, outputBytes: 0 };
    return {
      queuedPacketBytes: this.queuedPacketBytes,
      maxQueuedPacketBytes: this.maxQueuedPacketBytes,
      ...writer,
    };
  }
}
