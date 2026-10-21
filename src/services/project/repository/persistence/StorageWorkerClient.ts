import { RepositoryError, type BlobReference, type RepositoryErrorCode } from '../contracts';
import type { NativeCommandRequest, NativeBlobRequest, StorageFailure, StorageRequest, StorageSuccess, StorageOpenProgress, RepositoryOpenProgress } from '../storageWorkerProtocol';
import type { NativeRepositoryClient } from '../backends/nativeBackend';
import { reportWorkerLoadFailure } from '../../../../runtime/workerLoadFailure';
import { noteFolderAccessFailure } from '../../folderAccess/folderAccessPause';

interface PendingRequest { type: StorageRequest['type']; resolve: (value: unknown) => void; reject: (error: unknown) => void; removeAbort: () => void; }
export class StorageWorkerClient {
  readonly sessionEpoch = crypto.randomUUID();
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;
  private closing: Promise<void> | null = null;
  private readonly nativeLeases = new Map<string, string>();
  private fault: RepositoryError | null = null;
  private phase: 'startup' | 'opening' | 'ready' = 'startup';
  /** Whether the worker ever posted a message, i.e. its script loaded. */
  private answered = false;
  private readonly faultListeners = new Set<() => void>();
  private readonly nativeClient?: NativeRepositoryClient;
  private readonly onOpenProgress?: (progress: RepositoryOpenProgress) => void;
  constructor(nativeClient?: NativeRepositoryClient, onOpenProgress?: (progress: RepositoryOpenProgress) => void) {
    this.onOpenProgress = onOpenProgress;
    this.nativeClient = nativeClient;
    this.worker = new Worker(new URL('../../../../workers/projectStorage.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => {
      this.answered = true;
      const progress = event.data as StorageOpenProgress;
      if (progress.type === 'open-progress') {
        if (progress.sessionEpoch === this.sessionEpoch && !this.closed) {
          this.phase = 'opening'; this.onOpenProgress?.(progress.progress);
        }
        return;
      }
      const message = event.data as StorageSuccess | StorageFailure | NativeCommandRequest | NativeBlobRequest;
      if (message.sessionEpoch !== this.sessionEpoch) return;
      if ('type' in message && (message.type === 'native-command' || message.type === 'native-blob')) {
        void this.forwardNative(message); return;
      }
      const response = message as StorageSuccess | StorageFailure;
      const request = this.pending.get(response.requestId);
      if (!request) return;
      this.pending.delete(response.requestId); request.removeAbort();
      if (response.ok) {
        if (request.type === 'open') this.phase = 'ready';
        request.resolve(response.data);
      }
      else {
        const failure = new RepositoryError(response.error.code, response.error.message);
        // The browser paused folder access: the toolbar offers Re-allow; queued saves wait for it.
        noteFolderAccessFailure(failure);
        request.reject(failure);
      }
    };
    this.worker.onerror = event => {
      const error = new RepositoryError('io', this.failureMessage(event.message || 'Project storage worker failed'));
      // Failing before any answer usually means a deploy removed this build's worker file: the boot
      // recovery reloads the tab when a newer build is live (unsaved edits are kept and announced).
      if (this.phase === 'startup' && !this.answered) reportWorkerLoadFailure(error.message);
      this.fail(error);
    };
    this.worker.onmessageerror = () => this.fail(new RepositoryError('corrupt', this.failureMessage('Project worker response could not be decoded')));
  }
  private failureMessage(message: string): string {
    // Protocol names only: never include project names, file paths or request data.
    const operations = [...new Set([...this.pending.values()].map(request => request.type))].toSorted().join(', ') || 'idle';
    return `${message} (storage phase: ${this.phase}; operations: ${operations})`;
  }
  subscribeFailure(listener: () => void): () => void { this.faultListeners.add(listener); return () => this.faultListeners.delete(listener); }
  private fail(error: RepositoryError): void {
    this.fault = error;
    for (const request of this.pending.values()) { request.removeAbort(); request.reject(error); }
    this.pending.clear();
    for (const listener of this.faultListeners) listener();
  }
  private async forwardNative(message: NativeCommandRequest | NativeBlobRequest): Promise<void> {
    try {
      if (!this.nativeClient || this.closed) throw new RepositoryError('ownership', 'Native repository session is unavailable');
      const data = message.type === 'native-command' ? await this.nativeClient.repositoryCommand(message.command)
        : { ok: true, id: message.requestId, blob: await this.nativeClient.readRepositoryBlob?.(message.path) ?? null };
      const acquiredLease = message.type === 'native-command' ? (data as import('../../../nativeHelper/protocol').OkResponse).lease : undefined;
      if (message.type === 'native-command' && message.command.action === 'acquire' && typeof acquiredLease === 'string') {
        this.nativeLeases.set(acquiredLease, message.command.root);
        if (this.closed) {
          await this.nativeClient.repositoryCommand({ cmd: 'repository', action: 'release', root: message.command.root, lease: acquiredLease });
          this.nativeLeases.delete(acquiredLease);
        }
      }
      if (message.type === 'native-command' && message.command.action === 'release' && message.command.lease) this.nativeLeases.delete(message.command.lease);
      if (!this.closed) this.worker.postMessage({ type: 'native-response', requestId: message.requestId, sessionEpoch: this.sessionEpoch, data });
    } catch (error) {
      if (!this.closed) this.worker.postMessage({ type: 'native-response', requestId: message.requestId, sessionEpoch: this.sessionEpoch, error: String(error) });
    }
  }
  request<T>(request: StorageRequest, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
    if (this.closed || this.fault || this.closing && request.type !== 'close') return Promise.reject(this.fault ?? new RepositoryError('ownership', 'Project storage worker session closed'));
    if (signal?.aborted) return Promise.reject(new RepositoryError('cancelled', 'Project storage request cancelled'));
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.worker.postMessage({ type: 'cancel', requestId, sessionEpoch: this.sessionEpoch });
        this.pending.delete(requestId); signal?.removeEventListener('abort', abort);
        reject(new RepositoryError('cancelled', 'Project storage request cancelled'));
      };
      this.pending.set(requestId, { type: request.type, resolve: value => resolve(value as T), reject, removeAbort: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage({ requestId, sessionEpoch: this.sessionEpoch, request }, transfer); }
      catch (error) { this.pending.delete(requestId); signal?.removeEventListener('abort', abort); reject(error); }
    });
  }
  async storeBlob(reference: BlobReference, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
    const transferId = crypto.randomUUID();
    const start = await this.request<{ skip: boolean }>({ type: 'blob-start', transferId, reference }, signal);
    if (start.skip) return;
    let offset = 0;
    try {
      for await (const chunk of chunks) {
        for (let position = 0; position < chunk.byteLength; position += 256 * 1024) {
          const bytes = chunk.slice(position, position + 256 * 1024);
          const length = bytes.byteLength;
          await this.request({ type: 'blob-chunk', transferId, offset, bytes }, signal, [bytes.buffer]);
          offset += length;
        }
      }
      await this.request({ type: 'blob-finish', transferId }, signal);
    } catch (error) {
      await this.request({ type: 'blob-abort', transferId }).catch(() => {}); throw error;
    }
  }
  verifyBlob(reference: BlobReference, signal?: AbortSignal): Promise<void> {
    return this.request({ type: 'verify-blob', reference }, signal);
  }
  readBlob(reference: BlobReference, mimeType?: string, signal?: AbortSignal): Promise<Blob | null> {
    return this.request({ type: 'blob-read', reference, mimeType }, signal);
  }
  /** Cheap presence probe (one byte, no digest); readBlob still verifies the whole content before it is used. */
  async hasStoredBlob(reference: BlobReference, signal?: AbortSignal): Promise<boolean> {
    if (!(reference.length > 0)) return false;
    try { await this.request<Uint8Array>({ type: 'blob-range', reference, offset: 0, length: 1 }, signal); return true; }
    catch (error) { if (error instanceof RepositoryError && error.code !== 'cancelled' && error.code !== 'access') return false; throw error; }
  }
  async *readBlobStream(reference: BlobReference, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    await this.verifyBlob(reference, signal);
    for (let offset = 0; offset < reference.length; offset += 256 * 1024) {
      yield await this.request<Uint8Array>({ type: 'blob-range', reference, offset,
        length: Math.min(256 * 1024, reference.length - offset) }, signal);
    }
  }
  readJournal(id: string, signal?: AbortSignal): Promise<import('../contracts').JsonValue | null> {
    return this.request({ type: 'journal-read', id }, signal);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.closed) return Promise.resolve();
    const closeRequest = this.request<void>({ type: 'close' });
    this.closing = (async () => {
      try { await closeRequest; }
      finally {
        this.closed = true; this.worker.terminate();
        this.fail(new RepositoryError('ownership', 'Project storage worker closed'));
        if (this.nativeClient) await Promise.allSettled([...this.nativeLeases].map(([lease, root]) =>
          this.nativeClient!.repositoryCommand({ cmd: 'repository', action: 'release', root, lease })));
        this.nativeLeases.clear();
      }
    })();
    return this.closing;
  }
  get errorCode(): RepositoryErrorCode | null { return this.fault?.code ?? null; }
  get error(): RepositoryError | null { return this.fault; }
}
