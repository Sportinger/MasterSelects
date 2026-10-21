/**
 * Writer handover between browser tabs. Exactly one tab holds a repository's
 * writer lock (`ms.repository.writer:<id>`); every other tab opens the project
 * read-only. A read-only tab can ask the writer to hand over: the writer flushes
 * its pending changes, reopens its own project read-only (which releases the
 * lock) and confirms; the requester then reopens the project and acquires the
 * lock. Every step that cannot complete ends in a visible `failed` state.
 *
 * The protocol is transport- and lifecycle-agnostic so it can be unit-tested;
 * `editorWriterHandover.ts` binds it to BroadcastChannel and the editor lifecycle.
 */

export interface HandoverRepository { repositoryId: string; writable: boolean }
export interface WriterInfo { tabId: string; since: number; visible: boolean }
export type HandoverPhase = 'idle' | 'requesting' | 'reopening' | 'releasing' | 'failed';
export interface WriterHandoverState {
  phase: HandoverPhase;
  /** The tab that currently writes this repository, when it answered. */
  writer: WriterInfo | null;
  /** Whether a writer lock is held for the open repository (null: unknown/unsupported). */
  writerLockHeld: boolean | null;
  /** Last outcome the person should see (handover failure, or editing moved away). */
  notice: string | null;
}

export type HandoverMessage =
  | { type: 'who'; repositoryId: string; from: string }
  | { type: 'writer'; repositoryId: string; tabId: string; since: number; visible: boolean }
  | { type: 'release'; repositoryId: string; from: string; requestId: string }
  | { type: 'releasing'; repositoryId: string; requestId: string }
  | { type: 'released'; repositoryId: string; requestId: string }
  | { type: 'refused'; repositoryId: string; requestId: string; reason: string };

export interface HandoverChannel {
  post(message: HandoverMessage): void;
  subscribe(listener: (message: HandoverMessage) => void): () => void;
}

export interface HandoverHost {
  tabId: string;
  channel: HandoverChannel;
  /** The project open in this tab and whether this tab holds its writer. */
  getRepository(): HandoverRepository | null;
  /** Writer side: save pending changes and reopen this tab's project read-only, releasing the lock. */
  releaseWriter(): Promise<void>;
  /** Requester side: reopen the project; resolves whether this tab now writes it. */
  reopenForWriting(): Promise<boolean>;
  /** Whether any tab or worker holds the writer lock; null when the browser cannot tell. */
  isWriterLockHeld(repositoryId: string): Promise<boolean | null>;
  isVisible(): boolean;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  warn?(message: string, data?: unknown): void;
}

/** Time for the writing tab to acknowledge a request before the lock is inspected instead. */
export const HANDOVER_ACK_MS = 2500;
/** Time the writing tab gets to save and release after acknowledging. */
export const HANDOVER_RELEASE_MS = 60_000;

export const HANDOVER_MOVED_NOTICE = 'Editing moved to another tab. This tab saved its changes and is now read-only.';
export const HANDOVER_UNRESPONSIVE = 'The tab that is editing this project did not respond. Switch to it (or close it) and try again.';
export const HANDOVER_STILL_READ_ONLY = 'Editing could not be taken over: another tab still writes this project, or folder access was not granted.';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface WriterHandover {
  getSnapshot(): WriterHandoverState;
  subscribe(listener: () => void): () => void;
  /** Re-evaluate after the open project or its write access changed. */
  refresh(): void;
  /** Ask the writing tab to hand over, then reopen this tab's project for writing. */
  requestTakeover(): Promise<boolean>;
  /** Shows a takeover failure detected before the protocol started (e.g. denied folder access). */
  reportFailure(notice: string): void;
  dispose(): void;
}

export function createWriterHandover(host: HandoverHost): WriterHandover {
  let state: WriterHandoverState = { phase: 'idle', writer: null, writerLockHeld: null, notice: null };
  const listeners = new Set<() => void>();
  let known: string | null = null;
  let writerSince = 0;
  let lockProbe = 0;
  let pending: { requestId: string; repositoryId: string; resolve(outcome: 'releasing' | 'released' | { refused: string } | 'timeout'): void; timer: unknown } | null = null;

  const set = (next: Partial<WriterHandoverState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
  const announce = (repositoryId: string) => host.channel.post({ type: 'writer', repositoryId, tabId: host.tabId, since: writerSince, visible: host.isVisible() });

  const probeLock = (repositoryId: string) => {
    const probe = ++lockProbe;
    host.isWriterLockHeld(repositoryId).then(held => { if (probe === lockProbe) set({ writerLockHeld: held }); },
      () => { if (probe === lockProbe) set({ writerLockHeld: null }); });
  };

  const refresh = () => {
    const repository = host.getRepository();
    const key = repository ? `${repository.repositoryId}:${repository.writable}` : null;
    if (key === known) return;
    known = key;
    if (state.phase === 'failed') state = { ...state, phase: 'idle' };
    if (!repository) { set({ writer: null, writerLockHeld: null, notice: null }); return; }
    if (repository.writable) {
      writerSince = host.now();
      set({ writer: null, writerLockHeld: true, notice: state.phase === 'reopening' ? null : state.notice });
      announce(repository.repositoryId);
      return;
    }
    set({ writer: null, writerLockHeld: null });
    host.channel.post({ type: 'who', repositoryId: repository.repositoryId, from: host.tabId });
    probeLock(repository.repositoryId);
  };

  const waitFor = (requestId: string, repositoryId: string, ms: number) => new Promise<'releasing' | 'released' | { refused: string } | 'timeout'>(resolve => {
    if (pending) host.clearTimeout(pending.timer);
    const timer = host.setTimeout(() => { if (pending?.requestId === requestId) { pending = null; resolve('timeout'); } }, ms);
    pending = { requestId, repositoryId, timer, resolve: outcome => { host.clearTimeout(timer); pending = null; resolve(outcome); } };
  });

  const release = async (repositoryId: string, requestId: string) => {
    host.channel.post({ type: 'releasing', repositoryId, requestId });
    set({ phase: 'releasing' });
    try {
      await host.releaseWriter();
      if (host.getRepository()?.writable) throw new Error('This tab still holds write access after reopening.');
      set({ phase: 'idle', notice: HANDOVER_MOVED_NOTICE });
      host.channel.post({ type: 'released', repositoryId, requestId });
    } catch (error) {
      const reason = message(error);
      host.warn?.('Writer handover refused', { reason });
      set({ phase: 'idle', notice: `Another tab asked to take over editing, but this tab could not hand over: ${reason}` });
      host.channel.post({ type: 'refused', repositoryId, requestId, reason });
    }
    refresh();
  };

  const onMessage = (incoming: HandoverMessage) => {
    const repository = host.getRepository();
    if (!repository || incoming.repositoryId !== repository.repositoryId) return;
    switch (incoming.type) {
      case 'who': if (repository.writable && incoming.from !== host.tabId) announce(repository.repositoryId); return;
      case 'writer': if (!repository.writable && incoming.tabId !== host.tabId) set({ writer: { tabId: incoming.tabId, since: incoming.since, visible: incoming.visible }, writerLockHeld: true }); return;
      case 'release':
        if (incoming.from === host.tabId || !repository.writable || state.phase === 'releasing') return;
        void release(repository.repositoryId, incoming.requestId); return;
      case 'releasing': case 'released':
        if (pending?.requestId === incoming.requestId) pending.resolve(incoming.type); return;
      case 'refused':
        if (pending?.requestId === incoming.requestId) pending.resolve({ refused: incoming.reason }); return;
    }
  };
  const unsubscribe = host.channel.subscribe(onMessage);

  const fail = (notice: string) => { host.warn?.('Writer handover failed', { notice }); set({ phase: 'failed', notice }); return false; };

  async function requestTakeover(): Promise<boolean> {
    const repository = host.getRepository();
    if (!repository || repository.writable) return Boolean(repository?.writable);
    if (state.phase === 'requesting' || state.phase === 'reopening') return false;
    const { repositoryId } = repository;
    const requestId = `${host.tabId}:${host.now()}:${Math.random().toString(36).slice(2)}`;
    set({ phase: 'requesting', notice: null });
    try {
      const acknowledged = waitFor(requestId, repositoryId, HANDOVER_ACK_MS);
      host.channel.post({ type: 'release', repositoryId, from: host.tabId, requestId });
      let outcome = await acknowledged;
      if (outcome === 'releasing') outcome = await waitFor(requestId, repositoryId, HANDOVER_RELEASE_MS);
      if (typeof outcome === 'object') return fail(`The editing tab could not hand over: ${outcome.refused}`);
      if (outcome === 'timeout') {
        // No answer: the writer may already be gone (closed tab). Only a still-held lock is a real conflict.
        if (await host.isWriterLockHeld(repositoryId) === true) return fail(HANDOVER_UNRESPONSIVE);
      }
      set({ phase: 'reopening' });
      const writable = await host.reopenForWriting();
      if (!writable) { refresh(); return fail(HANDOVER_STILL_READ_ONLY); }
      refresh(); set({ phase: 'idle', notice: null });
      return true;
    } catch (error) {
      return fail(`Editing could not be taken over: ${message(error)}`);
    }
  }

  refresh();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    requestTakeover,
    reportFailure: notice => { fail(notice); },
    dispose() { unsubscribe(); listeners.clear(); if (pending) host.clearTimeout(pending.timer); pending = null; },
  };
}
