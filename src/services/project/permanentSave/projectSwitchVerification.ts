import { RepositoryError } from '../repository/contracts';
import type { RepositorySession } from '../repository/RepositorySession';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';
import { getActiveRepositorySession } from '../repository/lifecycle/editorRepositoryLifecycle';
import { Logger } from '../../logger';

const log = Logger.create('PermanentSave');

/**
 * Confirms that a Save permanently copy is the open, writable project and that
 * it carries the revision the temporary project had confirmed. Every check reads
 * the session that is open now (the new location and its own storage worker),
 * never the temporary project it replaced. Until this passes, the temporary copy
 * must not be removed.
 */
export async function verifyProjectSwitch(
  previous: RepositorySession,
  revisionId: string | null,
  matches: (location: RepositoryLocation) => boolean,
): Promise<RepositorySession> {
  const current = getActiveRepositorySession();
  const unverified = (reason: string, cause?: unknown) => new RepositoryError('corrupt',
    `The permanent copy could not be verified (${reason}). The temporary project was kept.`, cause === undefined ? undefined : { cause });
  if (!current || current === previous) throw unverified('the copy did not open');
  if (!matches(current.location)) throw unverified('a different project location is open');
  if (current.descriptor?.lineageId !== previous.descriptor?.lineageId) throw unverified('a different project is open');
  if (!current.opening.writable) throw unverified('the copy opened read-only');
  if (!revisionId) return current;
  let found: unknown = null;
  for (let attempt = 1; attempt <= 2 && !found; attempt++) {
    try { found = await current.storage.getRevision(revisionId); }
    catch (error) {
      // A history read of the new location failed (e.g. a slow disk); one more read decides.
      if (attempt === 2) throw unverified(`its history could not be read: ${error instanceof Error ? error.message : String(error)}`, error);
      log.warn('Reading the permanent copy history failed; reading it once more', error);
    }
  }
  if (!found) throw unverified('its history is missing the latest saved state');
  return current;
}
