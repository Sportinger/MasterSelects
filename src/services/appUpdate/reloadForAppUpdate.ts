// Reloads the editor into a newly deployed version without losing work: the flow in
// updateReloadFlow.ts, wired to the editor's export flag, media copies, project save and the page.

import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';
import { saveCurrentProject } from '../projectSync';
import { hasPendingProjectMediaCopies, subscribeProjectMediaCopyNotice } from '../project/mediaCopy/projectMediaCopyNotices';
import { isProjectStoreSyncInProgress, waitForProjectStoreSync } from '../project/projectStoreSyncGuard';
import { flushEditorRepository, getActiveRepositorySession } from '../project/repository/lifecycle/editorRepositoryLifecycle';
import { useTimelineStore } from '../../stores/timeline';
import { runUpdateReload, type SaveWorkResult, type UpdateReloadDeps, type UpdateReloadOptions, type UpdateReloadOutcome } from './updateReloadFlow';

const log = Logger.create('AppUpdateReload');
const PAGE_REFRESH_TIMEOUT_MS = 5000;

const failure = (error: unknown): SaveWorkResult => ({
  ok: false,
  message: `The project could not be saved, so the app did not reload: ${error instanceof Error ? error.message : String(error)}`,
});

async function saveWork(): Promise<SaveWorkResult> {
  const session = getActiveRepositorySession();
  // No repository yet, or a read-only tab: nothing of this tab is waiting to be written. Projectless
  // edits without a repository keep the browser's leave warning (projectLifecycle.ts).
  if (!session || !session.opening.writable) return { ok: true };
  try {
    // A restore or save still moving store state into the project finishes first (as a manual save does).
    while (isProjectStoreSyncInProgress()) await waitForProjectStoreSync();
    if (getActiveRepositorySession() !== session) return { ok: false, message: 'The project changed while saving, so the app did not reload.' };
    if (projectFileService.isProjectOpen()) {
      return await saveCurrentProject({ source: 'manual' })
        ? { ok: true }
        : { ok: false, message: 'The project could not be saved, so the app did not reload.' };
    }
    // The browser recovery workspace (no project chosen yet) is restored after the reload once flushed.
    await flushEditorRepository();
    return { ok: true };
  } catch (error) {
    log.error('Saving before the update reload failed', error);
    return failure(error);
  }
}

/**
 * The page HTML is revalidated and assets are content-hashed (deploys keep earlier assets), so a reload
 * normally gets the new build. A fetch with `cache: 'reload'` refreshes the HTTP cache entry of this page
 * anyway, and a service worker (the app registers none; one could be left from an old build) would answer
 * the reload from its own cache, so it is removed.
 */
async function bypassPageCache(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    for (const registration of registrations) {
      log.info('Removing a leftover service worker before the update reload', registration.scope);
      await registration.unregister();
    }
  } catch (error) {
    log.debug('Service worker check before the update reload failed', error);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_REFRESH_TIMEOUT_MS);
  try {
    await fetch(`${window.location.pathname}${window.location.search}`, { cache: 'reload', credentials: 'same-origin', signal: controller.signal });
  } catch (error) {
    log.debug('Refreshing the cached page before the update reload failed; reloading anyway', error);
  } finally {
    clearTimeout(timer);
  }
}

export const editorUpdateReloadDeps: UpdateReloadDeps = {
  isExporting: () => useTimelineStore.getState().isExporting,
  subscribeExporting: listener => useTimelineStore.subscribe(state => state.isExporting, listener),
  hasPendingMediaCopies: hasPendingProjectMediaCopies,
  subscribeMediaCopies: subscribeProjectMediaCopyNotice,
  saveWork,
  bypassPageCache,
  reload: () => {
    log.info('Reloading into the new version');
    window.location.reload();
  },
};

export function reloadForAppUpdate(options: UpdateReloadOptions = {}): Promise<UpdateReloadOutcome> {
  return runUpdateReload(editorUpdateReloadDeps, options);
}
