// Completes an import whose copy into the project runs in the background (importFile with
// copyInBackground). The media are on the timeline with the original File while the copy runs; when the
// copy is durable they switch to the project copy: file, projectPath and hasFileHandle, then the primary
// URL. projectPath is a resolver field kept in the project's workspace views (codec/resolvers/<media>), not
// in content revisions; whatever content the switch changes is written as a 'background' revision, never
// an Undo step. Undo/Redo activation reads projectPath from the views, so a recorded switch survives them.
//
// The switch is recorded only when the project can take it without touching anyone else's open work:
// - A multi-file phone import keeps one "Add media" batch open while files 2..n import and the clips are
//   placed; that batch owns the media entities until it commits. A copy that finishes earlier waits for
//   the batch to close (coordinator notifications) instead of failing on "belongs to another transaction".
// - Undo/Redo activation and a project handover refuse writes only while they run; the switch waits.
//   Every other refusal (a read-only tab, a failed storage worker, an editor out of sync) stays for as long
//   as the project is open: the switch fails visibly instead of waiting forever.
// - Undo (or a delete) removes the media; the copy then counts as unused, and if Undo/Redo brings the media
//   back without their project path the switch is recorded then, and their timeline clips are rebound to it.
//   A cancelled "Add media" batch can never bring them back: its copy is unused and the wait ends.
// The copy's notice entry (ticket) stays pending until the project path is saved (the views are flushed),
// so the unload guard, the "Copying into project" status and a project switch (projectSwitchCopyWait)
// cover the whole way. A running copy is also noted in the project (pendingProjectCopyMarker), so a page
// killed meanwhile reports it on reopen. A failure marks the media ('failed') and is reported through the
// project media copy notice, never only logged. Media replaced meanwhile, or a project that closed, change nothing.

import type { MediaState } from '../../types';
import type { ProjectCopySource } from '../../helpers/importPipeline';
import { beginEditorTransaction, cancelEditorTransaction, commitEditorTransaction, flushEditorRepositoryViews, getEditorRepositorySession,
  ownsEditorTransaction, runEditorTransaction, subscribeEditorRepositorySession } from '../../../../services/project/repository/transaction/editorMutationRuntime';
import type { RepositorySession } from '../../../../services/project/repository/RepositorySession';
import { RepositoryError } from '../../../../services/project/repository/contracts';
import { entityKey } from '../../../../services/project/repository/domains/jsonBoundary';
import { createRenderablePrimaryMediaObjectUrl } from '../../../../services/project/mediaObjectUrlManager';
import { beginProjectMediaCopy } from '../../../../services/project/mediaCopy/projectMediaCopyNotices';
import { clearProjectCopyPending, markProjectCopyPending } from '../../../../services/project/mediaCopy/pendingProjectCopyMarker';
import { fileImportLog as log } from './log';

type MediaSet = (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void;

export type ProjectCopyOutcome = 'switched' | 'failed' | 'stale';

export interface BackgroundProjectCopyDeps {
  createUrl?: (mediaId: string, file: File) => Promise<string>;
}

const SWITCH_LABEL = 'Media copied into project';

/** Records `action`'s content change as its own background revision (no Undo step), or runs it plainly without a project. */
function writeBackgroundRevision(action: () => void): void {
  if (!getEditorRepositorySession()) { action(); return; }
  const token = beginEditorTransaction(SWITCH_LABEL, 'background');
  try { runEditorTransaction(token, action); commitEditorTransaction(token); }
  catch (error) { if (ownsEditorTransaction(token)) cancelEditorTransaction(token); throw error; }
}

/** The project refuses this write only for now: an open transaction owns the media, or Undo/Redo or a handover runs. */
function projectIsBusy(session: RepositorySession | null, keys: readonly string[]): boolean {
  return !!session && (session.coordinator.isSwitching() || keys.some((key) => session.coordinator.isEntityOpen(key)));
}

/** Rebinds the media's timeline clips that came back without a runtime file (Redo) to the project copy. */
async function rebindReturnedClips(id: string, file: File, url: string, media: { type?: string; hasAudio?: boolean }): Promise<void> {
  try {
    if (media.type === 'video' || media.type === 'audio' || media.type === 'image') {
      const { restoreLinkedTimelineMedia } = await import('../../../../services/project/repository/transaction/restoreLinkedTimelineMedia');
      restoreLinkedTimelineMedia(id, file, url, media);
    } else {
      const { updateTimelineClips } = await import('../fileManage/timelineClipReload');
      await updateTimelineClips(id, file, { invalidateCaches: false, generateThumbnails: false });
    }
  } catch (error) {
    log.warn('The timeline clips of media switched to their project copy could not be rebound; they reconnect on reload', { id, error });
  }
}

/**
 * Waits for `projectCopy` and switches media `id` from `original` to the project copy. Call it right after
 * the media were committed (or added inside an open batch). The returned promise settles once the switch is
 * saved, the copy failed, or the switch became pointless (media replaced or never committed, project
 * closed); it never rejects.
 */
export function switchToProjectCopyWhenDurable(
  baseSet: MediaSet,
  baseGet: () => MediaState,
  id: string,
  original: File,
  projectCopy: Promise<ProjectCopySource | null>,
  deps: BackgroundProjectCopyDeps = {},
): Promise<ProjectCopyOutcome> {
  const session = getEditorRepositorySession();
  const createUrl = deps.createUrl ?? ((mediaId: string, file: File) => createRenderablePrimaryMediaObjectUrl(mediaId, file));
  const mediaKey = entityKey('media', 'project', id);
  const keys = [mediaKey, `source-identity:${id}`];
  const unsubscribers: Array<() => void> = [];
  const stop = () => { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe(); };
  const ownSession = () => session !== null && getEditorRepositorySession() === session;

  // Whether the media ever reached the project's committed state: a cancelled "Add media" batch never does.
  let committed = false;
  const observeCommit = () => {
    if (!committed && session && session.coordinator.getEntities().has(mediaKey) && !session.coordinator.isEntityOpen(mediaKey)) committed = true;
  };
  if (session) {
    observeCommit();
    unsubscribers.push(session.coordinator.subscribe(observeCommit));
    markProjectCopyPending(id, original);
  }

  const markFailed = (files: readonly File[]) => {
    // projectCopy is runtime state only: this write never forms a revision and cannot conflict.
    try {
      baseSet((state) => ({
        files: state.files.map((candidate) => candidate.id === id && candidate.file && files.includes(candidate.file)
          ? { ...candidate, projectCopy: 'failed' as const } : candidate),
      }));
    } catch (error) {
      log.warn('Could not mark media whose project copy failed', { id, error });
    }
  };
  const clearMarker = () => { if (ownSession()) clearProjectCopyPending(id); };

  return projectCopy.then((copied): Promise<ProjectCopyOutcome> | ProjectCopyOutcome => {
    if (!copied) {
      // The copy already put the reason into the notice.
      stop(); clearMarker(); markFailed([original]);
      return 'failed';
    }
    return recordSwitch(copied);
  }, (error: unknown): ProjectCopyOutcome => {
    // processImport's background copy never rejects; anything else handing in a promise is reported, too.
    stop(); clearMarker();
    beginProjectMediaCopy(original, false).fail(error);
    markFailed([original]);
    return 'failed';
  });

  function recordSwitch(copied: ProjectCopySource): Promise<ProjectCopyOutcome> {
    return new Promise<ProjectCopyOutcome>((resolve) => {
      let absent = false;
      let finished = false;
      let ticketSettled = false;
      const settleTicket = (how: 'done' | 'unused', reason = '') => {
        if (ticketSettled) return;
        ticketSettled = true;
        if (how === 'done') copied.ticket?.done(); else copied.ticket?.unused(reason);
      };
      const failTicket = (error: unknown) => {
        // A ticket already settled (the media were removed when the copy finished) cannot fail any more.
        if (ticketSettled || !copied.ticket) { ticketSettled = true; beginProjectMediaCopy(original, false).fail(error); return; }
        ticketSettled = true;
        copied.ticket.fail(error);
      };
      const finish = (outcome: ProjectCopyOutcome, ticket: () => void) => {
        if (finished) return;
        finished = true;
        stop();
        ticket();
        resolve(outcome);
      };
      const fail = (error: unknown) => {
        clearMarker();
        markFailed([original, copied.file]);
        finish('failed', () => failTicket(error));
      };

      const attempt = () => {
        if (finished) return;
        if (session && !ownSession()) {
          log.info('Background project copy finished after its project closed; kept unused', { id, projectPath: copied.relativePath });
          finish('stale', () => settleTicket('unused', 'its project closed'));
          return;
        }
        // An open transaction (the multi-file "Add media" batch, a gesture) or Undo/Redo still holds the project: wait.
        if (projectIsBusy(session, keys)) return;
        const current = baseGet().files.find((candidate) => candidate.id === id);
        if (!current) {
          if (!session || !committed) {
            log.info('Background project copy finished for media that were never kept; unused', { id, projectPath: copied.relativePath });
            clearMarker();
            finish('stale', () => settleTicket('unused', session ? 'its import was cancelled' : 'its media were removed'));
            return;
          }
          // Undone or deleted: no media use the copy now. If Undo/Redo brings them back without their
          // project path, the switch is recorded then (this waiter stays until the project closes).
          if (!absent) log.info('Media of a finished project copy were removed; the switch follows if they come back', { id });
          absent = true;
          clearMarker();
          settleTicket('unused', 'its media were removed');
          return;
        }
        const returned = absent && !current.projectPath;
        if (absent && current.projectPath) {
          finish('stale', () => settleTicket('unused', 'its media came back with another project path'));
          return;
        }
        if (current.file !== original && !returned) {
          log.info('Background project copy finished for media that changed meanwhile; kept unused', { id, projectPath: copied.relativePath });
          clearMarker();
          finish('stale', () => settleTicket('unused', 'its media were replaced'));
          return;
        }
        try {
          writeBackgroundRevision(() => baseSet((state) => ({
            files: state.files.map((candidate) => candidate.id === id
              ? { ...candidate, file: copied.file, projectPath: copied.relativePath, hasFileHandle: true, projectCopy: undefined }
              : candidate),
          })));
        } catch (error) {
          if (error instanceof RepositoryError && error.code === 'ownership' && projectIsBusy(session, keys)) {
            log.debug('Project copy switch waits for the project to take writes', { id, error });
            return;
          }
          log.warn('Media could not be switched to their project copy', { id, projectPath: copied.relativePath, error });
          fail(error);
          return;
        }
        log.info('Media switched to their project copy', { id, projectPath: copied.relativePath });
        finished = true;
        stop();
        clearMarker();
        void completeSwitch(copied, returned ? current : null).then((error) => {
          if (error) {
            log.warn('The project path of media switched to their project copy could not be saved', { id, projectPath: copied.relativePath, error });
            markFailed([copied.file]);
            failTicket(error);
            resolve('failed');
            return;
          }
          settleTicket('done');
          resolve('switched');
        });
      };

      if (session) {
        // Every commit, cancel and Undo/Redo notifies; the attempt runs after the notifying call has finished.
        unsubscribers.push(session.coordinator.subscribe(() => queueMicrotask(attempt)));
        unsubscribers.push(subscribeEditorRepositorySession(() => queueMicrotask(attempt)));
      }
      attempt();
    });
  }

  /**
   * After the switch is recorded: the copy's primary URL (created only now, since registering it retires the
   * media's current URL), timeline clips that came back without a file, and the saved project path. Resolves
   * to the error of a failed save, or null.
   */
  async function completeSwitch(copied: ProjectCopySource, returned: { type?: string; hasAudio?: boolean; url?: string } | null): Promise<unknown> {
    const url = await adoptCopyUrl(copied);
    if (returned) await rebindReturnedClips(id, copied.file, url ?? returned.url ?? '', returned);
    if (!session) return null;
    try {
      await flushEditorRepositoryViews();
      return null;
    } catch (error) {
      return error;
    }
  }

  async function adoptCopyUrl(copied: ProjectCopySource): Promise<string | null> {
    if (copied.file === original) return null;
    try {
      const url = await createUrl(id, copied.file);
      // url is runtime state only: no revision, no conflict with an open transaction.
      baseSet((state) => ({
        files: state.files.map((candidate) => candidate.id === id && candidate.file === copied.file ? { ...candidate, url } : candidate),
      }));
      return url;
    } catch (error) {
      log.warn('The project copy is recorded but its preview URL could not be created; the media keep their current URL', { id, error });
      return null;
    }
  }
}
