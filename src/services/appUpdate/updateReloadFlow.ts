// The order of a reload into a new version, free of editor imports so it can be tested on its own
// (reloadForAppUpdate.ts wires it to the editor). Nothing that lives only in this page may be lost:
// a running export is never interrupted (the person decides to wait for it), media copies into the
// project finish first, then the project is saved; only a successful save lets the page reload.

export type UpdateReloadOutcome =
  | { status: 'reloading' }
  /** An export runs and the caller did not ask to wait for it: ask the person. */
  | { status: 'export-running' }
  | { status: 'save-failed'; message: string }
  | { status: 'cancelled' };

export type SaveWorkResult = { ok: true } | { ok: false; message: string };

export interface UpdateReloadDeps {
  isExporting(): boolean;
  subscribeExporting(listener: () => void): () => void;
  hasPendingMediaCopies(): boolean;
  subscribeMediaCopies(listener: () => void): () => void;
  /** Writes every pending project change; resolves only when it is durable. */
  saveWork(): Promise<SaveWorkResult>;
  /** Makes sure the reload fetches the new page instead of a cached one. */
  bypassPageCache(): Promise<void>;
  reload(): void;
}

export interface UpdateReloadOptions {
  /** The person chose to update after the running export; wait for it instead of asking. */
  waitForExport?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Work that starts during the save (a new copy, an export) is waited for again, a few times at most. */
const MAX_SAVE_ROUNDS = 3;

class ReloadCancelled extends Error {}

function waitUntil(done: () => boolean, subscribe: (listener: () => void) => () => void, signal?: AbortSignal): Promise<void> {
  if (done()) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new ReloadCancelled());
  return new Promise((resolve, reject) => {
    const cleanup = () => { unsubscribe(); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(new ReloadCancelled()); };
    const unsubscribe = subscribe(() => {
      if (!done()) return;
      cleanup();
      resolve();
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runUpdateReload(deps: UpdateReloadDeps, options: UpdateReloadOptions = {}): Promise<UpdateReloadOutcome> {
  const { signal, onProgress } = options;
  const exportBlocks = () => deps.isExporting() && !options.waitForExport;
  try {
    for (let round = 0; round < MAX_SAVE_ROUNDS; round += 1) {
      if (exportBlocks()) return { status: 'export-running' };
      if (deps.isExporting()) {
        onProgress?.('Waiting for the export to finish…');
        await waitUntil(() => !deps.isExporting(), deps.subscribeExporting, signal);
      }
      if (deps.hasPendingMediaCopies()) {
        onProgress?.('Finishing media copies into the project…');
        await waitUntil(() => !deps.hasPendingMediaCopies(), deps.subscribeMediaCopies, signal);
      }
      if (signal?.aborted) return { status: 'cancelled' };
      onProgress?.('Saving the project…');
      const saved = await deps.saveWork();
      if (!saved.ok) return { status: 'save-failed', message: saved.message };
      if (signal?.aborted) return { status: 'cancelled' };
      if (deps.isExporting() || deps.hasPendingMediaCopies()) continue;
      onProgress?.('Loading the new version…');
      await deps.bypassPageCache();
      if (signal?.aborted) return { status: 'cancelled' };
      deps.reload();
      return { status: 'reloading' };
    }
    return { status: 'save-failed', message: 'New work kept starting while saving, so the app did not reload. Try again.' };
  } catch (error) {
    if (error instanceof ReloadCancelled) return { status: 'cancelled' };
    throw error;
  }
}
