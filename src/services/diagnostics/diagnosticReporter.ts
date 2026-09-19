/**
 * Client-side error tracking. Every runtime failure (uncaught exception,
 * unhandled rejection, console.error, Logger.error, React render error,
 * resource/chunk load failure, WebGPU error) is fingerprinted, rate-limited
 * per fingerprint, enriched with device context and breadcrumbs, and posted
 * to `/api/analytics/diagnostics` in size-aware batches.
 */

import { APP_VERSION } from '../../version';
import type { RuntimeDiagnosticEntry } from '../runtimeDiagnostics';
import { getOriginalConsoleMethod, setRuntimeDiagnosticSink } from '../runtimeDiagnostics';
import {
  classifyProductAnalyticsFailure,
  type ProductAnalyticsFailureCode,
} from '../productAnalytics/failureClassification';
import { getRuntimeDeviceContext } from '../../utils/runtimeDeviceContext';
import {
  Logger,
  isLoggerWritingToConsole,
  setLoggerDiagnosticErrorSink,
  type LogEntry,
} from '../logger';
import {
  buildRuntimeFingerprint,
  classifyRuntimeFailure,
  type RuntimeFailureCode,
} from './diagnosticFingerprint';
import {
  collectDiagnosticBreadcrumbs,
  collectDiagnosticContext,
  getDiagnosticDeviceId,
  getDiagnosticSessionId,
  primeDiagnosticContext,
  type DiagnosticBreadcrumb,
  type DiagnosticContext,
} from './diagnosticContext';

type DiagnosticKind = 'ai_generation' | 'client_runtime';
type DiagnosticOutcome = 'started' | 'succeeded' | 'failed' | 'cancelled';

export interface RuntimeErrorReport {
  component?: string;
  errorName?: string;
  /** Free-form structured details (component stack, resource URL, reason, ...). */
  extra?: Record<string, unknown>;
  message: string;
  /** `filename:line:column` when known. */
  source?: string;
  stack?: string;
  stage: string;
}

interface DiagnosticEventInput {
  breadcrumbs?: DiagnosticBreadcrumb[];
  component?: string;
  context?: DiagnosticContext & { extra?: Record<string, unknown>; source?: string };
  errorName?: string;
  failureCode?: ProductAnalyticsFailureCode | RuntimeFailureCode;
  fingerprint?: string;
  kind: DiagnosticKind;
  message?: string;
  outcome: DiagnosticOutcome;
  repeatCount?: number;
  stack?: string;
  stage: string;
  taskId?: string;
}

interface QueuedDiagnosticEvent extends DiagnosticEventInput {
  appVersion: string;
  attempts: number;
  browser: string;
  deviceClass: string;
  deviceId: string;
  id: string;
  occurredAt: string;
  pagePath?: string;
  platform: string;
  sessionId: string;
}

interface FingerprintWindow {
  sent: number;
  suppressed: number;
  windowStart: number;
}

interface ReactErrorInfoLike {
  componentStack?: string | null;
}

const ENDPOINT = '/api/analytics/diagnostics';
const FLUSH_DELAY_MS = 1_500;
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const MAX_ATTEMPTS = 3;
const MAX_BATCH_BYTES = 400_000;
/** Chrome rejects keepalive bodies above 64 KB; leave headroom. */
const KEEPALIVE_BATCH_BYTES = 56_000;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 8_000;
const REPEAT_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_FINGERPRINT_WINDOW = 3;
const BUDGET_WINDOW_MS = 10 * 60_000;
const MAX_EVENTS_PER_BUDGET_WINDOW = 150;

function eventId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `diagnostic:${suffix}`;
}

function clip(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}… [truncated]` : value;
}

function serializeEvent(event: QueuedDiagnosticEvent): Omit<QueuedDiagnosticEvent, 'attempts'> {
  const { attempts: _attempts, ...payload } = event;
  return payload;
}

function stripHeavyFields(event: QueuedDiagnosticEvent): QueuedDiagnosticEvent {
  return {
    ...event,
    breadcrumbs: undefined,
    context: event.context ? { uptimeMs: event.context.uptimeMs, pageUrl: event.context.pageUrl, buildId: event.context.buildId } : undefined,
    stack: clip(event.stack, 1_500),
  };
}

class DiagnosticReporter {
  private queue: QueuedDiagnosticEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private fingerprintWindows = new Map<string, FingerprintWindow>();
  private budgetWindowStart = 0;
  private budgetSent = 0;
  private installed = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush(true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush(true);
      });
    }
  }

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    primeDiagnosticContext();
    setRuntimeDiagnosticSink((entry) => this.handleRuntimeEntry(entry));
    setLoggerDiagnosticErrorSink((entry) => this.handleLoggerEntry(entry, false));
    // Errors logged before this module was evaluated are still in the Logger
    // buffer; report them once so early boot failures are not lost.
    for (const entry of Logger.errors()) this.handleLoggerEntry(entry, true);
  }

  reportRuntimeError(report: RuntimeErrorReport): void {
    if (typeof window === 'undefined') return;
    const message = report.message.trim() || `[${report.stage}]`;
    const descriptor = {
      component: report.component,
      errorName: report.errorName,
      message,
      stack: report.stack,
      stage: report.stage,
    };
    const fingerprint = buildRuntimeFingerprint(descriptor);
    const repeatCount = this.admit(fingerprint, Date.now());
    if (repeatCount === null) return;

    this.enqueue({
      breadcrumbs: collectDiagnosticBreadcrumbs(),
      component: report.component,
      context: {
        ...collectDiagnosticContext(),
        extra: report.extra,
        source: report.source,
      },
      errorName: report.errorName,
      failureCode: classifyRuntimeFailure(descriptor),
      fingerprint,
      kind: 'client_runtime',
      message: clip(message, MAX_MESSAGE_LENGTH),
      outcome: 'failed',
      repeatCount,
      stack: clip(report.stack, MAX_STACK_LENGTH),
      stage: report.stage,
    });
  }

  reportAiGeneration(input: DiagnosticEventInput): void {
    if (typeof window === 'undefined') return;
    this.enqueue(input);
  }

  async flush(keepalive: boolean): Promise<void> {
    if (this.queue.length === 0) return this.flushPromise ?? Promise.resolve();
    if (this.flushPromise && !keepalive) return this.flushPromise;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const batch = this.takeBatch(keepalive ? KEEPALIVE_BATCH_BYTES : MAX_BATCH_BYTES);
    if (batch.length === 0) return Promise.resolve();
    const delivery = this.deliver(batch, keepalive).finally(() => {
      if (this.flushPromise === delivery) this.flushPromise = null;
      if (this.queue.length > 0) this.scheduleFlush();
    });
    if (!keepalive) this.flushPromise = delivery;
    return delivery;
  }

  private admit(fingerprint: string, now: number): number | null {
    if (now - this.budgetWindowStart > BUDGET_WINDOW_MS) {
      this.budgetWindowStart = now;
      this.budgetSent = 0;
    }
    let window = this.fingerprintWindows.get(fingerprint);
    if (!window || now - window.windowStart > REPEAT_WINDOW_MS) {
      window = { sent: 0, suppressed: window?.suppressed ?? 0, windowStart: now };
      this.fingerprintWindows.set(fingerprint, window);
    }
    if (window.sent >= MAX_EVENTS_PER_FINGERPRINT_WINDOW || this.budgetSent >= MAX_EVENTS_PER_BUDGET_WINDOW) {
      window.suppressed += 1;
      return null;
    }
    window.sent += 1;
    this.budgetSent += 1;
    const repeatCount = 1 + window.suppressed;
    window.suppressed = 0;
    if (this.fingerprintWindows.size > 200) {
      for (const [key, candidate] of this.fingerprintWindows) {
        if (candidate.suppressed === 0 && now - candidate.windowStart > REPEAT_WINDOW_MS) {
          this.fingerprintWindows.delete(key);
        }
      }
    }
    return repeatCount;
  }

  private enqueue(input: DiagnosticEventInput): void {
    const runtime = getRuntimeDeviceContext();
    this.queue.push({
      ...input,
      appVersion: APP_VERSION,
      attempts: 0,
      browser: runtime.browser,
      deviceClass: runtime.deviceClass,
      deviceId: getDiagnosticDeviceId(),
      id: eventId(),
      occurredAt: new Date().toISOString(),
      pagePath: typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`.slice(0, 300)
        : undefined,
      platform: runtime.platform,
      sessionId: getDiagnosticSessionId(),
    });
    if (this.queue.length > MAX_QUEUE_SIZE) this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
    if (this.queue.length >= MAX_BATCH_SIZE) {
      void this.flush(false);
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush(false);
    }, FLUSH_DELAY_MS);
  }

  private takeBatch(maxBytes: number): QueuedDiagnosticEvent[] {
    const batch: QueuedDiagnosticEvent[] = [];
    let bytes = 16;
    while (this.queue.length > 0 && batch.length < MAX_BATCH_SIZE) {
      let candidate = this.queue[0];
      let size = JSON.stringify(serializeEvent(candidate)).length;
      if (size > maxBytes) {
        candidate = stripHeavyFields(candidate);
        this.queue[0] = candidate;
        size = JSON.stringify(serializeEvent(candidate)).length;
      }
      if (batch.length > 0 && bytes + size > maxBytes) break;
      batch.push(this.queue.shift() as QueuedDiagnosticEvent);
      bytes += size + 1;
    }
    return batch;
  }

  private async deliver(batch: QueuedDiagnosticEvent[], keepalive: boolean): Promise<void> {
    try {
      const response = await fetch(ENDPOINT, {
        body: JSON.stringify({ events: batch.map(serializeEvent) }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        keepalive,
        method: 'POST',
      });
      if (response.status === 413) {
        this.requeue(batch.map(stripHeavyFields));
      } else if (response.status >= 500) {
        this.requeue(batch);
      }
    } catch {
      this.requeue(batch);
    }
  }

  private requeue(batch: QueuedDiagnosticEvent[]): void {
    const retryable = batch
      .map((event) => ({ ...event, attempts: event.attempts + 1 }))
      .filter((event) => event.attempts <= MAX_ATTEMPTS);
    this.queue.unshift(...retryable);
    if (this.queue.length > MAX_QUEUE_SIZE) this.queue.splice(MAX_QUEUE_SIZE);
  }

  private handleRuntimeEntry(entry: RuntimeDiagnosticEntry): void {
    if (entry.level !== 'ERROR') return;
    // Logger.error already reports through the logger sink with module context.
    if (entry.source === 'console' && isLoggerWritingToConsole()) return;
    const details = entry.details ?? {};
    const filename = typeof details.filename === 'string' && details.filename ? details.filename : undefined;
    this.reportRuntimeError({
      errorName: typeof details.errorName === 'string' ? details.errorName : undefined,
      extra: details,
      message: entry.message,
      source: filename ? `${filename}:${String(details.line ?? 0)}:${String(details.column ?? 0)}` : undefined,
      stack: entry.stack,
      stage: entry.source === 'console' ? 'console_error' : entry.source.replaceAll('-', '_'),
    });
  }

  private handleLoggerEntry(entry: LogEntry, backlog: boolean): void {
    let message = entry.message;
    let errorName: string | undefined;
    const data = entry.data;
    if (data && typeof data === 'object') {
      const record = data as { message?: unknown; name?: unknown };
      if (typeof record.name === 'string') errorName = record.name;
      if (typeof record.message === 'string' && !message.includes(record.message)) {
        message = `${message}: ${record.message}`;
      }
    } else if (typeof data === 'string' && data && !message.includes(data)) {
      message = `${message}: ${data}`;
    }
    this.reportRuntimeError({
      component: entry.module,
      errorName,
      extra: {
        backlog: backlog || undefined,
        data: entry.data,
        loggedAt: entry.timestamp,
      },
      message,
      stack: entry.stack,
      stage: 'logger_error',
    });
  }
}

const reporter = new DiagnosticReporter();

export function reportAiGenerationLifecycle(
  taskId: string | undefined,
  stage: 'provider_processing' | 'provider_result' | 'download' | 'import',
  outcome: DiagnosticOutcome,
  error?: unknown,
): void {
  if (!taskId) return;
  const failure = outcome === 'failed' ? describeUnknownError(error) : null;
  reporter.reportAiGeneration({
    errorName: failure?.errorName,
    failureCode: outcome === 'failed' ? classifyProductAnalyticsFailure(error) : undefined,
    kind: 'ai_generation',
    message: failure?.message,
    outcome,
    stack: failure?.stack,
    stage,
    taskId,
  });
}

function describeUnknownError(error: unknown): { errorName?: string; message?: string; stack?: string } {
  if (error instanceof Error) {
    return { errorName: error.name, message: clip(error.message, MAX_MESSAGE_LENGTH), stack: clip(error.stack, MAX_STACK_LENGTH) };
  }
  if (typeof error === 'string') return { message: clip(error, MAX_MESSAGE_LENGTH) };
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; name?: unknown };
    return {
      errorName: typeof record.name === 'string' ? record.name : undefined,
      message: typeof record.message === 'string' ? clip(record.message, MAX_MESSAGE_LENGTH) : undefined,
    };
  }
  return {};
}

/** Reports an application-level failure that no global hook would otherwise see. */
export function reportRuntimeError(report: RuntimeErrorReport): void {
  reporter.reportRuntimeError(report);
}

export function reportChunkLoadRecovery(
  action: 'reload' | 'reload_suppressed' | 'reload_deferred',
  reason: string,
): void {
  reporter.reportRuntimeError({
    extra: { action },
    message: `${action === 'reload' ? 'Reloading after chunk load failure'
      : action === 'reload_deferred' ? 'Chunk reload deferred to preserve unsaved project'
        : 'Chunk load failure within reload cooldown'}: ${reason}`,
    stage: 'chunk_load',
  });
}

function reportReactError(stage: 'react_render' | 'react_caught' | 'react_recoverable', error: unknown, info: ReactErrorInfoLike): void {
  const described = describeUnknownError(error);
  reporter.reportRuntimeError({
    errorName: described.errorName,
    extra: { componentStack: clip(info.componentStack ?? undefined, 4_000) },
    message: described.message ?? String(error),
    stack: described.stack,
    stage,
  });
}

/** Root options for `createRoot` so render errors carry their component stack. */
export function createReactRootErrorHandlers(): {
  onCaughtError: (error: unknown, errorInfo: ReactErrorInfoLike) => void;
  onRecoverableError: (error: unknown, errorInfo: ReactErrorInfoLike) => void;
  onUncaughtError: (error: unknown, errorInfo: ReactErrorInfoLike) => void;
} {
  const consoleError = getOriginalConsoleMethod('error');
  return {
    onCaughtError: (error, errorInfo) => {
      reportReactError('react_caught', error, errorInfo);
      consoleError?.('[React] Error caught by boundary:', error, errorInfo.componentStack ?? '');
    },
    onRecoverableError: (error, errorInfo) => {
      reportReactError('react_recoverable', error, errorInfo);
      consoleError?.('[React] Recoverable error:', error, errorInfo.componentStack ?? '');
    },
    onUncaughtError: (error, errorInfo) => {
      reportReactError('react_render', error, errorInfo);
      consoleError?.('[React] Uncaught render error:', error, errorInfo.componentStack ?? '');
    },
  };
}

export function installRuntimeDiagnosticReporting(): void {
  reporter.install();
}
