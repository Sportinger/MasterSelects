import {
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2StartRequest,
} from './fastV2StartContract';
import type { HostedAgentK2OperationCheckpoint } from './k2Client';

const ACTIVE_FAST_V2_TURNS_KEY = 'masterselects.hostedAgent.fastV2.activeTurns.v3';
const LEGACY_FAST_V2_TURNS_KEY = 'masterselects.hostedAgent.fastV2.activeTurns.v2';
const RESUME_TTL_MS = 10 * 60 * 1_000;
const MAX_CANONICAL_TIMELINE_CHARACTERS = 2_000_000;

export interface HostedAgentFastV2ReloadSnapshot {
  assistantMessageId: string;
  cursor: string | null;
  operationCheckpoint: HostedAgentK2OperationCheckpoint | null;
  request: HostedAgentFastV2StartRequest;
  timelineRevision: number;
  timelineStateCanonical: string;
  updatedAt: number;
  version: 3;
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

function parseOperationCheckpoint(
  value: unknown,
  request: HostedAgentFastV2StartRequest,
): HostedAgentK2OperationCheckpoint | null | undefined {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkpoint = value as Partial<HostedAgentK2OperationCheckpoint>;
  const descriptor = checkpoint.descriptor;
  if (
    !Number.isSafeInteger(checkpoint.nextSequence)
    || (checkpoint.nextSequence ?? -1) < 0
    || descriptor === null
    || typeof descriptor !== 'object'
    || Array.isArray(descriptor)
    || descriptor.clientInstanceId !== request.clientInstanceId
    || descriptor.turnId !== request.turnId
    || !validIdentifier(descriptor.sessionId)
  ) {
    return undefined;
  }
  return {
    descriptor: structuredClone(descriptor),
    nextSequence: checkpoint.nextSequence!,
  };
}

function parseSnapshot(value: unknown): HostedAgentFastV2ReloadSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<HostedAgentFastV2ReloadSnapshot>;
  if (
    candidate.version !== 3
    || !validIdentifier(candidate.assistantMessageId)
    || (candidate.cursor !== null
      && !(typeof candidate.cursor === 'string' && /^[1-9]\d*$/.test(candidate.cursor)))
    || typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
    || typeof candidate.timelineRevision !== 'number'
    || !Number.isSafeInteger(candidate.timelineRevision)
    || candidate.timelineRevision < 0
    || typeof candidate.timelineStateCanonical !== 'string'
    || candidate.timelineStateCanonical.length === 0
    || candidate.timelineStateCanonical.length > MAX_CANONICAL_TIMELINE_CHARACTERS
  ) {
    return null;
  }
  try {
    const request = parseHostedAgentFastV2StartRequest(candidate.request);
    const operationCheckpoint = parseOperationCheckpoint(candidate.operationCheckpoint, request);
    if (operationCheckpoint === undefined) return null;
    return {
      assistantMessageId: candidate.assistantMessageId,
      cursor: candidate.cursor,
      operationCheckpoint,
      request,
      timelineRevision: candidate.timelineRevision,
      timelineStateCanonical: candidate.timelineStateCanonical,
      updatedAt: candidate.updatedAt,
      version: 3,
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
    target.removeItem(LEGACY_FAST_V2_TURNS_KEY);
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
  const candidate = parseSnapshot({ ...snapshot, updatedAt: Date.now(), version: 3 });
  if (candidate !== null) snapshots.push(candidate);
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
