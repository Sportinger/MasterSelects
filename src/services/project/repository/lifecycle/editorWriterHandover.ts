import { Logger } from '../../../logger';
import { createWriterHandover, type HandoverChannel, type HandoverMessage, type WriterHandover } from './writerHandover';
import { flushEditorRepository, getActiveRepositorySession, openEditorRepository, repositoryWorkspaceId, subscribeRepositoryLifecycle } from './editorRepositoryLifecycle';

const log = Logger.create('WriterHandover');
const CHANNEL_NAME = 'ms.repository.writer-handover';
const tabId: string = (import.meta.hot?.data?.writerHandoverTabId as string | undefined) ?? crypto.randomUUID();
let handover: WriterHandover | null = null;
let cleanup: (() => void) | null = null;

function broadcastChannel(): HandoverChannel {
  if (typeof BroadcastChannel === 'undefined') {
    log.warn('BroadcastChannel unavailable: a writing tab cannot be asked to hand over; only a free writer lock can be taken');
    return { post() {}, subscribe: () => () => {} };
  }
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const listeners = new Set<(message: HandoverMessage) => void>();
  channel.onmessage = event => { for (const listener of listeners) listener(event.data as HandoverMessage); };
  return {
    post(message) { channel.postMessage(message); },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) channel.close(); };
    },
  };
}

/** Reopens the active project in place; the storage worker acquires the writer lock if it is free. */
async function reopenActiveProject(): Promise<boolean> {
  const session = getActiveRepositorySession();
  if (!session) throw new Error('No project is open in this tab.');
  const { prepareRepositoryOpen } = await import('./repositoryLocations');
  await openEditorRepository(onProgress => prepareRepositoryOpen(session.location, repositoryWorkspaceId, onProgress));
  return getActiveRepositorySession()?.opening.writable === true;
}

async function isWriterLockHeld(repositoryId: string): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || typeof navigator.locks?.query !== 'function') return null;
  const snapshot = await navigator.locks.query();
  return (snapshot.held ?? []).some(lock => lock.name === `ms.repository.writer:${repositoryId}`);
}

export function getEditorWriterHandover(): WriterHandover {
  if (handover) return handover;
  const created = createWriterHandover({
    tabId,
    channel: broadcastChannel(),
    getRepository() {
      const session = getActiveRepositorySession();
      return session ? { repositoryId: session.descriptor.repositoryId, writable: session.opening.writable } : null;
    },
    async releaseWriter() {
      log.info('Another tab requested write access; saving and switching this tab to read-only');
      await flushEditorRepository();
      await reopenActiveProject();
    },
    reopenForWriting: reopenActiveProject,
    isWriterLockHeld,
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    warn: (message, data) => log.warn(message, data),
  });
  const unsubscribe = subscribeRepositoryLifecycle(() => created.refresh());
  handover = created;
  cleanup = () => { unsubscribe(); created.dispose(); if (handover === created) handover = null; cleanup = null; };
  return created;
}

/** Keeps this tab answering handover requests for as long as the editor runs. */
export function installEditorWriterHandover(): () => void {
  getEditorWriterHandover();
  return () => cleanup?.();
}

/**
 * The toolbar action. Folder permission is requested first, while the click
 * still counts as a user gesture; only then is the writing tab asked to hand over.
 */
export async function takeOverEditing(): Promise<boolean> {
  const current = getEditorWriterHandover();
  const session = getActiveRepositorySession();
  if (session?.location.kind === 'fsa') {
    const handle = session.location.handle as FileSystemDirectoryHandle & { requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState> };
    const permission = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as const) : 'denied';
    if (permission !== 'granted') { current.reportFailure('Folder access was not granted, so this tab cannot write the project.'); return false; }
  }
  return current.requestTakeover();
}

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.writerHandoverTabId = tabId; cleanup?.(); });
}
