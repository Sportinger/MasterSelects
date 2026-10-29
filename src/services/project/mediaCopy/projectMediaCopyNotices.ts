// Runtime feed for the notice that tells the user when imported media are copied
// into the project because their link would not survive a reload, how much was
// copied, and when a copy failed. A failed copy leaves media usable only until
// the next reload, so it is never only logged.

import { Logger } from '../../logger';

const log = Logger.create('ProjectMediaCopy');

export interface ProjectMediaCopyFailure {
  name: string;
  bytes: number;
  message: string;
  /** The copy was still running when the page closed (found on reopen): the media must be picked again. */
  interrupted?: true;
}

export interface ProjectMediaCopyNotice {
  /** Changes whenever a new batch starts after the previous one was dismissed. */
  batch: number;
  pendingFiles: number;
  pendingBytes: number;
  /**
   * Of pendingBytes, how far the running copies got: each copy reads its file twice in the storage worker
   * (content hash, then the write), so a file counts half when hashed and whole when written. An estimate
   * for progress displays (project switch wait), never a durability statement.
   */
  pendingDoneBytes: number;
  copiedFiles: number;
  copiedBytes: number;
  /** Files kept linked by the user's choice although the link will not survive a reload. */
  linkedFiles: number;
  /**
   * Announced copies that only exist because a link would not survive a reload (the user may choose to
   * link such files instead). The rest are background copies the caller always makes (phone imports).
   */
  durabilityFiles: number;
  failures: readonly ProjectMediaCopyFailure[];
}

export interface ProjectMediaCopyTicket {
  done(): void;
  fail(error: unknown): void;
  /**
   * The copy finished but no media use it (its import failed or was replaced meanwhile): no longer pending,
   * not counted as copied, and the reason is logged. The file stays in the project's Raw folder, because a
   * copy can be the same stored file another media already use (identical bytes are never stored twice).
   */
  unused(reason: string): void;
}

let notice: ProjectMediaCopyNotice | null = null;
let batch = 0;
const listeners = new Set<() => void>();

/** An announced copy that has not settled yet. */
interface PendingCopy {
  file: Pick<File, 'name' | 'size'>;
  /** Ends the copy's ticket as interrupted (see abandonPendingProjectMediaCopies). */
  abandon(message: string): void;
}
const pendingCopies = new Set<PendingCopy>();
/** Bytes the storage worker read of each copied file, per pass (see noteProjectMediaCopyBytes). */
const readProgress = new WeakMap<object, { hash: number; write: number }>();

function doneBytesOf(file: Pick<File, 'name' | 'size'>): number {
  const read = readProgress.get(file);
  if (!read || file.size <= 0) return 0;
  return (Math.min(file.size, read.hash) + Math.min(file.size, read.write)) / 2;
}

function pendingDoneBytes(): number {
  let done = 0;
  for (const copy of pendingCopies) done += doneBytesOf(copy.file);
  return Math.round(done);
}

function update(change: (current: ProjectMediaCopyNotice) => ProjectMediaCopyNotice): void {
  const current = notice ?? {
    batch: ++batch, pendingFiles: 0, pendingBytes: 0, pendingDoneBytes: 0, copiedFiles: 0, copiedBytes: 0, linkedFiles: 0, durabilityFiles: 0, failures: [],
  };
  notice = { ...change(current), pendingDoneBytes: pendingDoneBytes() };
  for (const listener of listeners) listener();
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'browser storage is full';
  if (error instanceof Error && error.message) return error.message;
  return 'the project storage refused the file';
}

/**
 * Starts tracking one copy into the project; exactly one of done/fail must follow.
 * Unannounced copies (asked for by setting or caller) only surface when they fail.
 */
export function beginProjectMediaCopy(
  file: Pick<File, 'name' | 'size'>,
  announce = true,
  kind: 'durability' | 'background' = 'durability',
): ProjectMediaCopyTicket {
  const bytes = file.size;
  const pending = announce ? 1 : 0;
  if (announce) update(current => ({ ...current, pendingFiles: current.pendingFiles + 1, pendingBytes: current.pendingBytes + bytes,
    durabilityFiles: current.durabilityFiles + (kind === 'durability' ? 1 : 0) }));
  let settled = false;
  const entry: PendingCopy | null = announce ? {
    file,
    abandon: (message) => {
      log.warn('A copy into the project was left unfinished; the media must be picked again', { name: file.name, bytes, message });
      settle(current => ({ ...current, failures: [...current.failures, { name: file.name, bytes, message, interrupted: true }] }));
    },
  } : null;
  if (entry) pendingCopies.add(entry);
  const settle = (change: (current: ProjectMediaCopyNotice) => ProjectMediaCopyNotice) => {
    if (settled) return;
    settled = true;
    if (entry) pendingCopies.delete(entry);
    update(current => change({
      ...current,
      pendingFiles: Math.max(0, current.pendingFiles - pending),
      pendingBytes: Math.max(0, current.pendingBytes - pending * bytes),
    }));
  };
  return {
    done: () => {
      if (!announce) { settled = true; return; }
      settle(current => ({ ...current, copiedFiles: current.copiedFiles + 1, copiedBytes: current.copiedBytes + bytes }));
    },
    fail: (error) => {
      const message = describeError(error);
      log.warn('Imported media could not be copied into the project; it stays linked until the page reloads', { name: file.name, bytes, message });
      settle(current => ({ ...current, failures: [...current.failures, { name: file.name, bytes, message }] }));
    },
    unused: (reason) => {
      log.info('A finished copy into the project is not used by any media', { name: file.name, bytes, reason });
      if (!announce) { settled = true; return; }
      settle(current => current);
    },
  };
}

/** Records media kept linked by choice although their link does not survive a reload. */
export function noteMediaLinkedByChoice(name: string): void {
  log.info('Imported media stay linked by choice and must be picked again after a reload', { name });
  update(current => ({ ...current, linkedFiles: current.linkedFiles + 1 }));
}

/** True while an announced copy into the project is still running (the page must not be left then). */
export function hasPendingProjectMediaCopies(): boolean {
  return (notice?.pendingFiles ?? 0) > 0;
}

/**
 * Bytes the storage worker has read of `blob` in one pass of its copy into the project ('hash' or
 * 'write'). Feeds pendingDoneBytes while `blob` is an announced, still running copy; other blobs are ignored.
 */
export function noteProjectMediaCopyBytes(blob: Blob, pass: 'hash' | 'write', bytes: number): void {
  const read = readProgress.get(blob) ?? { hash: 0, write: 0 };
  if (bytes <= read[pass]) return;
  read[pass] = bytes;
  readProgress.set(blob, read);
  if (notice && [...pendingCopies].some((copy) => (copy.file as object) === blob)) update((current) => current);
}

/**
 * Ends every announced copy that is still running as interrupted, with `message`: the person chose not to
 * wait for it (project switch). Each one is reported in the notice (the media must be picked again); the
 * copy itself may still finish later, but its ticket is settled and changes nothing any more.
 */
export function abandonPendingProjectMediaCopies(message: string): number {
  const abandoned = [...pendingCopies];
  for (const copy of abandoned) copy.abandon(message);
  return abandoned.length;
}

/** Reports media whose copy into the project was still running when the page closed (see pendingProjectCopyMarker). */
export function noteInterruptedProjectMediaCopy(name: string, bytes: number): void {
  log.warn('A copy into the project was interrupted when the page closed; the media must be picked again', { name, bytes });
  update(current => ({ ...current,
    failures: [...current.failures, { name, bytes, message: 'the copy was interrupted when the page closed', interrupted: true }] }));
}

/**
 * True for a finished notice that holds only background copies that all succeeded (phone imports): the
 * copy is part of every import, so its success needs no message, and a lingering "Copied into project"
 * toast would cover the controls a person taps next. Durability copies, linked files and failures still
 * show; a running background copy still shows as "Copying into project".
 */
export function isQuietProjectMediaCopyNotice(current: ProjectMediaCopyNotice | null): boolean {
  return current !== null && current.pendingFiles === 0 && current.failures.length === 0
    && current.durabilityFiles === 0 && current.linkedFiles === 0;
}

export function getProjectMediaCopyNotice(): ProjectMediaCopyNotice | null {
  return notice;
}

export function dismissProjectMediaCopyNotice(): void {
  if (!notice || notice.pendingFiles > 0) return;
  notice = null;
  for (const listener of listeners) listener();
}

export function subscribeProjectMediaCopyNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function formatMediaBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
