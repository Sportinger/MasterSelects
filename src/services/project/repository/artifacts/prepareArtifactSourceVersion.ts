import type { RepositorySession } from '../RepositorySession';
import { queueSourceIdentity } from './queueSourceIdentity';

interface SourceAccess {
  isActive(): boolean;
  readFile(): Blob | undefined;
  readVersion(): string | null;
}

/** A result must never be saved without the identity its reader requires. */
export async function prepareArtifactSourceVersion(
  session: RepositorySession,
  mediaId: string,
  access: SourceAccess,
): Promise<string | null> {
  if (!access.isActive()) return null;
  const known = access.readVersion();
  if (known) return known;
  const file = access.readFile();
  if (!(file instanceof Blob) || !file.size) return null;
  const isCurrent = () => access.isActive() && access.readFile() === file;
  const verified = await queueSourceIdentity(session, mediaId, file, isCurrent);
  if (!verified || !isCurrent()) return null;
  const version = `sha256:${verified.contentHash.replace(/^sha256:/u, '')}`;
  return access.readVersion() === version ? version : null;
}
