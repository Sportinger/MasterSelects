// Notices folder access the browser paused while the tab was in the background, before a save fails.
import { getActiveRepositorySession, subscribeRepositoryLifecycle } from '../repository/lifecycle/editorRepositoryLifecycle';
import type { RepositorySession } from '../repository/RepositorySession';
import { checkGrantedLocations, rememberGrantedLocation, resetFolderAccessPause } from './folderAccessPause';

/** Chrome may also withdraw a one-time grant while the tab stays visible but idle. */
const CHECK_INTERVAL_MS = 30_000;

async function rememberProjectFolder(session: RepositorySession | null): Promise<void> {
  if (session?.location.kind !== 'fsa') return;
  const handle = session.location.handle;
  const mode = session.opening.writable ? 'readwrite' : 'read';
  try {
    if (await handle.queryPermission({ mode }) === 'granted') rememberGrantedLocation('project', handle, mode);
  } catch { /* A handle without permission queries cannot lapse. */ }
}

/** Starts watching the open project's folder access; returns the cleanup. */
export function startFolderAccessWatch(): () => void {
  let session = getActiveRepositorySession();
  void rememberProjectFolder(session);
  const unsubscribe = subscribeRepositoryLifecycle(() => {
    const next = getActiveRepositorySession();
    if (next === session) return;
    // Another project (or a reopen) starts with its own locations; a pause of the old one is moot.
    session = next; resetFolderAccessPause(); void rememberProjectFolder(next);
  });
  const check = () => { if (document.visibilityState === 'visible') void checkGrantedLocations(); };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  return () => {
    unsubscribe(); clearInterval(timer);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
  };
}
