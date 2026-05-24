import { redactObject, redactSecrets } from './security/redact';

export type RuntimeDiagnosticLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type RuntimeDiagnosticSource =
  | 'console'
  | 'window-error'
  | 'unhandledrejection'
  | 'webgpu-uncapturederror'
  | 'webgpu-device-lost';

export interface RuntimeDiagnosticEntry {
  id: number;
  timestamp: string;
  performanceNow?: number;
  source: RuntimeDiagnosticSource;
  level: RuntimeDiagnosticLevel;
  message: string;
  args?: string[];
  stack?: string;
  details?: Record<string, unknown>;
}

export interface RuntimeDiagnosticsQuery {
  limit?: number;
  level?: RuntimeDiagnosticLevel | string;
  source?: RuntimeDiagnosticSource | string;
  search?: string;
  sinceId?: number;
}

interface RuntimeDiagnosticsState {
  installed: boolean;
  entries: RuntimeDiagnosticEntry[];
  maxEntries: number;
  nextId: number;
  originalConsole: Partial<Record<CapturedConsoleMethod, (...args: unknown[]) => void>>;
  attachedDevices: WeakSet<GPUDevice>;
}

type RuntimeDiagnosticsHost = typeof globalThis & {
  __MASTERSELECTS_RUNTIME_DIAGNOSTICS__?: RuntimeDiagnosticsState;
};

type CapturedConsoleMethod = 'debug' | 'info' | 'log' | 'warn' | 'error';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_BUFFER_ENTRIES = 2000;
const MAX_ARG_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 4000;

const CONSOLE_METHODS: CapturedConsoleMethod[] = ['debug', 'info', 'log', 'warn', 'error'];

const LEVEL_WEIGHTS: Record<RuntimeDiagnosticLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function getState(): RuntimeDiagnosticsState {
  const host = globalThis as RuntimeDiagnosticsHost;
  if (!host.__MASTERSELECTS_RUNTIME_DIAGNOSTICS__) {
    host.__MASTERSELECTS_RUNTIME_DIAGNOSTICS__ = {
      installed: false,
      entries: [],
      maxEntries: MAX_BUFFER_ENTRIES,
      nextId: 1,
      originalConsole: {},
      attachedDevices: new WeakSet<GPUDevice>(),
    };
  }
  return host.__MASTERSELECTS_RUNTIME_DIAGNOSTICS__;
}

function normalizeLevel(level: unknown): RuntimeDiagnosticLevel | null {
  if (typeof level !== 'string') return null;
  const normalized = level.toUpperCase();
  return normalized === 'DEBUG' ||
    normalized === 'INFO' ||
    normalized === 'WARN' ||
    normalized === 'ERROR'
    ? normalized
    : null;
}

function consoleMethodToLevel(method: CapturedConsoleMethod): RuntimeDiagnosticLevel {
  switch (method) {
    case 'debug':
      return 'DEBUG';
    case 'warn':
      return 'WARN';
    case 'error':
      return 'ERROR';
    case 'info':
    case 'log':
    default:
      return 'INFO';
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`
    : value;
}

function serializeArg(value: unknown, seen = new WeakSet<object>()): string {
  if (value instanceof Error) {
    return redactSecrets(`${value.name}: ${value.message}`);
  }

  if (typeof value === 'string') {
    return redactSecrets(truncate(value, MAX_ARG_LENGTH));
  }

  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue === 'bigint') {
          return nestedValue.toString();
        }
        if (nestedValue instanceof Error) {
          return {
            name: nestedValue.name,
            message: nestedValue.message,
            stack: nestedValue.stack,
          };
        }
        if (typeof nestedValue === 'object' && nestedValue !== null) {
          if (seen.has(nestedValue)) {
            return '[Circular]';
          }
          seen.add(nestedValue);
        }
        return nestedValue;
      });
      return redactSecrets(truncate(json, MAX_ARG_LENGTH));
    } catch {
      const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
      return `[${ctor || 'Object'}]`;
    }
  }

  return redactSecrets(truncate(String(value), MAX_ARG_LENGTH));
}

function getErrorDetails(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : undefined;
    const message = typeof record.message === 'string' ? record.message : serializeArg(error);
    const stack = typeof record.stack === 'string' ? record.stack : undefined;
    return { name, message, stack };
  }

  return { message: serializeArg(error) };
}

function recordDiagnostic(entry: Omit<RuntimeDiagnosticEntry, 'id' | 'timestamp' | 'performanceNow'>): void {
  const state = getState();
  const diagnostic: RuntimeDiagnosticEntry = {
    ...entry,
    id: state.nextId++,
    timestamp: new Date().toISOString(),
    performanceNow: typeof performance !== 'undefined' ? Math.round(performance.now() * 100) / 100 : undefined,
    message: redactSecrets(truncate(entry.message, MAX_MESSAGE_LENGTH)),
    args: entry.args?.map((arg) => redactSecrets(truncate(arg, MAX_ARG_LENGTH))),
    stack: entry.stack ? redactSecrets(truncate(entry.stack, MAX_MESSAGE_LENGTH)) : undefined,
    details: entry.details ? redactObject(entry.details) as Record<string, unknown> : undefined,
  };

  state.entries.push(diagnostic);
  while (state.entries.length > state.maxEntries) {
    state.entries.shift();
  }
}

function recordConsole(method: CapturedConsoleMethod, args: unknown[]): void {
  const serializedArgs = args.map((arg) => serializeArg(arg));
  const message = serializedArgs.join(' ');
  recordDiagnostic({
    source: 'console',
    level: consoleMethodToLevel(method),
    message: message || `[console.${method}]`,
    args: serializedArgs,
    details: { method },
  });
}

export function installRuntimeDiagnostics(): void {
  if (typeof window === 'undefined') return;

  const state = getState();
  if (state.installed) return;
  state.installed = true;

  const consoleObject = console as unknown as Record<CapturedConsoleMethod, (...args: unknown[]) => void>;
  for (const method of CONSOLE_METHODS) {
    if (!state.originalConsole[method]) {
      state.originalConsole[method] = consoleObject[method]?.bind(console);
    }

    consoleObject[method] = (...args: unknown[]) => {
      recordConsole(method, args);
      state.originalConsole[method]?.(...args);
    };
  }

  window.addEventListener('error', (event) => {
    const details = getErrorDetails(event.error);
    recordDiagnostic({
      source: 'window-error',
      level: 'ERROR',
      message: event.message || details.message || 'Window error',
      stack: details.stack,
      details: {
        errorName: details.name,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const details = getErrorDetails(event.reason);
    recordDiagnostic({
      source: 'unhandledrejection',
      level: 'ERROR',
      message: details.message || 'Unhandled promise rejection',
      stack: details.stack,
      details: {
        errorName: details.name,
      },
    });
  });
}

export function attachWebGPUDeviceDiagnostics(device: GPUDevice | null, label = 'main'): void {
  if (!device) return;

  const state = getState();
  if (state.attachedDevices.has(device)) return;
  state.attachedDevices.add(device);

  try {
    device.addEventListener('uncapturederror', (event: Event) => {
      const error = (event as Event & { error?: unknown }).error;
      const details = getErrorDetails(error);
      recordDiagnostic({
        source: 'webgpu-uncapturederror',
        level: 'ERROR',
        message: details.message || 'WebGPU uncaptured error',
        stack: details.stack,
        details: {
          label,
          errorName: details.name,
        },
      });
    });

    void device.lost.then((info) => {
      recordDiagnostic({
        source: 'webgpu-device-lost',
        level: 'ERROR',
        message: info.message || 'WebGPU device lost',
        details: {
          label,
          reason: info.reason,
        },
      });
    });
  } catch (error) {
    const details = getErrorDetails(error);
    recordDiagnostic({
      source: 'window-error',
      level: 'WARN',
      message: `Failed to attach WebGPU diagnostics: ${details.message}`,
      stack: details.stack,
      details: {
        errorName: details.name,
        label,
      },
    });
  }
}

function matchesQuery(entry: RuntimeDiagnosticEntry, query: Required<Pick<RuntimeDiagnosticsQuery, 'search'>> & RuntimeDiagnosticsQuery): boolean {
  const minLevel = normalizeLevel(query.level);
  if (minLevel && LEVEL_WEIGHTS[entry.level] < LEVEL_WEIGHTS[minLevel]) {
    return false;
  }

  if (typeof query.source === 'string' && query.source.trim()) {
    const source = query.source.trim().toLowerCase();
    if (entry.source.toLowerCase() !== source) {
      return false;
    }
  }

  if (typeof query.sinceId === 'number' && Number.isFinite(query.sinceId) && entry.id <= query.sinceId) {
    return false;
  }

  if (query.search) {
    const haystack = [
      entry.source,
      entry.level,
      entry.message,
      entry.args?.join(' '),
      entry.stack,
      JSON.stringify(entry.details ?? {}),
    ].join(' ').toLowerCase();
    if (!haystack.includes(query.search.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function summarize(entries: RuntimeDiagnosticEntry[]): Record<string, unknown> {
  const byLevel: Record<RuntimeDiagnosticLevel, number> = {
    DEBUG: 0,
    INFO: 0,
    WARN: 0,
    ERROR: 0,
  };
  const bySource: Record<string, number> = {};

  for (const entry of entries) {
    byLevel[entry.level] += 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
  }

  return {
    byLevel,
    bySource,
    lastError: entries.filter((entry) => entry.level === 'ERROR').at(-1) ?? null,
  };
}

export function getRuntimeDiagnostics(query: RuntimeDiagnosticsQuery = {}): Record<string, unknown> {
  const state = getState();
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const normalizedQuery = {
    ...query,
    search: typeof query.search === 'string' ? query.search.trim() : '',
  };
  const matched = state.entries.filter((entry) => matchesQuery(entry, normalizedQuery));
  const entries = matched.slice(-limit);

  return {
    installed: state.installed,
    timestamp: new Date().toISOString(),
    totalEntries: state.entries.length,
    totalMatched: matched.length,
    count: entries.length,
    limit,
    maxEntries: state.maxEntries,
    summary: summarize(state.entries),
    querySummary: summarize(matched),
    page: typeof window !== 'undefined' ? {
      href: window.location.href,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : undefined,
      hidden: typeof document !== 'undefined' ? document.hidden : undefined,
      hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : undefined,
    } : null,
    entries,
  };
}

export function clearRuntimeDiagnostics(): { cleared: number; nextId: number } {
  const state = getState();
  const cleared = state.entries.length;
  state.entries.length = 0;
  return {
    cleared,
    nextId: state.nextId,
  };
}
