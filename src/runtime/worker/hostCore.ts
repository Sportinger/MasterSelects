import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  type RuntimeDiagnosticSeverity,
  type RuntimeJobCancelledEvent,
  type RuntimeJobCompletedEvent,
  type RuntimeJobDiagnostic,
  type RuntimeJobDiagnosticEvent,
  type RuntimeJobFailedEvent,
  type RuntimeJobHandler,
  type RuntimeJobHandlerRegistration,
  type RuntimeJobLogEntry,
  type RuntimeJobLogEvent,
  type RuntimeJobLogLevel,
  type RuntimeJobProgress,
  type RuntimeJobProgressEvent,
  type RuntimeJobProgressInput,
  type RuntimeJobQueuedEvent,
  type RuntimeJobRequest,
  type RuntimeJobRunningEvent,
  type RuntimeJobStatus,
  type RuntimePostMessage,
  type RuntimeSerializedError,
  type RuntimeWorkerHostErrorEvent,
  type RuntimeWorkerInboundMessage,
} from './types';
import { createRuntimeTransferList } from './transferables';

interface RuntimeWorkerHostOptions {
  handlers?: RuntimeJobHandlerRegistration[];
  concurrency?: number;
  now?: () => string;
  postMessage: RuntimePostMessage;
}

interface RuntimeJobRecord {
  request: RuntimeJobRequest;
  controller: AbortController;
  logs: RuntimeJobLogEntry[];
  diagnostics: RuntimeJobDiagnostic[];
  status: RuntimeJobStatus;
  sequence: number;
  cancelled: boolean;
  cancelReason?: string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function serializeError(error: unknown): RuntimeSerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError' ||
    error instanceof Error && error.name === 'AbortError';
}

function normalizeProgress(progress: RuntimeJobProgressInput): RuntimeJobProgress {
  if (typeof progress === 'number') {
    return { value: Math.max(0, Math.min(1, progress)) };
  }

  return {
    ...progress,
    value: Math.max(0, Math.min(1, progress.value)),
  };
}

function normalizeHandlerResult<Output>(
  value: Output | { output: Output; transfer?: Transferable[]; diagnostics?: unknown },
): { output: Output; transfer?: Transferable[]; diagnostics?: unknown } {
  if (
    value !== null &&
    typeof value === 'object' &&
    'output' in value
  ) {
    return value as { output: Output; transfer?: Transferable[]; diagnostics?: unknown };
  }

  return { output: value as Output };
}

function normalizeDiagnosticTimestamp(
  diagnostic: Omit<RuntimeJobDiagnostic, 'timestamp'> & { timestamp?: string },
  now: () => string,
): RuntimeJobDiagnostic {
  return {
    ...diagnostic,
    timestamp: diagnostic.timestamp ?? now(),
  };
}

export class WorkerRuntimeHost {
  private readonly handlers = new Map<string, RuntimeJobHandler>();
  private readonly postMessage: RuntimePostMessage;
  private readonly now: () => string;
  private readonly concurrency: number;
  private readonly jobs = new Map<string, RuntimeJobRecord>();
  private queue: RuntimeJobRecord[] = [];
  private runningCount = 0;
  private nextSequence = 0;

  constructor(options: RuntimeWorkerHostOptions) {
    this.postMessage = options.postMessage;
    this.now = options.now ?? defaultNow;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    options.handlers?.forEach((registration) => this.registerHandler(registration));
  }

  registerHandler(registration: RuntimeJobHandlerRegistration): void {
    if (this.handlers.has(registration.handlerId)) {
      throw new Error(`Runtime worker handler already registered: ${registration.handlerId}`);
    }
    this.handlers.set(registration.handlerId, registration.handler as RuntimeJobHandler<unknown, unknown>);
  }

  unregisterHandler(handlerId: string): boolean {
    return this.handlers.delete(handlerId);
  }

  handleMessage(message: RuntimeWorkerInboundMessage): void {
    if (message.protocolVersion !== RUNTIME_WORKER_PROTOCOL_VERSION) {
      this.postHostError(new Error(`Unsupported runtime worker protocol: ${String(message.protocolVersion)}`));
      return;
    }

    if (message.type === 'runtime.job.start') {
      this.enqueue(message.job);
      return;
    }

    if (message.type === 'runtime.job.cancel') {
      this.cancelJob(message.jobId, message.reason);
      return;
    }

    this.postHostError(new Error(`Unknown runtime worker message: ${(message as { type?: unknown }).type}`));
  }

  cancelJob(jobId: string, reason?: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record) {
      return false;
    }

    record.cancelled = true;
    record.cancelReason = reason;
    record.controller.abort(reason);

    const queuedIndex = this.queue.findIndex((job) => job.request.jobId === jobId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.emitCancelled(record);
      this.jobs.delete(jobId);
      return true;
    }

    if (record.status !== 'cancelled') {
      this.emitCancelled(record);
    }
    return true;
  }

  private enqueue(request: RuntimeJobRequest): void {
    if (this.jobs.has(request.jobId)) {
      this.postHostError(new Error(`Duplicate runtime job id: ${request.jobId}`));
      return;
    }

    const record: RuntimeJobRecord = {
      request,
      controller: new AbortController(),
      logs: [],
      diagnostics: [],
      status: 'queued',
      sequence: this.nextSequence,
      cancelled: false,
    };
    this.nextSequence += 1;
    this.jobs.set(request.jobId, record);
    this.queue.push(record);
    this.queue.sort((a, b) => (
      (b.request.priority ?? 0) - (a.request.priority ?? 0) ||
      a.sequence - b.sequence
    ));

    this.emitQueued(record);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const record = this.queue.shift();
      if (!record || record.cancelled) {
        continue;
      }

      this.runningCount += 1;
      void this.runRecord(record);
    }
  }

  private async runRecord(record: RuntimeJobRecord): Promise<void> {
    const handler = this.handlers.get(record.request.handlerId);
    if (!handler) {
      this.emitFailed(record, new Error(`Unknown runtime worker handler: ${record.request.handlerId}`));
      this.finishRecord(record);
      return;
    }

    this.emitRunning(record);

    try {
      const context = {
        job: record.request,
        signal: record.controller.signal,
        progress: (progress: RuntimeJobProgressInput) => this.emitProgress(record, normalizeProgress(progress)),
        log: (level: RuntimeJobLogLevel, message: string, data?: unknown) => {
          this.emitLog(record, level, message, data);
        },
        diagnostic: (
          severity: RuntimeDiagnosticSeverity,
          code: string,
          message: string,
          data?: unknown,
        ) => {
          this.emitDiagnostic(record, severity, code, message, data);
        },
      };

      const result = normalizeHandlerResult(await handler(record.request.input, context));
      if (record.cancelled || record.controller.signal.aborted) {
        this.finishRecord(record);
        return;
      }

      if (Array.isArray(result.diagnostics)) {
        result.diagnostics.forEach((diagnostic) => {
          record.diagnostics.push(normalizeDiagnosticTimestamp(
            diagnostic as Omit<RuntimeJobDiagnostic, 'timestamp'> & { timestamp?: string },
            this.now,
          ));
        });
      }

      this.emitCompleted(record, result.output, result.transfer);
      this.finishRecord(record);
    } catch (error) {
      if (record.cancelled || record.controller.signal.aborted || isAbortLikeError(error)) {
        if (record.status !== 'cancelled') {
          this.emitCancelled(record);
        }
      } else {
        this.emitFailed(record, error);
      }
      this.finishRecord(record);
    }
  }

  private finishRecord(record: RuntimeJobRecord): void {
    this.jobs.delete(record.request.jobId);
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.drainQueue();
  }

  private baseEvent(record: RuntimeJobRecord) {
    return {
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      jobId: record.request.jobId,
      providerId: record.request.providerId,
      handlerId: record.request.handlerId,
      timestamp: this.now(),
    };
  }

  private emitQueued(record: RuntimeJobRecord): void {
    record.status = 'queued';
    const event: RuntimeJobQueuedEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.queued',
      status: 'queued',
      queueDepth: this.queue.length,
    };
    this.postMessage(event);
  }

  private emitRunning(record: RuntimeJobRecord): void {
    record.status = 'running';
    const event: RuntimeJobRunningEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.running',
      status: 'running',
    };
    this.postMessage(event);
  }

  private emitProgress(record: RuntimeJobRecord, progress: RuntimeJobProgress): void {
    if (record.cancelled) {
      return;
    }

    record.status = 'progress';
    const event: RuntimeJobProgressEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.progress',
      status: 'progress',
      progress,
    };
    this.postMessage(event);
  }

  private emitLog(
    record: RuntimeJobRecord,
    level: RuntimeJobLogLevel,
    message: string,
    data?: unknown,
  ): void {
    if (record.cancelled) {
      return;
    }

    const entry: RuntimeJobLogEntry = {
      level,
      message,
      timestamp: this.now(),
      data,
    };
    record.logs.push(entry);
    const event: RuntimeJobLogEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.log',
      status: record.status === 'queued' ? 'queued' : 'progress',
      entry,
    };
    this.postMessage(event);
  }

  private emitDiagnostic(
    record: RuntimeJobRecord,
    severity: RuntimeDiagnosticSeverity,
    code: string,
    message: string,
    data?: unknown,
  ): void {
    if (record.cancelled) {
      return;
    }

    const diagnostic: RuntimeJobDiagnostic = {
      severity,
      code,
      message,
      timestamp: this.now(),
      data,
    };
    record.diagnostics.push(diagnostic);
    const event: RuntimeJobDiagnosticEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.diagnostic',
      status: record.status === 'queued' ? 'queued' : 'progress',
      diagnostic,
    };
    this.postMessage(event);
  }

  private emitCompleted(record: RuntimeJobRecord, output: unknown, transfer?: Transferable[]): void {
    record.status = 'completed';
    const event: RuntimeJobCompletedEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.completed',
      status: 'completed',
      output,
      diagnostics: [...record.diagnostics],
      logs: [...record.logs],
    };
    this.postMessage(event, transfer ?? createRuntimeTransferList(output));
  }

  private emitFailed(record: RuntimeJobRecord, error: unknown): void {
    record.status = 'failed';
    const event: RuntimeJobFailedEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.failed',
      status: 'failed',
      error: serializeError(error),
      diagnostics: [...record.diagnostics],
      logs: [...record.logs],
    };
    this.postMessage(event);
  }

  private emitCancelled(record: RuntimeJobRecord): void {
    record.status = 'cancelled';
    const event: RuntimeJobCancelledEvent = {
      ...this.baseEvent(record),
      type: 'runtime.job.cancelled',
      status: 'cancelled',
      reason: record.cancelReason,
      diagnostics: [...record.diagnostics],
      logs: [...record.logs],
    };
    this.postMessage(event);
  }

  private postHostError(error: unknown): void {
    const event: RuntimeWorkerHostErrorEvent = {
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.host.error',
      status: 'failed',
      timestamp: this.now(),
      error: serializeError(error),
    };
    this.postMessage(event);
  }
}
