// Waveform pyramids computed while this tab may not write project artifacts.
//
// A read-only tab (another tab owns the project) and a project whose folder access the browser
// paused cannot store artifacts. The pyramid is still computed and kept in memory, so the
// timeline shows the detailed waveform, and it is saved once writing is possible again:
// after "Take over editing" or "Re-allow". Clips that point at the in-memory artifact are then
// moved to the saved one. Runtime-only state: pyramids and handles never enter stores.
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../artifacts';
import { isEditRejection } from '../../editRejection';
import { Logger } from '../../logger';
import {
  getFolderAccessPause,
  isFolderAccessLossError,
  subscribeFolderAccessPause,
} from '../../project/folderAccess/folderAccessPause';
import { getEditorRepositorySession } from '../../project/repository/transaction/editorMutationRuntime';
import {
  isEditorRepositoryWritable,
  subscribeEditorWriteAvailability,
} from '../../project/repository/transaction/editorWriteAvailability';
import { AudioArtifactStore } from '../AudioArtifactStore';
import type { WaveformPyramidStoreRequest } from '../WaveformPyramidGenerator';

const log = Logger.create('TimelineWaveformPyramid');

/** Bounded: each entry holds a full pyramid until it can be saved. */
const MAX_DEFERRED_PYRAMIDS = 32;

export type PyramidStorageMode = 'persist' | 'memory';

/** Where a new pyramid can go right now: the project store, or memory until writing resumes. */
export function currentPyramidStorageMode(): PyramidStorageMode {
  if (!getEditorRepositorySession()) return 'persist';
  if (!isEditorRepositoryWritable()) return 'memory';
  return getFolderAccessPause().project ? 'memory' : 'persist';
}

/** Read-only tab or paused folder access: storage refused for now, not a broken pyramid. */
export function isTransientArtifactStorageError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (isEditRejection(current)) return true;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return isFolderAccessLossError(error);
}

export function createMemoryAudioArtifactStore(): AudioArtifactStore {
  return new AudioArtifactStore(new ArtifactStore(new MemoryArtifactStorageAdapter()));
}

export interface DeferredPyramid {
  /** Artifact id clips reference while the pyramid only exists in memory. */
  memoryRef: string;
  request: WaveformPyramidStoreRequest;
}

/** Saves one pyramid to the project store; returns the artifact id clips should reference. */
export type PersistDeferredPyramid = (request: WaveformPyramidStoreRequest) => Promise<string>;
export type DeferredPyramidRefListener = (memoryRef: string, persistedRef: string) => void;

interface Entry extends DeferredPyramid { repositoryId: string | null; }

interface DeferredPyramidRuntime {
  entries: Map<string, Entry>;
  listeners: Set<DeferredPyramidRefListener>;
  stopWatching: (() => void) | null;
  flushing: Promise<number> | null;
  persist: PersistDeferredPyramid | null;
}

const runtime: DeferredPyramidRuntime = (import.meta.hot?.data?.deferredPyramids as DeferredPyramidRuntime | undefined)
  ?? { entries: new Map(), listeners: new Set(), stopWatching: null, flushing: null, persist: null };
if (import.meta.hot) import.meta.hot.dispose(data => { data.deferredPyramids = runtime; });

function currentRepositoryId(): string | null {
  return getEditorRepositorySession()?.descriptor.repositoryId ?? null;
}

/** Installs the saver; kept injectable so this module does not import the generator stack. */
export function setDeferredPyramidPersister(persist: PersistDeferredPyramid | null): void {
  runtime.persist = persist;
}

export function onDeferredPyramidPersisted(listener: DeferredPyramidRefListener): () => void {
  runtime.listeners.add(listener);
  return () => { runtime.listeners.delete(listener); };
}

function syncWatch(): void {
  if (runtime.entries.size === 0) {
    runtime.stopWatching?.();
    runtime.stopWatching = null;
    return;
  }
  if (runtime.stopWatching) return;
  const check = () => {
    if (runtime.entries.size > 0 && currentPyramidStorageMode() === 'persist') void flushDeferredPyramids();
  };
  const stopWrite = subscribeEditorWriteAvailability(check);
  const stopPause = subscribeFolderAccessPause(check);
  runtime.stopWatching = () => { stopWrite(); stopPause(); };
}

/** Keeps a memory-only pyramid until the project can store it again. */
export function rememberDeferredPyramid(pyramid: DeferredPyramid): void {
  runtime.entries.delete(pyramid.memoryRef);
  runtime.entries.set(pyramid.memoryRef, { ...pyramid, repositoryId: currentRepositoryId() });
  while (runtime.entries.size > MAX_DEFERRED_PYRAMIDS) {
    const oldest = runtime.entries.keys().next().value!;
    runtime.entries.delete(oldest);
    log.info('Dropped the oldest unsaved waveform pyramid; it is regenerated when needed', { memoryRef: oldest });
  }
  syncWatch();
}

export function getDeferredPyramidCount(): number {
  return runtime.entries.size;
}

/**
 * Saves every waiting pyramid of the open project and moves clip refs to the saved artifacts.
 * Pyramids of another project are dropped. Returns the number saved.
 */
export function flushDeferredPyramids(): Promise<number> {
  runtime.flushing ??= flush().finally(() => { runtime.flushing = null; syncWatch(); });
  return runtime.flushing;
}

async function flush(): Promise<number> {
  const persist = runtime.persist;
  if (!persist || currentPyramidStorageMode() !== 'persist') return 0;
  const repositoryId = currentRepositoryId();
  let saved = 0;
  for (const entry of [...runtime.entries.values()]) {
    if (runtime.entries.get(entry.memoryRef) !== entry) continue;
    if (entry.repositoryId !== repositoryId) {
      runtime.entries.delete(entry.memoryRef);
      log.debug('Dropped an unsaved waveform pyramid of another project', { memoryRef: entry.memoryRef });
      continue;
    }
    try {
      const persistedRef = await persist(entry.request);
      runtime.entries.delete(entry.memoryRef);
      saved += 1;
      for (const listener of runtime.listeners) {
        try { listener(entry.memoryRef, persistedRef); }
        catch (error) { log.warn('Could not move clips to the saved waveform pyramid', error); }
      }
    } catch (error) {
      if (isTransientArtifactStorageError(error)) {
        log.debug('Waveform pyramid storage is still paused; keeping it in memory', { memoryRef: entry.memoryRef });
        break;
      }
      runtime.entries.delete(entry.memoryRef);
      log.warn('Saving a waveform pyramid kept in memory failed; it is regenerated when needed', error);
    }
  }
  if (saved > 0) log.info('Saved waveform pyramids that were kept in memory while storage was unavailable', { saved });
  return saved;
}

export function resetDeferredPyramidsForTest(): void {
  runtime.entries.clear();
  runtime.listeners.clear();
  runtime.stopWatching?.();
  runtime.stopWatching = null;
  runtime.flushing = null;
  runtime.persist = null;
}
