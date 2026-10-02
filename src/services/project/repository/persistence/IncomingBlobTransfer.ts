import { RepositoryError } from '../contracts';

/** One acknowledged chunk at a time across worker boundaries. */
export class IncomingBlobTransfer {
  private offset = 0;
  private waiter: { resolve(value: IteratorResult<Uint8Array>): void; reject(error: unknown): void } | null = null;
  private queued: { bytes: Uint8Array; consumed: () => void } | null = null;
  private failure: unknown = null;
  private ended = false;
  readonly chunks: AsyncIterable<Uint8Array>;
  constructor() {
    this.chunks = { [Symbol.asyncIterator]: () => ({ next: async () => {
      if (this.failure) throw this.failure;
      if (this.queued) {
        const chunk = this.queued; this.queued = null; chunk.consumed();
        return { done: false, value: chunk.bytes };
      }
      if (this.ended) return { done: true, value: undefined };
      return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => { this.waiter = { resolve, reject }; });
    } }) };
  }
  async push(offset: number, bytes: Uint8Array): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.ended || this.queued || offset !== this.offset || bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) throw new RepositoryError('budget', 'Blob chunk violates transport offset or backpressure');
    this.offset += bytes.byteLength;
    if (this.waiter) { const waiter = this.waiter; this.waiter = null; waiter.resolve({ done: false, value: bytes }); return; }
    await new Promise<void>(resolve => { this.queued = { bytes, consumed: resolve }; });
    if (this.failure) throw this.failure;
  }
  finish(): void { this.ended = true; this.waiter?.resolve({ done: true, value: undefined }); this.waiter = null; }
  abort(error: unknown): void {
    this.failure = error; this.ended = true;
    this.queued?.consumed(); this.queued = null;
    // Both producer and consumer reject; an aborted stream is never acknowledged as complete.
    this.waiter?.reject(error); this.waiter = null;
  }
}
