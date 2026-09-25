import { isDirectModelProfileId, type DirectModelProfileId } from './FlashBoardDirectModelProfile';

const DIRECT_CODEX_RELOAD_KEY = 'masterselects.direct-codex.active-turns.v1';
const DIRECT_CODEX_RELOAD_TTL_MS = 10 * 60 * 1_000;

export interface DirectCodexReloadSnapshot {
  assistantMessageId: string;
  conversationRef: string;
  /** Absent in snapshots written before model profiles; those were Codex turns. */
  modelProfile?: DirectModelProfileId;
  prompt: string;
  threadId: string;
  turnId: string | null;
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

function parseSnapshot(value: unknown): DirectCodexReloadSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<DirectCodexReloadSnapshot>;
  if (
    candidate.version !== 1
    || !validIdentifier(candidate.assistantMessageId)
    || !validIdentifier(candidate.conversationRef)
    || (candidate.modelProfile !== undefined && !isDirectModelProfileId(candidate.modelProfile))
    || !validIdentifier(candidate.threadId)
    || (candidate.turnId !== null && !validIdentifier(candidate.turnId))
    || typeof candidate.prompt !== 'string'
    || candidate.prompt.length === 0
    || candidate.prompt.length > 100_000
    || typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
  ) return null;
  return candidate as DirectCodexReloadSnapshot;
}

function readAll(): DirectCodexReloadSnapshot[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(DIRECT_CODEX_RELOAD_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const minimumUpdatedAt = Date.now() - DIRECT_CODEX_RELOAD_TTL_MS;
    return parsed.map(parseSnapshot).filter((snapshot): snapshot is DirectCodexReloadSnapshot => (
      snapshot !== null && snapshot.updatedAt >= minimumUpdatedAt
    ));
  } catch {
    return [];
  }
}

function writeAll(snapshots: DirectCodexReloadSnapshot[]): void {
  const target = storage();
  if (!target) return;
  try {
    if (snapshots.length === 0) target.removeItem(DIRECT_CODEX_RELOAD_KEY);
    else target.setItem(DIRECT_CODEX_RELOAD_KEY, JSON.stringify(snapshots.slice(-4)));
  } catch {
    try {
      target.removeItem(DIRECT_CODEX_RELOAD_KEY);
    } catch {
      // Reload recovery is unavailable when session storage is unavailable.
    }
  }
}

export function saveDirectCodexReloadSnapshot(
  snapshot: Omit<DirectCodexReloadSnapshot, 'updatedAt' | 'version'>,
): void {
  const snapshots = readAll().filter(
    candidate => candidate.assistantMessageId !== snapshot.assistantMessageId,
  );
  const candidate = parseSnapshot({ ...snapshot, updatedAt: Date.now(), version: 1 });
  if (candidate !== null) snapshots.push(candidate);
  writeAll(snapshots);
}

export function readDirectCodexReloadSnapshot(
  assistantMessageId: string,
): DirectCodexReloadSnapshot | null {
  return readAll().find(candidate => candidate.assistantMessageId === assistantMessageId) ?? null;
}

export function hasDirectCodexReloadSnapshot(assistantMessageId: string): boolean {
  return readDirectCodexReloadSnapshot(assistantMessageId) !== null;
}

export function clearDirectCodexReloadSnapshot(assistantMessageId: string): void {
  writeAll(readAll().filter(candidate => candidate.assistantMessageId !== assistantMessageId));
}
