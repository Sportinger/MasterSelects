// Save permanently: folder and archive destinations. The folder destination is
// the existing Save As flow (createNewProject duplicates the open repository with
// its history into the picked folder and opens it there); this module adds the
// verification and retires the temporary copy afterwards.

import { Logger } from '../../logger';
import { RepositoryError } from '../repository/contracts';
import { getActiveRepositorySession, isScratchRepository } from '../repository/lifecycle/editorRepositoryLifecycle';
import { exportCurrentProjectArchive, pickArchiveOutput } from '../repository/lifecycle/exportProjectArchive';
import { isTemporaryProjectLocation } from './permanentSaveOptions';
import { verifyProjectSwitch } from './projectSwitchVerification';
import { removeTemporaryCopy } from './browserStorageMigration';

const log = Logger.create('PermanentSave');

export type FolderSaveResult =
  | { status: 'cancelled' }
  | { status: 'saved'; removedTemporary: boolean };

/**
 * `createProject` is the toolbar's Save As (createNewProject): it opens the
 * folder picker from the click and switches the editor to the new folder.
 */
export async function saveActiveProjectToFolder(name: string, createProject: (name: string) => Promise<boolean>): Promise<FolderSaveResult> {
  const session = getActiveRepositorySession();
  if (!session) throw new RepositoryError('conflict', 'No project is open.');
  // Captured before the picker so nothing asynchronous precedes it.
  const temporary = isTemporaryProjectLocation(session.location);
  const scratch = isScratchRepository();
  const from = session.location.kind === 'opfs' ? session.location.path : null;
  const revisionId = session.coordinator.getProjection().revisionId;
  if (!await createProject(name)) return { status: 'cancelled' };
  await verifyProjectSwitch(session, revisionId, location => location.kind === 'fsa' || location.kind === 'native');
  let removedTemporary = false;
  if (temporary && !scratch && from) {
    try { removedTemporary = await removeTemporaryCopy(from); }
    catch (error) { log.warn('The project folder is open; removing the temporary copy failed', error); }
  }
  log.info('Temporary project saved permanently to a folder', { removedTemporary });
  return { status: 'saved', removedTemporary };
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
