interface EncodedProxyImageFrame {
  frameIndex: number;
  blob: Blob;
  drawMs: number;
  jpegMs: number;
  size: number;
}

interface ProxyFrameWorkerEncodedMessage extends EncodedProxyImageFrame {
  type: 'encoded';
  requestId: number;
}

interface ProxyFrameWorkerReadyMessage {
  type: 'ready';
}

interface ProxyFrameWorkerErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
}

type ProxyFrameWorkerMessage =
  | ProxyFrameWorkerEncodedMessage
  | ProxyFrameWorkerReadyMessage
  | ProxyFrameWorkerErrorMessage;

export class ProxyFrameEncodeWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (frame: EncodedProxyImageFrame) => void;
    reject: (error: Error) => void;
  }>();
  private readonly ready: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(width: number, height: number, quality: number) {
    this.worker = new Worker(new URL('../../workers/proxyFrameEncodeWorker.ts', import.meta.url), {
      type: 'module',
    });

    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.worker.onmessage = (event: MessageEvent<ProxyFrameWorkerMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Proxy frame encoder worker failed');
      this.readyReject?.(error);
      this.rejectPending(error);
    };
    this.worker.postMessage({
      type: 'init',
      width,
      height,
      quality,
    });
  }

  async encode(frameIndex: number, frame: VideoFrame): Promise<EncodedProxyImageFrame> {
    if (this.disposed) {
      throw new Error('Proxy frame encoder worker was disposed');
    }

    await this.ready;
    const requestId = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(
          {
            type: 'encode',
            requestId,
            frameIndex,
            frame,
          },
          [frame as unknown as Transferable]
        );
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.readyReject?.(new Error('Proxy frame encoder worker disposed'));
    this.worker.terminate();
    this.rejectPending(new Error('Proxy frame encoder worker disposed'));
  }

  private handleMessage(message: ProxyFrameWorkerMessage): void {
    if (message.type === 'ready') {
      this.readyResolve?.();
      return;
    }

    if (message.type === 'error') {
      const error = new Error(message.message);
      if (typeof message.requestId === 'number') {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        pending?.reject(error);
      } else {
        this.readyReject?.(error);
        this.rejectPending(error);
      }
      return;
    }

    const pending = this.pending.get(message.requestId);
    this.pending.delete(message.requestId);
    pending?.resolve({
      frameIndex: message.frameIndex,
      blob: message.blob,
      drawMs: message.drawMs,
      jpegMs: message.jpegMs,
      size: message.size,
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
