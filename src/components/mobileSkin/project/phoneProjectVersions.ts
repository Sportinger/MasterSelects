// Named versions of the open project: the same repository metadata the desktop History panel saves
// ("Save version") and restores (checkout). A version is a name on a confirmed revision; restoring
// checks that revision out, which the history can step back from like any other navigation.

import type { JsonValue, MetadataPage } from '../../../services/project/repository/contracts';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { Logger } from '../../../services/logger';
import type { PhoneActionResult } from '../contracts';

const log = Logger.create('PhoneProjectVersions');
const PREFIX = 'named-version:';

export interface PhoneProjectVersion {
  key: string;
  name: string;
  revisionId: string;
  createdAt: number;
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Parses metadata rows into versions, newest first; rows without a revision are skipped. */
export function parsePhoneProjectVersions(items: ReadonlyArray<{ key: string; value: JsonValue }>): PhoneProjectVersion[] {
  return items.flatMap((item) => {
    const value = (item.value ?? {}) as { name?: unknown; revisionId?: unknown; createdAt?: unknown };
    if (typeof value.revisionId !== 'string') return [];
    return [{
      key: item.key,
      name: typeof value.name === 'string' ? value.name : 'Version',
      revisionId: value.revisionId,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    }];
  }).toSorted((a, b) => b.createdAt - a.createdAt);
}

export async function listPhoneProjectVersions(): Promise<PhoneProjectVersion[]> {
  const session = getActiveRepositorySession();
  if (!session) return [];
  const items: Array<{ key: string; value: JsonValue }> = [];
  let cursor: string | undefined;
  do {
    const page = await session.client.request<MetadataPage<{ key: string; value: JsonValue }>>({
      type: 'metadata-query', options: { prefix: PREFIX, limit: 100, cursor },
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < 1000);
  return parsePhoneProjectVersions(items);
}

export function currentPhoneRevision(): string | null {
  return getActiveRepositorySession()?.coordinator.getStatus().revisionId ?? null;
}

export async function savePhoneProjectVersion(name: string): Promise<PhoneActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: 'Give the version a name.' };
  const session = getActiveRepositorySession();
  if (!session) return { ok: false, message: 'Versions need a saved project.' };
  if (!session.opening.writable) return { ok: false, message: 'This project is open read-only here.' };
  if (!session.coordinator.getStatus().revisionId) return { ok: false, message: 'Make a first change, then save a version.' };
  try {
    const receipt = session.coordinator.createNamedVersion(trimmed);
    await session.coordinator.flush(receipt);
    return { ok: true, message: `Version "${trimmed}" saved.` };
  } catch (error) {
    log.error('Saving a named version failed', error);
    return { ok: false, message: `The version could not be saved: ${message(error)}.` };
  }
}

export async function restorePhoneProjectVersion(version: PhoneProjectVersion): Promise<PhoneActionResult> {
  const session = getActiveRepositorySession();
  if (!session) return { ok: false, message: 'No project is open.' };
  if (session.coordinator.getStatus().revisionId === version.revisionId) return { ok: true, message: `"${version.name}" is already showing.` };
  try {
    const result = await session.coordinator.checkout(version.revisionId) as { status?: string; error?: unknown };
    if (result?.status === 'failed') return { ok: false, message: `"${version.name}" could not be restored: ${message(result.error)}.` };
    if (result?.status === 'cancelled') return { ok: false, message: 'Restoring was cancelled because the project changed. Try again.' };
    return { ok: true, message: `Restored "${version.name}". The newer state stays in History.` };
  } catch (error) {
    log.error('Restoring a named version failed', error);
    return { ok: false, message: `"${version.name}" could not be restored: ${message(error)}.` };
  }
}
