// Round-robin worker pool for HAP frame packaging during export.
// The GPU produces BC blocks; workers Snappy-compress and assemble frames so
// the main thread stays responsive. With no WebGPU the same pool runs the
// full CPU encode. Session-owned runtime object — never stored durably.

import type {
  HapEncodeWorkerRequest,
  HapEncodeWorkerResponse,
} from '../../workers/hapEncodeWorker';
import type { HapTextureEncodeFormat } from './dxtEncodeCpu';
import type { HapTextureFormatNibble } from './hapFrame';

interface PendingEntry {
  resolve: (frame: Uint8Array) => void;
  reject: (error: Error) => void;
}

export class HapEncodeWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, PendingEntry>();
  private nextRequestId = 1;
  private nextWorker = 0;
  private disposed = false;

  constructor(workerCount?: number) {
    const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const count = Math.max(1, Math.min(4, workerCount ?? (hardware - 2)));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('../../workers/hapEncodeWorker.ts', import.meta.url), {
        type: 'module',
        name: `hap-encode-${i}`,
      });
      worker.onmessage = (event: MessageEvent<HapEncodeWorkerResponse>) => {
        const response = event.data;
        const entry = this.pending.get(response.id);
        if (!entry) return;
        this.pending.delete(response.id);
        if (response.ok) {
          entry.resolve(new Uint8Array(response.frame));
        } else {
          entry.reject(new Error(response.error));
        }
      };
      worker.onerror = (event) => {
        this.failAll(new Error(`HAP encode worker error: ${event.message}`));
      };
      this.workers.push(worker);
    }
  }

  get workerCount(): number {
    return this.workers.length;
  }

  /** Package pre-compressed BC blocks into a HAP frame. Transfers `texture`. */
  packFrame(
    texture: Uint8Array,
    formatNibble: HapTextureFormatNibble,
    chunkCount: number,
  ): Promise<Uint8Array> {
    const buffer = texture.byteOffset === 0 && texture.byteLength === texture.buffer.byteLength
      ? texture.buffer
      : texture.slice().buffer;
    return this.dispatch({
      id: 0,
      kind: 'pack',
      texture: buffer as ArrayBuffer,
      formatNibble,
      chunkCount,
    }, [buffer as ArrayBuffer]);
  }

  /** CPU fallback: BC-encode RGBA pixels and package them. Transfers `pixels`. */
  encodeAndPackFrame(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    format: HapTextureEncodeFormat,
    formatNibble: HapTextureFormatNibble,
    chunkCount: number,
  ): Promise<Uint8Array> {
    const copy = new Uint8Array(pixels).slice();
    return this.dispatch({
      id: 0,
      kind: 'encode-pack',
      pixels: copy.buffer as ArrayBuffer,
      width,
      height,
      format,
      formatNibble,
      chunkCount,
    }, [copy.buffer as ArrayBuffer]);
  }

  private dispatch(
    request: HapEncodeWorkerRequest,
    transfer: Transferable[],
  ): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('HAP encode pool is disposed'));
    const id = this.nextRequestId++;
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id }, transfer);
    });
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(new Error('HAP encode pool disposed'));
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
  }
}
