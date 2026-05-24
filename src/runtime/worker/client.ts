import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  type RuntimeJobCancelledEvent,
  type RuntimeJobCompletedEvent,
  type RuntimeJobDiagnostic,
  type RuntimeJobDiagnosticEvent,
  type RuntimeJobFailedEvent,
  type RuntimeJobLogEntry,
  type RuntimeJobLogEvent,
  type RuntimeJobProgressEvent,
  type RuntimeJobQueuedEvent,
  type RuntimeJobRequest,
  type RuntimeJobRunningEvent,
  type RuntimeSerializedError,
  type RuntimeWorkerInboundMessage,
  type RuntimeWorkerOutboundMessage,
} from './types';
import { createRuntimeTransferList } from './transferables';

export interface RuntimeWorkerTransport {
  postMessage: (message: RuntimeWorkerInboundMessage, transfer?: Transferable[]) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ) => void;
  terminate?: () => void;
}

export interface RuntimeJobClientRequest<Input = unknown> extends Omit<RuntimeJobRequest<Input>, 'jobId'> {
  jobId?: string;
}

export interface RuntimeJobRunOptions {
  transfer?: Transferable[];
  signal?: AbortSignal;
  onEvent?: (event: RuntimeWorkerOutboundMessage) => void;
}

export interface RuntimeJobClientResult<Output = unknown> {
  jobId: string;
  output: Output;
  diagnostics: RuntimeJobDiagnostic[];
  logs: RuntimeJobLogEntry[];
}

export interface RuntimeJobHandle<Output = unknown> {
  jobId: string;
  promise: Promise<RuntimeJobClientResult<Output>>;
  cancel: (reason?: string) => void;
}

interface PendingRuntimeJob<Output = unknown> {
  resolve: (result: RuntimeJobClientResult<Output>) => void;
  reject: (error: RuntimeJobClientError) => void;
  logs: RuntimeJobLogEntry[];
  diagnostics: RuntimeJobDiagnostic[];
  onEvent?: (event: RuntimeWorkerOutboundMessage) => void;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
}

function createJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `runtime-job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function restoreError(serialized: RuntimeSerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  error.stack = serialized.stack;
  return error;
}

function normalizeCancelReason(reason: unknown): string | undefined {
  if (reason === undefined || reason === null) {
    return undefined;
  }
  return typeof reason === 'string' ? reason : String(reason);
}

export class RuntimeJobClientError extends Error {
  readonly jobId?: string;
  readonly status: 'failed' | 'cancelled';
  readonly serializedError?: RuntimeSerializedError;

  constructor(
    message: string,
    status: 'failed' | 'cancelled',
    options: { jobId?: string; serializedError?: RuntimeSerializedError } = {},
  ) {
    super(message);
    this.name = status === 'cancelled' ? 'RuntimeJobCancelledError' : 'RuntimeJobClientError';
    this.jobId = options.jobId;
    this.status = status;
    this.serializedError = options.serializedError;
  }
}

export class RuntimeJobClient {
  private readonly transport: RuntimeWorkerTransport;
  private readonly pending = new Map<string, PendingRuntimeJob>();
  private readonly handleMessage = (event: MessageEvent<RuntimeWorkerOutboundMessage>): void => {
    this.acceptMessage(event.data);
  };

  constructor(transport: RuntimeWorkerTransport) {
    this.transport = transport;
    this.transport.addEventListener('message', this.handleMessage);
  }

  runJob<Input = unknown, Output = unknown>(
    request: RuntimeJobClientRequest<Input>,
    options: RuntimeJobRunOptions = {},
  ): RuntimeJobHandle<Output> {
    const jobId = request.jobId ?? createJobId();
    const job: RuntimeJobRequest<Input> = {
      ...request,
      jobId,
    };

    let resolveJob: (result: RuntimeJobClientResult<Output>) => void;
    let rejectJob: (error: RuntimeJobClientError) => void;
    const promise = new Promise<RuntimeJobClientResult<Output>>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });

    const pending: PendingRuntimeJob<Output> = {
      resolve: resolveJob!,
      reject: rejectJob!,
      logs: [],
      diagnostics: [],
      onEvent: options.onEvent,
      abortSignal: options.signal,
    };

    if (options.signal) {
      pending.abortListener = () => this.cancelJob(jobId, normalizeCancelReason(options.signal?.reason));
      if (!options.signal.aborted) {
        options.signal.addEventListener('abort', pending.abortListener, { once: true });
      }
    }

    this.pending.set(jobId, pending as PendingRuntimeJob);
    const message = {
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job,
    } satisfies RuntimeWorkerInboundMessage;
    this.transport.postMessage(message, options.transfer ?? createRuntimeTransferList(job.input));
    if (options.signal?.aborted) {
      this.cancelJob(jobId, normalizeCancelReason(options.signal.reason));
    }

    return {
      jobId,
      promise,
      cancel: (reason?: string) => this.cancelJob(jobId, reason),
    };
  }

  cancelJob(jobId: string, reason?: string): void {
    const message = {
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.cancel',
      jobId,
      reason,
    } satisfies RuntimeWorkerInboundMessage;
    this.transport.postMessage(message);
  }

  dispose(): void {
    this.transport.removeEventListener('message', this.handleMessage);
    this.transport.terminate?.();
    this.pending.forEach((pending, jobId) => {
      this.cleanupPending(jobId, pending);
      pending.reject(new RuntimeJobClientError('Runtime job client disposed', 'cancelled', { jobId }));
    });
    this.pending.clear();
  }

  private acceptMessage(message: RuntimeWorkerOutboundMessage): void {
    if (message.type === 'runtime.host.error') {
      this.pending.forEach((pending, jobId) => {
        pending.onEvent?.(message);
        this.cleanupPending(jobId, pending);
        pending.reject(new RuntimeJobClientError(message.error.message, 'failed', {
          jobId,
          serializedError: message.error,
        }));
      });
      this.pending.clear();
      return;
    }

    const pending = this.pending.get(message.jobId);
    if (!pending) {
      return;
    }

    pending.onEvent?.(message);

    switch (message.type) {
      case 'runtime.job.queued':
      case 'runtime.job.running':
      case 'runtime.job.progress':
        this.acceptLifecycleEvent(message, pending);
        break;
      case 'runtime.job.log':
        this.acceptLogEvent(message, pending);
        break;
      case 'runtime.job.diagnostic':
        this.acceptDiagnosticEvent(message, pending);
        break;
      case 'runtime.job.completed':
        this.acceptCompletedEvent(message, pending);
        break;
      case 'runtime.job.failed':
        this.acceptFailedEvent(message, pending);
        break;
      case 'runtime.job.cancelled':
        this.acceptCancelledEvent(message, pending);
        break;
    }
  }

  private acceptLifecycleEvent(
    _message: RuntimeJobQueuedEvent | RuntimeJobRunningEvent | RuntimeJobProgressEvent,
    _pending: PendingRuntimeJob,
  ): void {
    // Lifecycle events are surfaced through onEvent; accumulated state lives in terminal events.
  }

  private acceptLogEvent(message: RuntimeJobLogEvent, pending: PendingRuntimeJob): void {
    pending.logs.push(message.entry);
  }

  private acceptDiagnosticEvent(message: RuntimeJobDiagnosticEvent, pending: PendingRuntimeJob): void {
    pending.diagnostics.push(message.diagnostic);
  }

  private acceptCompletedEvent(message: RuntimeJobCompletedEvent, pending: PendingRuntimeJob): void {
    this.cleanupPending(message.jobId, pending);
    this.pending.delete(message.jobId);
    pending.resolve({
      jobId: message.jobId,
      output: message.output,
      diagnostics: message.diagnostics.length > 0 ? message.diagnostics : pending.diagnostics,
      logs: message.logs.length > 0 ? message.logs : pending.logs,
    });
  }

  private acceptFailedEvent(message: RuntimeJobFailedEvent, pending: PendingRuntimeJob): void {
    this.cleanupPending(message.jobId, pending);
    this.pending.delete(message.jobId);
    const restored = restoreError(message.error);
    pending.reject(new RuntimeJobClientError(restored.message, 'failed', {
      jobId: message.jobId,
      serializedError: message.error,
    }));
  }

  private acceptCancelledEvent(message: RuntimeJobCancelledEvent, pending: PendingRuntimeJob): void {
    this.cleanupPending(message.jobId, pending);
    this.pending.delete(message.jobId);
    pending.reject(new RuntimeJobClientError(message.reason ?? 'Runtime job cancelled', 'cancelled', {
      jobId: message.jobId,
    }));
  }

  private cleanupPending(jobId: string, pending: PendingRuntimeJob): void {
    if (pending.abortSignal && pending.abortListener) {
      pending.abortSignal.removeEventListener('abort', pending.abortListener);
    }
    this.pending.delete(jobId);
  }
}
