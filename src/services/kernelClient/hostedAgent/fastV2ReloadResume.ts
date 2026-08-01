import {
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2StartRequest,
} from './fastV2StartContract';

const ACTIVE_FAST_V2_TURNS_KEY = 'masterselects.hostedAgent.fastV2.activeTurns.v1';
const RESUME_TTL_MS = 10 * 60 * 1_000;

export interface HostedAgentFastV2ReloadSnapshot {
  assistantMessageId: string;
  cursor: string | null;
  request: HostedAgentFastV2StartRequest;
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

function parseSnapshot(value: unknown): HostedAgentFastV2ReloadSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<HostedAgentFastV2ReloadSnapshot>;
  if (
    candidate.version !== 1
    || !validIdentifier(candidate.assistantMessageId)
    || (candidate.cursor !== null
      && !(typeof candidate.cursor === 'string' && /^[1-9]\d*$/.test(candidate.cursor)))
    || typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }
  try {
    const request = parseHostedAgentFastV2StartRequest(candidate.request);
    if (request.executionProfile === 'verified') return null;
    return {
      assistantMessageId: candidate.assistantMessageId,
      cursor: candidate.cursor,
      request,
      updatedAt: candidate.updatedAt,
      version: 1,
    };
  } catch {
    return null;
  }
}

function readAll(): HostedAgentFastV2ReloadSnapshot[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(ACTIVE_FAST_V2_TURNS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const minimumUpdatedAt = Date.now() - RESUME_TTL_MS;
    return parsed.map(parseSnapshot).filter((snapshot): snapshot is HostedAgentFastV2ReloadSnapshot => (
      snapshot !== null && snapshot.updatedAt >= minimumUpdatedAt
    ));
  } catch {
    return [];
  }
}

function writeAll(snapshots: HostedAgentFastV2ReloadSnapshot[]): void {
  const target = storage();
  if (!target) return;
  try {
    if (snapshots.length === 0) {
      target.removeItem(ACTIVE_FAST_V2_TURNS_KEY);
    } else {
      target.setItem(ACTIVE_FAST_V2_TURNS_KEY, JSON.stringify(snapshots.slice(-2)));
    }
  } catch {
    // A stale event cursor is unsafe if the matching revision-bound request
    // could not be persisted atomically.
    try {
      target.removeItem(ACTIVE_FAST_V2_TURNS_KEY);
    } catch {
      // Storage is unavailable; the pending UI bubble will fail closed.
    }
  }
}

export function saveHostedAgentFastV2ReloadSnapshot(
  snapshot: Omit<HostedAgentFastV2ReloadSnapshot, 'updatedAt' | 'version'>,
): void {
  const snapshots = readAll().filter(
    (candidate) => candidate.assistantMessageId !== snapshot.assistantMessageId,
  );
  if (snapshot.request.executionProfile === 'verified') {
    writeAll(snapshots);
    return;
  }
  snapshots.push({ ...snapshot, updatedAt: Date.now(), version: 1 });
  writeAll(snapshots);
}

export function readHostedAgentFastV2ReloadSnapshot(
  assistantMessageId: string,
): HostedAgentFastV2ReloadSnapshot | null {
  return readAll().find(
    (candidate) => candidate.assistantMessageId === assistantMessageId,
  ) ?? null;
}

export function hasHostedAgentFastV2ReloadSnapshot(assistantMessageId: string): boolean {
  return readHostedAgentFastV2ReloadSnapshot(assistantMessageId) !== null;
}

export function clearHostedAgentFastV2ReloadSnapshot(assistantMessageId: string): void {
  writeAll(readAll().filter(
    (candidate) => candidate.assistantMessageId !== assistantMessageId,
  ));
}
