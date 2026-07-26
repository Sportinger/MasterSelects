import { APP_VERSION } from '../../version';
import { useMediaStore } from '../../stores/mediaStore';
import { sanitizeAuditValue } from '../aiTools/audit';
import type {
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatRequest,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardExecutedToolCall,
  FlashBoardOpenAiReasoningEffort,
} from './FlashBoardChatTypes';

const CHAT_RUN_DB_NAME = 'masterselects-ai-chat-runs';
const CHAT_RUN_DB_VERSION = 1;
const CHAT_RUN_STORE_NAME = 'runs';
const CHAT_RUN_MEMORY_LIMIT = 500;
const CHAT_RUN_DATABASE_LIMIT = 2_000;
const TAB_ID_SESSION_KEY = 'masterselects.aiBridgeTabId';

export type FlashBoardChatRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface FlashBoardChatRunRecord {
  appVersion: string;
  durationMs?: number;
  error?: string;
  executedToolCalls: FlashBoardExecutedToolCall[];
  finishedAt?: number;
  hostedAvailable: boolean;
  idempotencyKey?: string;
  model: string;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  projectId: string | null;
  projectName: string;
  prompt: string;
  promptVersion: FlashBoardChatPromptVersion | 'custom';
  provider: FlashBoardChatProvider;
  response?: string;
  runId: string;
  sessionId: string | null;
  source: FlashBoardChatRunSource;
  startedAt: number;
  status: FlashBoardChatRunStatus;
  systemPrompt: string;
  systemPromptIncludeContext: boolean;
  temperature: number;
  toolExecutionMode: FlashBoardChatToolExecutionMode;
}

interface ChatRunRuntime {
  databasePromise?: Promise<IDBDatabase | null>;
  order: string[];
  persistenceQueue?: Promise<void>;
  persistedWrites: number;
  runs: Map<string, FlashBoardChatRunRecord>;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __MASTERSELECTS_CHAT_RUN_AUDIT__?: ChatRunRuntime;
};
const runtime = runtimeGlobal.__MASTERSELECTS_CHAT_RUN_AUDIT__ ?? {
  order: [],
  persistedWrites: 0,
  runs: new Map<string, FlashBoardChatRunRecord>(),
};
runtimeGlobal.__MASTERSELECTS_CHAT_RUN_AUDIT__ = runtime;

export function beginFlashBoardChatRun(
  request: FlashBoardChatRequest,
  systemPrompt: string,
): FlashBoardChatRunRecord {
  const media = useMediaStore.getState();
  const record: FlashBoardChatRunRecord = {
    appVersion: APP_VERSION,
    executedToolCalls: [],
    hostedAvailable: request.hostedAvailable === true,
    idempotencyKey: request.idempotencyKey,
    model: request.model,
    openAiReasoningEffort: request.openAiReasoningEffort,
    projectId: media.currentProjectId,
    projectName: media.currentProjectName,
    prompt: request.prompt,
    promptVersion: request.systemPromptOverride?.trim()
      ? 'custom'
      : request.promptVersion ?? 'v2',
    provider: request.provider,
    runId: createChatRunId(),
    sessionId: readBridgeSessionId(),
    source: request.runSource ?? 'ui',
    startedAt: Date.now(),
    status: 'running',
    systemPrompt,
    systemPromptIncludeContext: request.systemPromptIncludeContext !== false,
    temperature: request.temperature,
    toolExecutionMode: request.toolExecutionMode ?? 'normal',
  };
  remember(record);
  enqueuePersist(record);
  return record;
}

export function completeFlashBoardChatRun(
  runId: string,
  input: {
    error?: unknown;
    executedToolCalls: FlashBoardExecutedToolCall[];
    response?: string;
  },
): FlashBoardChatRunRecord | null {
  const current = runtime.runs.get(runId);
  if (!current) return null;

  const finishedAt = Date.now();
  const error = input.error instanceof Error
    ? input.error.message
    : typeof input.error === 'string'
      ? input.error
      : undefined;
  const record: FlashBoardChatRunRecord = {
    ...current,
    durationMs: Math.max(0, finishedAt - current.startedAt),
    error,
    executedToolCalls: sanitizeAuditValue(input.executedToolCalls) as FlashBoardExecutedToolCall[],
    finishedAt,
    response: input.response,
    status: error
      ? /abort|cancel|stopped/i.test(error) ? 'cancelled' : 'failed'
      : 'succeeded',
  };
  remember(record);
  enqueuePersist(record);
  return record;
}

export async function listFlashBoardChatRuns(input: {
  limit?: number;
  source?: FlashBoardChatRunSource;
} = {}): Promise<FlashBoardChatRunRecord[]> {
  const limit = normalizeLimit(input.limit);
  const persisted = await readPersistedRuns(Math.max(limit, 100));
  const merged = new Map(persisted.map((record) => [record.runId, record]));
  for (const record of runtime.runs.values()) merged.set(record.runId, record);

  return [...merged.values()]
    .filter((record) => !input.source || record.source === input.source)
    .toSorted((left, right) => right.startedAt - left.startedAt)
    .slice(0, limit);
}

export async function getFlashBoardChatRun(runId: string): Promise<FlashBoardChatRunRecord | null> {
  const current = runtime.runs.get(runId);
  if (current) return current;
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const request = database.transaction(CHAT_RUN_STORE_NAME, 'readonly')
      .objectStore(CHAT_RUN_STORE_NAME)
      .get(runId);
    request.onsuccess = () => resolve((request.result as FlashBoardChatRunRecord | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function findFlashBoardChatRunByIdempotencyKey(
  idempotencyKey: string,
): Promise<FlashBoardChatRunRecord | null> {
  if (!idempotencyKey) return null;
  const runs = await listFlashBoardChatRuns({ limit: CHAT_RUN_DATABASE_LIMIT });
  return runs.find((run) => run.idempotencyKey === idempotencyKey) ?? null;
}

function remember(record: FlashBoardChatRunRecord): void {
  if (!runtime.runs.has(record.runId)) runtime.order.push(record.runId);
  runtime.runs.set(record.runId, record);
  while (runtime.order.length > CHAT_RUN_MEMORY_LIMIT) {
    const oldest = runtime.order.shift();
    if (oldest) runtime.runs.delete(oldest);
  }
}

function enqueuePersist(record: FlashBoardChatRunRecord): void {
  const previous = runtime.persistenceQueue ?? Promise.resolve();
  runtime.persistenceQueue = previous
    .then(() => persist(record))
    .catch(() => undefined);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  runtime.databasePromise ??= new Promise((resolve) => {
    const request = indexedDB.open(CHAT_RUN_DB_NAME, CHAT_RUN_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHAT_RUN_STORE_NAME)) {
        const store = database.createObjectStore(CHAT_RUN_STORE_NAME, { keyPath: 'runId' });
        store.createIndex('startedAt', 'startedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return runtime.databasePromise;
}

async function persist(record: FlashBoardChatRunRecord): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(CHAT_RUN_STORE_NAME, 'readwrite');
    transaction.objectStore(CHAT_RUN_STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
  });

  runtime.persistedWrites += 1;
  if (runtime.persistedWrites % 100 === 0) void trimDatabase(database);
}

function readPersistedRuns(limit: number): Promise<FlashBoardChatRunRecord[]> {
  return openDatabase().then((database) => {
    if (!database) return [];
    return new Promise((resolve) => {
      const records: FlashBoardChatRunRecord[] = [];
      const transaction = database.transaction(CHAT_RUN_STORE_NAME, 'readonly');
      const request = transaction.objectStore(CHAT_RUN_STORE_NAME)
        .index('startedAt')
        .openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || records.length >= limit) {
          resolve(records);
          return;
        }
        records.push(cursor.value as FlashBoardChatRunRecord);
        cursor.continue();
      };
      request.onerror = () => resolve(records);
    });
  });
}

function trimDatabase(database: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const transaction = database.transaction(CHAT_RUN_STORE_NAME, 'readwrite');
    const request = transaction.objectStore(CHAT_RUN_STORE_NAME)
      .index('startedAt')
      .openCursor(null, 'prev');
    let seen = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      seen += 1;
      if (seen > CHAT_RUN_DATABASE_LIMIT) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => resolve();
    transaction.onerror = () => resolve();
  });
}

function createChatRunId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `chat-run-${crypto.randomUUID()}`
    : `chat-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    ? Math.max(1, Math.min(CHAT_RUN_DATABASE_LIMIT, Math.round(value)))
    : 100;
}
