import type { RuntimeCapability } from '../capabilities';

export const RUNTIME_WORKER_PROTOCOL_VERSION = 1 as const;

export type RuntimeJobStatus =
  | 'queued'
  | 'running'
  | 'progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RuntimeJobLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type RuntimeDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface RuntimeJobProgress {
  value: number;
  total?: number;
  stage?: string;
  message?: string;
}

export interface RuntimeJobLogEntry {
  level: RuntimeJobLogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface RuntimeJobDiagnostic {
  severity: RuntimeDiagnosticSeverity;
  code: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface RuntimeSerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface RuntimeJobRequest<Input = unknown> {
  jobId: string;
  providerId: string;
  handlerId: string;
  input: Input;
  priority?: number;
  requestedCapabilities?: RuntimeCapability[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeWorkerStartMessage<Input = unknown> {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'runtime.job.start';
  job: RuntimeJobRequest<Input>;
}

export interface RuntimeWorkerCancelMessage {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'runtime.job.cancel';
  jobId: string;
  reason?: string;
}

export type RuntimeWorkerInboundMessage =
  | RuntimeWorkerStartMessage
  | RuntimeWorkerCancelMessage;

interface RuntimeWorkerJobEventBase {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: string;
  jobId: string;
  providerId: string;
  handlerId: string;
  timestamp: string;
  status: RuntimeJobStatus;
}

export interface RuntimeJobQueuedEvent extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.queued';
  status: 'queued';
  queueDepth: number;
}

export interface RuntimeJobRunningEvent extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.running';
  status: 'running';
}

export interface RuntimeJobProgressEvent extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.progress';
  status: 'progress';
  progress: RuntimeJobProgress;
}

export interface RuntimeJobCompletedEvent<Output = unknown> extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.completed';
  status: 'completed';
  output: Output;
  diagnostics: RuntimeJobDiagnostic[];
  logs: RuntimeJobLogEntry[];
}

export interface RuntimeJobFailedEvent extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.failed';
  status: 'failed';
  error: RuntimeSerializedError;
  diagnostics: RuntimeJobDiagnostic[];
  logs: RuntimeJobLogEntry[];
}

export interface RuntimeJobCancelledEvent extends RuntimeWorkerJobEventBase {
  type: 'runtime.job.cancelled';
  status: 'cancelled';
  reason?: string;
  diagnostics: RuntimeJobDiagnostic[];
  logs: RuntimeJobLogEntry[];
}

export interface RuntimeJobLogEvent extends Omit<RuntimeWorkerJobEventBase, 'status'> {
  type: 'runtime.job.log';
  status: Exclude<RuntimeJobStatus, 'completed' | 'failed' | 'cancelled'>;
  entry: RuntimeJobLogEntry;
}

export interface RuntimeJobDiagnosticEvent extends Omit<RuntimeWorkerJobEventBase, 'status'> {
  type: 'runtime.job.diagnostic';
  status: Exclude<RuntimeJobStatus, 'completed' | 'failed' | 'cancelled'>;
  diagnostic: RuntimeJobDiagnostic;
}

export interface RuntimeWorkerHostErrorEvent {
  protocolVersion: typeof RUNTIME_WORKER_PROTOCOL_VERSION;
  type: 'runtime.host.error';
  status: 'failed';
  timestamp: string;
  error: RuntimeSerializedError;
}

export type RuntimeWorkerOutboundMessage =
  | RuntimeJobQueuedEvent
  | RuntimeJobRunningEvent
  | RuntimeJobProgressEvent
  | RuntimeJobCompletedEvent
  | RuntimeJobFailedEvent
  | RuntimeJobCancelledEvent
  | RuntimeJobLogEvent
  | RuntimeJobDiagnosticEvent
  | RuntimeWorkerHostErrorEvent;

export type RuntimePostMessage = (
  message: RuntimeWorkerOutboundMessage,
  transfer?: Transferable[],
) => void;

export type RuntimeJobProgressInput = number | RuntimeJobProgress;

export interface RuntimeJobHandlerContext<Input = unknown> {
  job: RuntimeJobRequest<Input>;
  signal: AbortSignal;
  progress: (progress: RuntimeJobProgressInput) => void;
  log: (level: RuntimeJobLogLevel, message: string, data?: unknown) => void;
  diagnostic: (
    severity: RuntimeDiagnosticSeverity,
    code: string,
    message: string,
    data?: unknown,
  ) => void;
}

export interface RuntimeJobHandlerResult<Output = unknown> {
  output: Output;
  transfer?: Transferable[];
  diagnostics?: Array<Omit<RuntimeJobDiagnostic, 'timestamp'> & { timestamp?: string }>;
}

export type RuntimeJobHandler<Input = unknown, Output = unknown> = (
  input: Input,
  context: RuntimeJobHandlerContext<Input>,
) => Promise<RuntimeJobHandlerResult<Output> | Output> | RuntimeJobHandlerResult<Output> | Output;

export interface RuntimeJobHandlerRegistration<Input = never, Output = unknown> {
  handlerId: string;
  handler: RuntimeJobHandler<Input, Output>;
}
