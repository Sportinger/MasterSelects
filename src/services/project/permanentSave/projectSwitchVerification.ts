import { RepositoryError } from '../repository/contracts';
import type { RepositorySession } from '../repository/RepositorySession';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';
import { getActiveRepositorySession } from '../repository/lifecycle/editorRepositoryLifecycle';

/**
 * Confirms that a Save permanently copy is the open, writable project and that
 * it carries the revision the temporary project had confirmed. Until this
 * passes, the temporary copy must not be removed.
 */
export async function verifyProjectSwitch(
  previous: RepositorySession,
  revisionId: string | null,
  matches: (location: RepositoryLocation) => boolean,
): Promise<RepositorySession> {
  const current = getActiveRepositorySession();
  const unverified = (reason: string) => new RepositoryError('corrupt',
    `The permanent copy could not be verified (${reason}). The temporary project was kept.`);
  if (!current || current === previous) throw unverified('the copy did not open');
  if (!matches(current.location)) throw unverified('a different project location is open');
  if (!current.opening.writable) throw unverified('the copy opened read-only');
  if (revisionId && !await current.storage.getRevision(revisionId)) throw unverified('its history is missing the latest saved state');
  return current;
}
