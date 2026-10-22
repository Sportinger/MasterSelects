// Folder access paused by the browser while a project is open.
//
// Chrome keeps File System Access grants only for the browsing session unless "Allow on every visit"
// was chosen, and it may withdraw them while a tab stays in the background. The stored handles are
// still the right locations: one click re-allows them. Until then saves stay queued in this tab
// (nothing is lost) and media waiting for access stay "not opened yet" instead of "missing", so the
// relink dialog never appears for this.
//
// Runtime state only: handles live here, never in stores or project data.
import { Logger } from '../../logger';

const log = Logger.create('FolderAccess');

export type FolderAccessPhase = 'idle' | 'resuming';
export interface FolderAccessPauseState {
  /** True while any location this session could read or write now waits for the browser prompt. */
  paused: boolean;
  /** The project folder itself lost access: saves are queued until it is re-allowed. */
  project: boolean;
  /** Media whose saved location waits for access; they stay deferred, not offline. */
  mediaIds: readonly string[];
  phase: FolderAccessPhase;
  /** Why the last Re-allow did not restore everything, for the toolbar tooltip. */
  failure: string | null;
}

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};
interface Witness { handle: FileSystemHandle; mode: 'read' | 'readwrite' }

/** Locations seen with access in this session; a lapse on any of them means the browser paused access. */
const MAX_WITNESSES = 24;

interface PauseRuntime {
  project: boolean;
  media: Set<string>;
  /** Media whose access a Re-allow click could not restore: they fall back to the reconnect dialog. */
  declined: Set<string>;
  witnesses: Map<string, Witness>;
  /** A witness reported a lapse although no read or write failed yet. */
  lapsed: boolean;
  phase: FolderAccessPhase;
  failure: string | null;
  snapshot: FolderAccessPauseState;
  listeners: Set<() => void>;
}

const runtime: PauseRuntime = (import.meta.hot?.data?.folderAccessPause as PauseRuntime | undefined) ?? {
  project: false, media: new Set(), declined: new Set(), witnesses: new Map(), lapsed: false,
  phase: 'idle', failure: null, listeners: new Set(),
  snapshot: { paused: false, project: false, mediaIds: [], phase: 'idle', failure: null },
};

function publish(): void {
  const mediaIds = [...runtime.media];
  const paused = runtime.project || runtime.lapsed || mediaIds.length > 0;
  const previous = runtime.snapshot;
  if (previous.paused === paused && previous.project === runtime.project && previous.phase === runtime.phase
    && previous.failure === runtime.failure && previous.mediaIds.join('\n') === mediaIds.join('\n')) return;
  runtime.snapshot = { paused, project: runtime.project, mediaIds, phase: runtime.phase, failure: runtime.failure };
  for (const listener of runtime.listeners) listener();
}

export const FOLDER_ACCESS_PAUSED_NOTICE = 'Folder access was paused by the browser';

/** Tooltip text for the toolbar state. */
export function describeFolderAccessPause(state: FolderAccessPauseState): string {
  const waiting = state.project ? 'Your changes are kept in this tab and saved as soon as access is allowed again.'
    : 'Nothing is lost; saved locations stay linked.';
  const media = state.mediaIds.length ? ` ${state.mediaIds.length} media ${state.mediaIds.length === 1 ? 'waits' : 'wait'} to open.` : '';
  const failure = state.failure ? ` ${state.failure}` : '';
  return `${FOLDER_ACCESS_PAUSED_NOTICE}. ${waiting}${media} Re-allow asks the browser for the same folders again.${failure}`;
}

export function getFolderAccessPause(): FolderAccessPauseState { return runtime.snapshot; }
export function isFolderAccessPaused(): boolean { return runtime.snapshot.paused; }
export function subscribeFolderAccessPause(listener: () => void): () => void {
  runtime.listeners.add(listener); return () => runtime.listeners.delete(listener);
}

function* errorChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    yield current;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
}

/**
 * True when the browser refused a stored location: a raw NotAllowedError/SecurityError, the storage
 * worker's `access` code, or older relayed text that still names the DOMException.
 */
export function isFolderAccessLossError(error: unknown): boolean {
  for (const entry of errorChain(error)) {
    if (typeof entry === 'string') { if (/\b(NotAllowedError|SecurityError)\b/.test(entry)) return true; continue; }
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, code, message } = entry as { name?: unknown; code?: unknown; message?: unknown };
    if (name === 'NotAllowedError' || name === 'SecurityError') return true;
    if (name === 'RepositoryError' && code === 'access') return true;
    if (typeof message === 'string' && /\b(NotAllowedError|SecurityError)\b/.test(message)) return true;
  }
  return false;
}

/** The project folder refused a read or write: saves stay queued until Re-allow. */
export function reportProjectFolderAccessLoss(error?: unknown): void {
  if (!runtime.project) log.warn('Project folder access was paused by the browser; changes stay queued in this tab', error);
  runtime.project = true; publish();
}

/** Reports a storage failure; returns true when it was the browser pausing folder access. */
export function noteFolderAccessFailure(error: unknown): boolean {
  if (!isFolderAccessLossError(error)) return false;
  reportProjectFolderAccessLoss(error); return true;
}

export function isMediaAccessPaused(mediaId: string): boolean { return runtime.media.has(mediaId); }
/** Whether a failed media open may wait for Re-allow instead of going offline. */
export function canPauseMediaAccess(mediaId: string): boolean { return !runtime.declined.has(mediaId); }
export function pauseMediaAccess(mediaId: string): void {
  if (runtime.media.has(mediaId)) return;
  log.info('Media waits for folder access instead of going offline', { mediaId });
  runtime.media.add(mediaId); publish();
}

/** Remembers a location that was readable (or writable) in this session. */
export function rememberGrantedLocation(key: string, handle: FileSystemHandle | null | undefined, mode: 'read' | 'readwrite' = 'read'): void {
  if (!handle || typeof (handle as PermissionHandle).queryPermission !== 'function') return;
  if (runtime.witnesses.has(key)) { runtime.witnesses.delete(key); runtime.witnesses.set(key, { handle, mode }); return; }
  runtime.witnesses.set(key, { handle, mode });
  if (runtime.witnesses.size > MAX_WITNESSES) {
    const oldest = [...runtime.witnesses.keys()].find(entry => entry !== 'project');
    if (oldest) runtime.witnesses.delete(oldest);
  }
}

async function permissionOf(witness: Witness): Promise<PermissionState> {
  try { return await (witness.handle as PermissionHandle).queryPermission!({ mode: witness.mode }); }
  catch { return 'denied'; }
}

/**
 * Queries the locations this session used. A lapse marks the pause (and the project when its folder
 * lapsed); everything granted again (e.g. via another prompt) clears a lapse without a click.
 * Returns true when access is currently paused.
 */
export async function checkGrantedLocations(): Promise<boolean> {
  let lost = false; let projectLost = false;
  for (const [key, witness] of [...runtime.witnesses]) {
    if (await permissionOf(witness) === 'granted') continue;
    lost = true; if (key === 'project') projectLost = true;
  }
  if (projectLost && !runtime.project) reportProjectFolderAccessLoss();
  if (lost !== runtime.lapsed) {
    if (lost) log.warn('Folder access was paused by the browser while the project was open');
    runtime.lapsed = lost; publish();
  }
  return lost || runtime.project || runtime.media.size > 0;
}

/** True when a location that worked in this session now waits for the prompt. */
export async function hasLapsedGrantedLocation(): Promise<boolean> {
  if (runtime.project || runtime.lapsed) return true;
  for (const witness of runtime.witnesses.values()) if (await permissionOf(witness) !== 'granted') return true;
  return false;
}

/** Locations of this session that wait for the browser prompt, project folder first. */
export async function lapsedGrantedLocations(): Promise<Array<{ key: string; handle: FileSystemHandle; mode: 'read' | 'readwrite' }>> {
  const lapsed: Array<{ key: string; handle: FileSystemHandle; mode: 'read' | 'readwrite' }> = [];
  for (const [key, witness] of runtime.witnesses) if (await permissionOf(witness) !== 'granted') lapsed.push({ key, ...witness });
  return lapsed.toSorted((left, right) => Number(right.key === 'project') - Number(left.key === 'project'));
}

export function setFolderAccessPhase(phase: FolderAccessPhase, failure: string | null = runtime.failure): void {
  runtime.phase = phase; runtime.failure = failure; publish();
}

/** Called after a successful Re-allow of the project folder and its queued saves. */
export function clearProjectFolderAccessPause(): void { runtime.project = false; runtime.lapsed = false; publish(); }

/** Hands the paused media back to their openers; ids that fail again then go to the reconnect dialog. */
export function takePausedMedia(): string[] {
  const ids = [...runtime.media];
  runtime.media.clear();
  for (const id of ids) runtime.declined.add(id);
  publish(); return ids;
}
/** A media opened after Re-allow may pause again on a later lapse. */
export function noteMediaAccessRestored(mediaId: string): void {
  runtime.declined.delete(mediaId);
  if (runtime.media.delete(mediaId)) publish();
}

/** A different project (or none) is open: forget this session's locations and pause. */
export function resetFolderAccessPause(): void {
  runtime.project = false; runtime.lapsed = false; runtime.media.clear(); runtime.declined.clear();
  runtime.witnesses.clear(); runtime.phase = 'idle'; runtime.failure = null; publish();
}

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.folderAccessPause = runtime; });
  import.meta.hot.accept();
}
