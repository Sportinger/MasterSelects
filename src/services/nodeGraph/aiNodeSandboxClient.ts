import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import type {
  AINodeSandboxCode,
  AINodeSandboxResponse,
  AINodeSandboxRunRequest,
} from './aiNodeSandboxProtocol';
import {
  AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS,
  AI_NODE_SANDBOX_INIT_TIMEOUT_MS,
} from './aiNodeSandboxProtocol';

type AINodeSandboxWork = Omit<AINodeSandboxRunRequest, 'type' | 'requestId'>;
type AINodeSandboxTestExecutor = (
  codes: readonly AINodeSandboxCode[],
  work: AINodeSandboxWork,
) => Promise<AINodeRuntimeTexture>;

interface PendingRun {
  resolve: (texture: AINodeRuntimeTexture) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let sandboxTestExecutor: AINodeSandboxTestExecutor | null = null;
let nextRequestId = 1;

class AINodeSandboxClient {
  private readonly codes: readonly AINodeSandboxCode[];
  private worker: Worker | null = null;
  private readonly pendingRuns = new Map<number, PendingRun>();
  private readyPromise: Promise<void> | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(codes: readonly AINodeSandboxCode[]) {
    this.codes = codes;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private ensureWorker(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (this.disposed) return Promise.reject(new Error('AI node sandbox is disposed.'));

    this.worker = new Worker(new URL('./aiNodeSandbox.worker.ts', import.meta.url), {
      name: 'masterselects-ai-node-sandbox',
      type: 'module',
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    this.worker.addEventListener('messageerror', this.handleMessageError);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      const handleReady = (event: MessageEvent<AINodeSandboxResponse>) => {
        if (event.data.type !== 'ready') return;
        this.worker?.removeEventListener('message', handleReady);
        if (this.initTimeoutId !== null) clearTimeout(this.initTimeoutId);
        this.initTimeoutId = null;
        this.rejectReady = null;
        resolve();
      };
      this.worker?.addEventListener('message', handleReady);
      this.initTimeoutId = setTimeout(() => {
        this.worker?.removeEventListener('message', handleReady);
        this.fail(new Error('AI node sandbox initialization timed out.'));
      }, AI_NODE_SANDBOX_INIT_TIMEOUT_MS);
    });
    this.worker.postMessage({ type: 'init', nodes: this.codes });
    return this.readyPromise;
  }

  private readonly handleMessage = (event: MessageEvent<AINodeSandboxResponse>): void => {
    const response = event.data;
    if (response.type === 'ready') return;
    if (response.type === 'error') {
      const error = new Error(response.error);
      if (response.requestId !== undefined) {
        const pending = this.pendingRuns.get(response.requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRuns.delete(response.requestId);
          pending.reject(error);
          return;
        }
      }
      this.fail(error);
      return;
    }

    const pending = this.pendingRuns.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pendingRuns.delete(response.requestId);
    pending.resolve(response.texture);
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.fail(new Error(event.message || 'AI node sandbox worker failed.'));
  };

  private readonly handleMessageError = (): void => {
    this.fail(new Error('AI node sandbox returned a non-cloneable value.'));
  };

  private fail(error: Error): void {
    this.rejectReady?.(error);
    this.rejectReady = null;
    if (this.initTimeoutId !== null) clearTimeout(this.initTimeoutId);
    this.initTimeoutId = null;
    for (const pending of this.pendingRuns.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRuns.clear();
    this.dispose();
  }

  async run(work: AINodeSandboxWork): Promise<AINodeRuntimeTexture> {
    await this.ensureWorker();
    if (!this.worker || this.disposed) throw new Error('AI node sandbox worker is unavailable.');

    const requestId = nextRequestId++;
    return new Promise<AINodeRuntimeTexture>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRuns.delete(requestId);
        reject(new Error(`AI node sandbox exceeded ${AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS} ms.`));
        this.dispose();
      }, AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS);
      this.pendingRuns.set(requestId, { resolve, reject, timeoutId });
      try {
        this.worker?.postMessage(
          { type: 'run', requestId, ...work } satisfies AINodeSandboxRunRequest,
          [work.texture.data.buffer],
        );
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRuns.delete(requestId);
        reject(error instanceof Error ? error : new Error('Failed to send AI node sandbox request.'));
        this.dispose();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }
}

interface CachedSandbox {
  codeSignature: string;
  client: AINodeSandboxClient;
}

const cachedSandboxes = (
  import.meta.hot?.data?.aiNodeSandboxes as Map<string, CachedSandbox> | undefined
) ?? new Map<string, CachedSandbox>();

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.aiNodeSandboxes = cachedSandboxes;
  });
}

function createCodeSignature(codes: readonly AINodeSandboxCode[]): string {
  return codes.map((node) => `${node.id}:${node.code}`).join('\u0000');
}

export async function runAINodeSandbox(
  cacheKey: string,
  codes: readonly AINodeSandboxCode[],
  work: AINodeSandboxWork,
): Promise<AINodeRuntimeTexture> {
  if (typeof Worker === 'undefined') {
    if (sandboxTestExecutor) return sandboxTestExecutor(codes, work);
    throw new Error('AI node sandbox workers are unavailable in this environment.');
  }

  const codeSignature = createCodeSignature(codes);
  let cached = cachedSandboxes.get(cacheKey);
  if (!cached || cached.codeSignature !== codeSignature || cached.client.isDisposed()) {
    cached?.client.dispose();
    cached = { codeSignature, client: new AINodeSandboxClient(codes) };
    cachedSandboxes.set(cacheKey, cached);
  }

  try {
    return await cached.client.run(work);
  } catch (error) {
    if (cachedSandboxes.get(cacheKey) === cached) cachedSandboxes.delete(cacheKey);
    cached.client.dispose();
    throw error;
  }
}

export function disposeAINodeSandbox(cacheKey: string): void {
  cachedSandboxes.get(cacheKey)?.client.dispose();
  cachedSandboxes.delete(cacheKey);
}

export function disposeAllAINodeSandboxes(): void {
  for (const sandbox of cachedSandboxes.values()) sandbox.client.dispose();
  cachedSandboxes.clear();
}

export function setAINodeSandboxTestExecutor(
  executor: AINodeSandboxTestExecutor | null,
): void {
  sandboxTestExecutor = executor;
}
