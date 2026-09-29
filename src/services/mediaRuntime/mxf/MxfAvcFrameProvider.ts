// H.264 essence from MXF (XAVC-I / XAVC Long GOP / AVC-Intra), decoded with
// WebCodecs inside mxfAvcDecodeWorker. The worker reads the file and runs the
// long-GOP engine; the main thread only requests display frames.

import { closeVideoFrame, normalizeError } from '../codec/CodecFrameProviderBase';
import type { MxfGopEngineStats } from './mxfGopEngine';
import {
  MxfGopFrameProvider,
  type GopFrameSource,
  type MxfGopFrameProviderOptions,
} from './MxfGopFrameProvider';
import type {
  MxfAvcDecodeWorkerRequest,
  MxfAvcDecodeWorkerResponse,
} from '../../../workers/mxfAvcDecodeWorker';

export type MxfAvcFrameProviderOptions = MxfGopFrameProviderOptions;

class MxfAvcWorkerFrameSource implements GopFrameSource {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (frame: VideoFrame) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private closed = false;
  private lastStats: MxfGopEngineStats = {
    decodeQueueSize: 0, readyFrameCount: 0, decoderResets: 0, restartReasons: {},
    requests: 0, readyHits: 0, packetsFed: 0, flushes: 0, stalls: 0,
  };
  codec = '';

  private constructor() {
    this.worker = new Worker(new URL('../../../workers/mxfAvcDecodeWorker.ts', import.meta.url), {
      type: 'module',
      name: 'mxf-avc-decode',
    });
  }

  static async open(file: File, codecId: string): Promise<MxfAvcWorkerFrameSource> {
    const client = new MxfAvcWorkerFrameSource();
    await client.start(file, codecId);
    return client;
  }

  get stats(): MxfGopEngineStats {
    return this.lastStats;
  }

  decodeFrame(displayIndex: number): Promise<VideoFrame> {
    if (this.closed) return Promise.reject(new Error('MXF AVC worker is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'frame', id, displayIndex } satisfies MxfAvcDecodeWorkerRequest);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error('MXF AVC worker closed');
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.worker.postMessage({ type: 'close' } satisfies MxfAvcDecodeWorkerRequest);
    // Give the worker a moment to close its decoder, then make sure it is gone.
    setTimeout(() => this.worker.terminate(), 1000);
  }

  private start(file: File, codecId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<MxfAvcDecodeWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'opened') {
          this.codec = message.codec;
          resolve();
        } else if (message.type === 'frame') {
          this.lastStats = message.stats;
          const entry = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (entry) entry.resolve(message.frame);
          else closeVideoFrame(message.frame);
        } else if (message.id === null) {
          reject(new Error(message.error));
        } else {
          const entry = this.pending.get(message.id);
          this.pending.delete(message.id);
          entry?.reject(new Error(message.error));
        }
      };
      this.worker.onerror = (event) => {
        const error = new Error(`MXF AVC worker error: ${event.message}`);
        reject(error);
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
      };
      this.worker.postMessage({ type: 'open', file, codecId } satisfies MxfAvcDecodeWorkerRequest);
    });
  }
}

export class MxfAvcFrameProvider extends MxfGopFrameProvider<MxfAvcFrameProviderOptions> {
  readonly backend = 'mxf-avc' as const;
  protected readonly label = 'MXF AVC';
  protected readonly packetLabel = 'MXF AVC packet';
  private codecString = '';

  protected async createFrameSource(): Promise<GopFrameSource> {
    const frames = await MxfAvcWorkerFrameSource.open(this.options.file, this.options.codecId);
    this.codecString = frames.codec;
    return frames;
  }

  protected describeDecoder() {
    return { codec: `mxf-avc:${this.codecString || this.options.codecId}`, hwAccel: 'webcodecs-worker' };
  }
}

export async function createMxfAvcFrameProvider(
  options: MxfAvcFrameProviderOptions,
): Promise<MxfAvcFrameProvider | null> {
  const provider = new MxfAvcFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
