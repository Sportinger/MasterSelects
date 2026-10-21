// Save permanently: folder and archive destinations. The folder destination is
// the existing Save As flow (createNewProject duplicates the open repository with
// its history into the picked folder and opens it there); this module adds the
// verification and retires the temporary copy afterwards.

import { Logger } from '../../logger';
import { RepositoryError } from '../repository/contracts';
import { flushEditorRepository, getActiveRepositorySession, isScratchRepository } from '../repository/lifecycle/editorRepositoryLifecycle';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';
import { exportCurrentProjectArchive, pickArchiveOutput } from '../repository/lifecycle/exportProjectArchive';
import { isTemporaryProjectLocation } from './permanentSaveOptions';
import { verifyProjectSwitch } from './projectSwitchVerification';
import { forgetTemporaryRecentEntry, removeTemporaryCopy } from './browserStorageMigration';
import { FolderCopyUnverifiedError } from './folderCopyUnverifiedError';

export { FolderCopyUnverifiedError };

const log = Logger.create('PermanentSave');

export type FolderSaveResult =
  | { status: 'cancelled' }
  /** `unsavedChanges`: the folder copy is verified, but the edits made since the last save are still being saved there. */
  | { status: 'saved'; removedTemporary: boolean; unsavedChanges?: string };

const isFolderLocation = (location: RepositoryLocation) => location.kind === 'fsa' || location.kind === 'native';
const reasonOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * `createProject` is the toolbar's Save As (createNewProject): it opens the
 * folder picker from the click, switches the editor to the new folder and then
 * saves the editor's current state there.
 */
export async function saveActiveProjectToFolder(name: string, createProject: (name: string) => Promise<boolean>): Promise<FolderSaveResult> {
  const session = getActiveRepositorySession();
  if (!session) throw new RepositoryError('conflict', 'No project is open.');
  // Captured before the picker so nothing asynchronous precedes it.
  const temporary = isTemporaryProjectLocation(session.location);
  const scratch = isScratchRepository();
  const from = session.location.kind === 'opfs' ? session.location.path : null;
  const revisionId = session.coordinator.getProjection().revisionId;
  let unsavedChanges: string | undefined;
  try {
    if (!await createProject(name)) return { status: 'cancelled' };
  } catch (error) {
    const current = getActiveRepositorySession();
    // Nothing switched: the temporary project is untouched and the error says why.
    if (!current || current === session || !isFolderLocation(current.location)) throw error;
    // The folder copy is open; only saving the latest edits into it failed. Saving once more decides.
    log.warn('The project folder is open, but saving the latest changes there failed; saving again', error);
    try { await flushEditorRepository(); }
    catch (retry) { log.warn('Saving the latest changes into the project folder failed again', retry); unsavedChanges = reasonOf(retry); }
  }
  try { await verifyProjectSwitch(session, revisionId, isFolderLocation); }
  catch (error) {
    const current = getActiveRepositorySession();
    if (current && current !== session && isFolderLocation(current.location)) throw new FolderCopyUnverifiedError(reasonOf(error), { cause: error });
    throw error;
  }
  // The copy holds every confirmed revision of the temporary project, so removing it loses nothing
  // even while newer edits are still being saved into the folder.
  let removedTemporary = false;
  if (temporary && !scratch && from) {
    try {
      removedTemporary = await removeTemporaryCopy(from);
      if (removedTemporary) await forgetTemporaryRecentEntry(from);
    } catch (error) { log.warn('The project folder is open; removing the temporary copy failed', error); }
  }
  log.info('Temporary project saved permanently to a folder', { removedTemporary, unsavedChanges: Boolean(unsavedChanges) });
  return unsavedChanges ? { status: 'saved', removedTemporary, unsavedChanges } : { status: 'saved', removedTemporary };
}

/** Archive file name: the project name without characters file systems refuse. */
export function archiveFileName(projectName: string | null | undefined): string {
  return (projectName ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'Untitled Project';
}

/** Downloads (or, with a save picker, writes) the full project as .msproj; null when cancelled. */
export async function downloadActiveProjectArchive(projectName: string | null | undefined): Promise<string | null> {
  const fileName = archiveFileName(projectName);
  // The picker must be the first await to keep the click's user activation.
  const output = await pickArchiveOutput(fileName);
  if (!output) return null;
  const session = getActiveRepositorySession();
  if (!session) { await output.abort(new Error('No project is open')).catch(() => {}); throw new RepositoryError('conflict', 'No project is open.'); }
  await exportCurrentProjectArchive({ history: { kind: 'all' }, journals: 'all', workspace: true, media: 'linked' }, output, undefined, session);
  return `${fileName}.msproj`;
}
