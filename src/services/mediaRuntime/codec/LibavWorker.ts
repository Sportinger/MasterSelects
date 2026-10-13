// Gemeinsamer Worker-Client für MXF und HEVC; jede Sitzung besitzt ihren Decoder.
import { closeVideoFrame, type CodecPacket } from './CodecFrameProviderBase';
import type { LibavDecodeWorkerRequest, LibavDecodeWorkerResponse } from '../../../workers/libavDecodeWorker';
export type LibavOpenRequest = Extract<LibavDecodeWorkerRequest, { type: 'open' }>;

export class LibavWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (frame: VideoFrame) => void;
    reject: (error: Error) => void;
  }>();
  private opened: Promise<void>;
  private rejectOpen: (error: Error) => void = () => undefined;
  private failure: Error | null = null;
  private terminated = false;
  /** Long-GOP stream state (feed/drain). */
  private unackedFeeds = 0;
  private readonly feedWaiters: (() => void)[] = [];
  private readonly drainWaiters = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  onStreamFrame: ((frame: VideoFrame) => void) | null = null;
  onStreamError: ((error: Error) => void) | null = null;

  constructor(open: LibavOpenRequest) {
    this.worker = new Worker(new URL('../../../workers/libavDecodeWorker.ts', import.meta.url), {
      type: 'module',
      name: 'libav-decode',
    });
    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    this.opened = new Promise<void>((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
    this.rejectOpen = rejectOpen;
    void this.opened.catch(() => undefined);
    this.worker.onmessage = (event: MessageEvent<LibavDecodeWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'opened') {
        resolveOpen();
      } else if (message.type === 'stream-frame') {
        if (this.onStreamFrame) this.onStreamFrame(message.frame);
        else closeVideoFrame(message.frame);
      } else if (message.type === 'fed') {
        this.unackedFeeds = Math.max(0, this.unackedFeeds - 1);
        this.feedWaiters.shift()?.();
      } else if (message.type === 'drained') {
        this.drainWaiters.get(message.id)?.resolve();
        this.drainWaiters.delete(message.id);
      } else if (message.type === 'frame') {
        const entry = this.pending.get(message.id);
        if (!entry) { closeVideoFrame(message.frame); return; }
        this.pending.delete(message.id);
        entry.resolve(message.frame);
      } else if (message.id === null) {
        const error = new Error(message.error);
        this.fail(error);
      } else {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        entry?.reject(new Error(message.error));
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(`libavcodec worker error: ${event.message}`);
      this.fail(error);
    };
    this.worker.postMessage(open);
  }

  get queueSize(): number {
    return this.pending.size + this.unackedFeeds;
  }

  feed(packet: CodecPacket): void {
    if (this.failure) throw this.failure;
    if (this.terminated) throw new Error('libavcodec worker terminated');
    const copy = packet.data.slice();
    const request: LibavDecodeWorkerRequest = {
      type: 'feed',
      packet: copy.buffer as ArrayBuffer,
      timestampUs: packet.microsecondTimestamp,
    };
    this.unackedFeeds += 1;
    this.worker.postMessage(request, [request.packet]);
  }

  waitForFeedAck(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.unackedFeeds === 0) return Promise.resolve();
    return new Promise((resolve) => this.feedWaiters.push(resolve));
  }

  drain(id: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.terminated) return Promise.reject(new Error('libavcodec worker terminated'));
    return new Promise((resolve, reject) => {
      this.drainWaiters.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'drain', id } satisfies LibavDecodeWorkerRequest);
    });
  }

  resetStream(): void {
    if (!this.terminated) this.worker.postMessage({ type: 'reset' } satisfies LibavDecodeWorkerRequest);
  }

  ready(): Promise<void> {
    return this.opened;
  }

  decode(id: number, packet: CodecPacket): Promise<VideoFrame> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.terminated) return Promise.reject(new Error('libavcodec worker terminated'));
    const copy = packet.data.slice();
    const request: LibavDecodeWorkerRequest = {
      type: 'decode',
      id,
      packet: copy.buffer as ArrayBuffer,
      timestampUs: packet.microsecondTimestamp,
      durationUs: packet.microsecondDuration,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request, [request.packet]);
    });
  }

  private fail(error: Error): void {
    this.failure = error;
    this.rejectOpen(error);
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    for (const entry of this.drainWaiters.values()) entry.reject(error);
    this.drainWaiters.clear();
    for (const wake of this.feedWaiters.splice(0)) wake();
    this.onStreamError?.(error);
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    const error = new Error('libavcodec worker terminated');
    this.rejectOpen(error);
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    for (const waiter of this.feedWaiters.splice(0)) waiter();
    for (const waiter of this.drainWaiters.values()) waiter.reject(error);
    this.drainWaiters.clear();
    this.worker.terminate();
  }
}
