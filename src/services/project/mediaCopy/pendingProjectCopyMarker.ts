// A durable note in the project of background copies into it that are still running. Android never fires
// beforeunload when a tab is discarded or swiped away, and the media were already saved before their copy
// was durable, so without this note a reopened project would only show offline media. On reopen, media
// that are still noted and never got their project path are reported (pick them again); the note is cleared.
// It is a workspace view: no content revision, no Undo step.

import { Logger } from '../../logger';
import type { MediaState } from '../../../stores/mediaStore/types';
import { getEditorRepositorySession, getEditorRepositoryWorkspace, queueEditorRepositoryView } from '../repository/transaction/editorMutationRuntime';
import { getRepositoryStore } from '../repository/transaction/storeMutationBoundary';
import { noteInterruptedProjectMediaCopy } from './projectMediaCopyNotices';

const log = Logger.create('ProjectMediaCopy');

/** Workspace view key; read back on open (editorRepositorySession readEditorRepositoryWorkspace). */
export const PENDING_PROJECT_COPIES_VIEW = 'media-copy/pending';

type PendingCopies = Record<string, { name: string; bytes: number }>;

function readPending(): PendingCopies {
  const value = (getEditorRepositoryWorkspace() as Record<string, unknown>)[PENDING_PROJECT_COPIES_VIEW];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PendingCopies : {};
}

function writePending(next: PendingCopies): void {
  try {
    queueEditorRepositoryView(PENDING_PROJECT_COPIES_VIEW, next);
  } catch (error) {
    log.warn('The note of running copies into the project could not be saved', { error });
  }
}

/** Notes media `id` whose copy into the open project is running. */
export function markProjectCopyPending(id: string, file: Pick<File, 'name' | 'size'>): void {
  if (!getEditorRepositorySession()) return;
  writePending({ ...readPending(), [id]: { name: file.name, bytes: file.size } });
}

/** Removes the note of media `id` (switched, failed and reported, or no longer used). */
export function clearProjectCopyPending(id: string): void {
  if (!getEditorRepositorySession()) return;
  const current = readPending();
  if (!(id in current)) return;
  const next = { ...current };
  delete next[id];
  writePending(next);
}

/**
 * Called once a project is open: media still noted that exist without a project path lost their copy when
 * the page closed; they are reported through the project media copy notice. The note is cleared.
 */
export function reportInterruptedProjectMediaCopies(): void {
  if (!getEditorRepositorySession()) return;
  const pending = readPending();
  const ids = Object.keys(pending);
  if (!ids.length) return;
  const media = getRepositoryStore('media')?.getState() as MediaState | undefined;
  for (const id of ids) {
    const entry = media?.files.find((file) => file.id === id);
    if (entry && !entry.projectPath) noteInterruptedProjectMediaCopy(pending[id].name, pending[id].bytes);
  }
  writePending({});
}
