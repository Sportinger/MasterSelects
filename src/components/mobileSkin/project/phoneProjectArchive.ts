// Export the open project as a .msproj archive on the phone. The desktop writes through a save picker;
// a phone has none, so the archive is built in memory first (the same exportCurrentProjectArchive and
// the same current-revision selection as the desktop dialog) and then shared or saved from a tap,
// because Web Share needs a fresh user gesture.

import { archiveFileName, exportCurrentProjectArchive, type ArchiveOutput } from '../../../services/project/repository/lifecycle/exportProjectArchive';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { Logger } from '../../../services/logger';

const log = Logger.create('PhoneProjectArchive');

export interface PhoneProjectArchive {
  blob: Blob;
  filename: string;
}

export type PhoneArchiveResult = { ok: true; archive: PhoneProjectArchive } | { ok: false; message: string };

/** An archive output that collects the stream in memory; close() refuses an empty archive. */
export function createMemoryArchiveOutput(): ArchiveOutput & { result(): Blob | null } {
  const chunks: Uint8Array[] = [];
  let blob: Blob | null = null;
  let bytes = 0;
  return {
    async write(chunk) { chunks.push(chunk.slice()); bytes += chunk.byteLength; },
    async close() {
      if (bytes === 0) throw new Error('The archive came out empty');
      blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
      chunks.length = 0;
    },
    async abort() { chunks.length = 0; blob = null; },
    result: () => blob,
  };
}

export async function buildPhoneProjectArchive(projectName: string, includeMedia: boolean, signal?: AbortSignal): Promise<PhoneArchiveResult> {
  const session = getActiveRepositorySession();
  if (!session) return { ok: false, message: 'No saved project is open.' };
  const output = createMemoryArchiveOutput();
  try {
    const revisionId = session.coordinator.getProjection().revisionId;
    if (!revisionId) return { ok: false, message: 'Make a first change so there is something to export.' };
    const metadata = await session.storage.getRevision(revisionId);
    if (!metadata) return { ok: false, message: 'The current version is not saved yet. Wait for the save status, then try again.' };
    await exportCurrentProjectArchive({
      history: { kind: 'current', revision: metadata.reference },
      journals: 'none', workspace: true, media: includeMedia ? 'self-contained' : 'linked',
    }, output, signal, session);
    const blob = output.result();
    if (!blob) return { ok: false, message: 'The archive came out empty.' };
    return { ok: true, archive: { blob, filename: archiveFileName(projectName) } };
  } catch (error) {
    log.error('Phone archive export failed', error);
    return { ok: false, message: `The project could not be exported: ${error instanceof Error ? error.message : String(error)}.` };
  }
}
