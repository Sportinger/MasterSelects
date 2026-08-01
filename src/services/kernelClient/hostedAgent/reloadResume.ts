import type {
  HostedAgentK1ToolBatchResult,
  HostedAgentK1TurnRequest,
} from './contracts';
import {
  clearHostedAgentFastV2ReloadSnapshot,
  hasHostedAgentFastV2ReloadSnapshot,
} from './fastV2ReloadResume';

const CLIENT_INSTANCE_KEY = 'masterselects.hostedAgent.clientInstance.v1';
const ACTIVE_TURNS_KEY = 'masterselects.hostedAgent.activeTurns.v1';
const RESUME_TTL_MS = 10 * 60 * 1000;

export interface HostedAgentReloadSnapshot {
  assistantMessageId: string;
  completedBatches: HostedAgentK1ToolBatchResult[];
  cursor: string | null;
  request: HostedAgentK1TurnRequest;
  updatedAt: number;
  version: 1;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

function isSnapshot(value: unknown): value is HostedAgentReloadSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<HostedAgentReloadSnapshot>;
  const request = candidate.request;
  return candidate.version === 1
    && validIdentifier(candidate.assistantMessageId)
    && Array.isArray(candidate.completedBatches)
    && (candidate.cursor === null
      || (typeof candidate.cursor === 'string' && /^[1-9]\d*$/.test(candidate.cursor)))
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt)
    && request !== null
    && typeof request === 'object'
    && validIdentifier(request.turnId)
    && validIdentifier(request.clientInstanceId)
    && typeof request.toolSchemaVersion === 'string';
}

function readAll(): HostedAgentReloadSnapshot[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(ACTIVE_TURNS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const minimumUpdatedAt = Date.now() - RESUME_TTL_MS;
    return parsed.filter((value): value is HostedAgentReloadSnapshot => (
      isSnapshot(value) && value.updatedAt >= minimumUpdatedAt
    ));
  } catch {
    return [];
  }
}

function writeAll(snapshots: HostedAgentReloadSnapshot[]): void {
  const target = storage();
  if (!target) return;
  try {
    if (snapshots.length === 0) {
      target.removeItem(ACTIVE_TURNS_KEY);
    } else {
      target.setItem(ACTIVE_TURNS_KEY, JSON.stringify(snapshots.slice(-4)));
    }
  } catch {
    // Never retain an older cursor without the newest completed tool ledger:
    // that could replay an already-applied editor mutation after reload.
    try {
      target.removeItem(ACTIVE_TURNS_KEY);
    } catch {
      // Storage is unavailable; the project loader will settle the orphaned
      // pending bubble instead of attempting an unsafe resume.
    }
  }
}

export function getHostedAgentClientInstanceId(): string {
  const target = storage();
  const existing = target?.getItem(CLIENT_INSTANCE_KEY);
  if (validIdentifier(existing)) return existing;
  const created = `page_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    target?.setItem(CLIENT_INSTANCE_KEY, created);
  } catch {
    // The in-memory identifier still supports the current page.
  }
  return created;
}

export function saveHostedAgentReloadSnapshot(
  snapshot: Omit<HostedAgentReloadSnapshot, 'updatedAt' | 'version'>,
): void {
  const snapshots = readAll().filter(
    (candidate) => candidate.assistantMessageId !== snapshot.assistantMessageId,
  );
  snapshots.push({ ...snapshot, updatedAt: Date.now(), version: 1 });
  writeAll(snapshots);
}

export function readHostedAgentReloadSnapshot(
  assistantMessageId: string,
): HostedAgentReloadSnapshot | null {
  return readAll().find(
    (candidate) => candidate.assistantMessageId === assistantMessageId,
  ) ?? null;
}

export function hasHostedAgentReloadSnapshot(assistantMessageId: string): boolean {
  return readHostedAgentReloadSnapshot(assistantMessageId) !== null
    || hasHostedAgentFastV2ReloadSnapshot(assistantMessageId);
}

export function clearHostedAgentReloadSnapshot(assistantMessageId: string): void {
  writeAll(readAll().filter(
    (candidate) => candidate.assistantMessageId !== assistantMessageId,
  ));
  clearHostedAgentFastV2ReloadSnapshot(assistantMessageId);
}
