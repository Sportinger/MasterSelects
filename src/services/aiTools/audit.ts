import { APP_VERSION } from '../../version';
import { useMediaStore } from '../../stores/mediaStore';
import { getToolPolicy } from './policy';
import type { CallerContext, ToolPolicyEntry } from './policy';
import type { AIToolExecutionOptions, ToolResult } from './types';

const AUDIT_DB_NAME = 'masterselects-ai-tool-audit';
const AUDIT_DB_VERSION = 1;
const AUDIT_STORE_NAME = 'calls';
const AUDIT_MEMORY_LIMIT = 1_000;
const AUDIT_DATABASE_LIMIT = 5_000;
const AUDIT_MAX_STRING_LENGTH = 20_000;
const AUDIT_MAX_ARRAY_LENGTH = 200;
const AUDIT_MAX_OBJECT_KEYS = 200;
const AUDIT_MAX_DEPTH = 8;

const SENSITIVE_KEY_PATTERN = /^(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)$/i;
const DATA_URL_PATTERN = /^data:(?:image|audio|video|application\/octet-stream)\/?[^;,]*;base64,/i;
const TAB_ID_SESSION_KEY = 'masterselects.aiBridgeTabId';

export type AIToolAuditStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'cancelled';

export interface AIToolAuditError {
  category: string;
  message: string;
}

export type AIToolAuditResult = Omit<ToolResult, 'error'> & {
  error?: ToolResult['error'] | AIToolAuditError;
};

export interface AIToolAuditEntry {
  appVersion: string;
  args: Record<string, unknown>;
  callId: string;
  callerContext: CallerContext;
  durationMs?: number;
  error?: string;
  finishedAt?: number;
  options: Record<string, unknown>;
  policy: ToolPolicyEntry | null;
  projectId: string | null;
  projectName: string;
  providerToolCallId?: string;
  result?: unknown;
  sessionId: string | null;
  startedAt: number;
  status: AIToolAuditStatus;
  tool: string;
}

interface BeginAIToolAuditInput {
  args: Record<string, unknown>;
  callerContext: CallerContext;
  options?: AIToolExecutionOptions;
  providerToolCallId?: string;
  tool: string;
}

interface ListAIToolAuditOptions {
  callerContext?: CallerContext;
  limit?: number;
  tool?: string;
}

interface AIToolAuditRuntimeState {
  calls: Map<string, AIToolAuditEntry>;
  databasePromise?: Promise<IDBDatabase | null>;
  order: string[];
  persistenceQueue?: Promise<void>;
  persistedWrites: number;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __MASTERSELECTS_AI_TOOL_AUDIT__?: AIToolAuditRuntimeState;
};
const runtime = runtimeGlobal.__MASTERSELECTS_AI_TOOL_AUDIT__ ?? {
  calls: new Map<string, AIToolAuditEntry>(),
  order: [],
  persistedWrites: 0,
};
runtimeGlobal.__MASTERSELECTS_AI_TOOL_AUDIT__ = runtime;

export function beginAIToolAudit(input: BeginAIToolAuditInput): AIToolAuditEntry {
  const media = useMediaStore.getState();
  const entry: AIToolAuditEntry = {
    appVersion: APP_VERSION,
    args: sanitizeAuditValue(input.args) as Record<string, unknown>,
    callId: createAuditCallId(),
    callerContext: input.callerContext,
    options: sanitizeAuditOptions(input.options),
    policy: clonePolicy(getToolPolicy(input.tool)),
    projectId: media.currentProjectId,
    projectName: media.currentProjectName,
    providerToolCallId: input.providerToolCallId,
    sessionId: readBridgeSessionId(),
    startedAt: Date.now(),
    status: 'running',
    tool: input.tool,
  };
  rememberAuditEntry(entry);
  enqueuePersistAuditEntry(entry);
  return entry;
}

export function completeAIToolAudit(
  callId: string,
  result: AIToolAuditResult | undefined,
  error?: unknown,
  explicitStatus?: Exclude<AIToolAuditStatus, 'running'>,
): AIToolAuditEntry | null {
  const current = runtime.calls.get(callId);
  if (!current) return null;

  const finishedAt = Date.now();
  const errorMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : typeof result?.error === 'string'
        ? result.error
        : result?.error?.message;
  const entry: AIToolAuditEntry = {
    ...current,
    durationMs: Math.max(0, finishedAt - current.startedAt),
    error: errorMessage,
    finishedAt,
    result: sanitizeAuditValue(result),
    status: explicitStatus ?? inferAuditStatus(result, errorMessage),
  };
  rememberAuditEntry(entry);
  enqueuePersistAuditEntry(entry);
  return entry;
}

export async function listAIToolAuditEntries(
  options: ListAIToolAuditOptions = {},
): Promise<AIToolAuditEntry[]> {
  const limit = normalizeLimit(options.limit);
  const persisted = await readPersistedAuditEntries(Math.max(limit, 200));
  const merged = new Map<string, AIToolAuditEntry>();
  for (const entry of persisted) merged.set(entry.callId, entry);
  for (const entry of runtime.calls.values()) merged.set(entry.callId, entry);

  return [...merged.values()]
    .filter((entry) => !options.tool || entry.tool === options.tool)
    .filter((entry) => !options.callerContext || entry.callerContext === options.callerContext)
    .toSorted((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export async function getAIToolAuditEntry(callId: string): Promise<AIToolAuditEntry | null> {
  const current = runtime.calls.get(callId);
  if (current) return current;
  const database = await openAuditDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(AUDIT_STORE_NAME, 'readonly');
    const request = transaction.objectStore(AUDIT_STORE_NAME).get(callId);
    request.onsuccess = () => resolve((request.result as AIToolAuditEntry | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

export function sanitizeAuditValue(value: unknown, depth = 0, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined') {
    return value;
  }
  if (typeof value === 'string') {
    if (DATA_URL_PATTERN.test(value)) return '[binary/image data omitted]';
    return value.length > AUDIT_MAX_STRING_LENGTH
      ? `${value.slice(0, AUDIT_MAX_STRING_LENGTH)}… [${value.length - AUDIT_MAX_STRING_LENGTH} chars omitted]`
      : value;
  }
  if (depth >= AUDIT_MAX_DEPTH) return '[nested value omitted]';
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, AUDIT_MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeAuditValue(entry, depth + 1));
    if (value.length > AUDIT_MAX_ARRAY_LENGTH) {
      sanitized.push(`[${value.length - AUDIT_MAX_ARRAY_LENGTH} entries omitted]`);
    }
    return sanitized;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of entries.slice(0, AUDIT_MAX_OBJECT_KEYS)) {
      sanitized[nestedKey] = sanitizeAuditValue(nestedValue, depth + 1, nestedKey);
    }
    if (entries.length > AUDIT_MAX_OBJECT_KEYS) {
      sanitized.__omittedKeys = entries.length - AUDIT_MAX_OBJECT_KEYS;
    }
    return sanitized;
  }
  return String(value);
}

function sanitizeAuditOptions(options: AIToolExecutionOptions | undefined): Record<string, unknown> {
  if (!options) return {};
  return sanitizeAuditValue({
    guidedAnimationBudgetMs: options.guidedAnimationBudgetMs,
    guidedCompressionMode: options.guidedCompressionMode,
    guidedLegacyFeedback: options.guidedLegacyFeedback,
    guidedReplay: options.guidedReplay,
    guidedSessionId: options.guidedSessionId,
    guidedVisualizationMode: options.guidedVisualizationMode,
    legacyFeedback: options.legacyFeedback,
    staggerBudgetMs: options.staggerBudgetMs,
    suppressHistory: options.suppressHistory,
  }) as Record<string, unknown>;
}

function clonePolicy(policy: ToolPolicyEntry | undefined): ToolPolicyEntry | null {
  return policy ? { ...policy, allowedCallers: [...policy.allowedCallers] } : null;
}

function rememberAuditEntry(entry: AIToolAuditEntry): void {
  if (!runtime.calls.has(entry.callId)) runtime.order.push(entry.callId);
  runtime.calls.set(entry.callId, entry);
  while (runtime.order.length > AUDIT_MEMORY_LIMIT) {
    const oldest = runtime.order.shift();
    if (oldest) runtime.calls.delete(oldest);
  }
}

function inferAuditStatus(
  result: AIToolAuditResult | undefined,
  error: string | undefined,
): Exclude<AIToolAuditStatus, 'running'> {
  const resultError = typeof result?.error === 'string'
    ? result.error
    : result?.error?.message;
  if (resultError && /cancelled|canceled|aborted/i.test(resultError)) return 'cancelled';
  if (error || result?.success === false) return 'failed';
  return 'succeeded';
}

function createAuditCallId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `ai-${crypto.randomUUID()}`
    : `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readBridgeSessionId(): string | null {
  try {
    return typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(TAB_ID_SESSION_KEY)
      : null;
  } catch {
    return null;
  }
}

function normalizeLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(AUDIT_DATABASE_LIMIT, Math.round(value)))
    : 500;
}

function openAuditDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  runtime.databasePromise ??= new Promise((resolve) => {
    const request = indexedDB.open(AUDIT_DB_NAME, AUDIT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUDIT_STORE_NAME)) {
        const store = database.createObjectStore(AUDIT_STORE_NAME, { keyPath: 'callId' });
        store.createIndex('startedAt', 'startedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return runtime.databasePromise;
}

function enqueuePersistAuditEntry(entry: AIToolAuditEntry): void {
  const previous = runtime.persistenceQueue ?? Promise.resolve();
  runtime.persistenceQueue = previous
    .then(() => persistAuditEntry(entry))
    .catch(() => undefined);
}

async function persistAuditEntry(entry: AIToolAuditEntry): Promise<void> {
  const database = await openAuditDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(AUDIT_STORE_NAME, 'readwrite');
    transaction.objectStore(AUDIT_STORE_NAME).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });

  runtime.persistedWrites += 1;
  if (runtime.persistedWrites % 100 === 0) {
    void trimPersistedAuditEntries(database);
  }
}

function readPersistedAuditEntries(limit: number): Promise<AIToolAuditEntry[]> {
  return openAuditDatabase().then((database) => {
    if (!database) return [];
    return new Promise<AIToolAuditEntry[]>((resolve) => {
      const entries: AIToolAuditEntry[] = [];
      const transaction = database.transaction(AUDIT_STORE_NAME, 'readonly');
      const index = transaction.objectStore(AUDIT_STORE_NAME).index('startedAt');
      const request = index.openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || entries.length >= limit) {
          resolve(entries);
          return;
        }
        entries.push(cursor.value as AIToolAuditEntry);
        cursor.continue();
      };
      request.onerror = () => resolve(entries);
    });
  });
}

function trimPersistedAuditEntries(database: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const transaction = database.transaction(AUDIT_STORE_NAME, 'readwrite');
    const index = transaction.objectStore(AUDIT_STORE_NAME).index('startedAt');
    let seen = 0;
    const request = index.openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      seen += 1;
      if (seen > AUDIT_DATABASE_LIMIT) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}
