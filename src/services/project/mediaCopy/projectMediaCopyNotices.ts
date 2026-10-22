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
}

export interface ProjectMediaCopyNotice {
  /** Changes whenever a new batch starts after the previous one was dismissed. */
  batch: number;
  pendingFiles: number;
  pendingBytes: number;
  copiedFiles: number;
  copiedBytes: number;
  /** Files kept linked by the user's choice although the link will not survive a reload. */
  linkedFiles: number;
  failures: readonly ProjectMediaCopyFailure[];
}

export interface ProjectMediaCopyTicket {
  done(): void;
  fail(error: unknown): void;
}

let notice: ProjectMediaCopyNotice | null = null;
let batch = 0;
const listeners = new Set<() => void>();

function update(change: (current: ProjectMediaCopyNotice) => ProjectMediaCopyNotice): void {
  const current = notice ?? {
    batch: ++batch, pendingFiles: 0, pendingBytes: 0, copiedFiles: 0, copiedBytes: 0, linkedFiles: 0, failures: [],
  };
  notice = change(current);
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
export function beginProjectMediaCopy(file: Pick<File, 'name' | 'size'>, announce = true): ProjectMediaCopyTicket {
  const bytes = file.size;
  const pending = announce ? 1 : 0;
  if (announce) update(current => ({ ...current, pendingFiles: current.pendingFiles + 1, pendingBytes: current.pendingBytes + bytes }));
  let settled = false;
  const settle = (change: (current: ProjectMediaCopyNotice) => ProjectMediaCopyNotice) => {
    if (settled) return;
    settled = true;
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
  };
}

/** Records media kept linked by choice although their link does not survive a reload. */
export function noteMediaLinkedByChoice(name: string): void {
  log.info('Imported media stay linked by choice and must be picked again after a reload', { name });
  update(current => ({ ...current, linkedFiles: current.linkedFiles + 1 }));
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
