// Decides whether an imported or relinked media file is copied into the project
// (Raw/ in the open project's storage: a folder, OPFS or the IndexedDB fallback)
// or stays linked to its original location. Linking is only kept when the link
// itself survives a reload.

import { projectFileService } from '../../projectFileService';
import { captureRepositoryDomainPublication } from '../repository/artifacts/RepositoryDomainPublication';
import { getActiveRepositorySession } from '../repository/lifecycle/editorRepositoryLifecycle';
import { isCopyingUndurableMedia, probeMediaLinkDurability } from './mediaLinkDurability';
import { beginProjectMediaCopy, noteMediaLinkedByChoice, type ProjectMediaCopyTicket } from './projectMediaCopyNotices';

export type ProjectMediaCopyReason =
  /** "Copy media to project folder" is on. */
  | 'setting'
  /** The caller always copies (sequences, downloads, generated media). */
  | 'forced'
  /** Browser-local projects without folder access cannot reopen a picked file. */
  | 'browser-requires-copy'
  /** A File from an <input> or drop without a handle or path lives only for this page. */
  | 'file-without-location'
  /** This browser cannot store the file's handle (WebKit), so the link dies on reload. */
  | 'links-not-durable';

export interface ProjectMediaCopyDecision {
  copy: boolean;
  reason: ProjectMediaCopyReason | null;
  /** True when copying would have been needed but the user chose to keep such media linked. */
  linkedByChoice: boolean;
}

export interface ProjectMediaCopyInput {
  /** The "Copy media to project folder" setting. */
  copySetting: boolean;
  force?: boolean;
  handle?: FileSystemHandle;
  absolutePath?: string;
}

/**
 * Whether the open project can hold media files. Besides named projects this
 * includes the browser recovery project, which is reopened after a reload too.
 */
export function canStoreProjectMedia(): boolean {
  return projectFileService.isProjectOpen()
    || (getActiveRepositorySession() !== null && captureRepositoryDomainPublication() !== null);
}

/** Reasons that only exist because the link would not survive a reload. */
export function isDurabilityCopyReason(reason: ProjectMediaCopyReason | null): boolean {
  return reason === 'browser-requires-copy' || reason === 'file-without-location' || reason === 'links-not-durable';
}

async function durabilityReason(input: ProjectMediaCopyInput): Promise<ProjectMediaCopyReason | null> {
  if (projectFileService.requiresProjectLocalMediaCopies()) return 'browser-requires-copy';
  if (input.absolutePath) return null;
  if (!input.handle) return 'file-without-location';
  return await probeMediaLinkDurability(input.handle) === 'not-durable' ? 'links-not-durable' : null;
}

export async function decideProjectMediaCopy(input: ProjectMediaCopyInput): Promise<ProjectMediaCopyDecision> {
  if (!canStoreProjectMedia()) return { copy: false, reason: null, linkedByChoice: false };
  if (input.force) return { copy: true, reason: 'forced', linkedByChoice: false };
  if (input.copySetting) return { copy: true, reason: 'setting', linkedByChoice: false };
  const reason = await durabilityReason(input);
  if (!reason) return { copy: false, reason: null, linkedByChoice: false };
  if (!isCopyingUndurableMedia()) return { copy: false, reason, linkedByChoice: true };
  return { copy: true, reason, linkedByChoice: false };
}

/** A finished copy whose ticket is still open: the caller settles it once the copy is in use (see runHeldProjectMediaCopy). */
export interface HeldProjectMediaCopy<T> {
  value: T;
  ticket: ProjectMediaCopyTicket;
}

/**
 * Runs one copy into the project and reports it: durability and background copies
 * are announced with their size, every failure is shown. A failed copy resolves to null so the
 * import continues with the linked file instead of being lost.
 */
export async function runProjectMediaCopy<T>(
  file: Pick<File, 'name' | 'size'>,
  decision: ProjectMediaCopyDecision,
  copy: () => Promise<T | null>,
  options: { announce?: boolean } = {},
): Promise<T | null> {
  const held = await runHeldProjectMediaCopy(file, decision, copy, options);
  held?.ticket.done();
  return held?.value ?? null;
}

/**
 * Like runProjectMediaCopy, but a successful copy keeps its ticket open: it still counts as pending (the
 * "Copying into project" status and the unload guard stay on) until the caller settles it, e.g. after the
 * media were switched to the copy and that switch is recorded in the project. A failure is settled here.
 */
export async function runHeldProjectMediaCopy<T>(
  file: Pick<File, 'name' | 'size'>,
  decision: ProjectMediaCopyDecision,
  copy: () => Promise<T | null>,
  options: { announce?: boolean } = {},
): Promise<HeldProjectMediaCopy<T> | null> {
  if (decision.linkedByChoice) noteMediaLinkedByChoice(file.name);
  if (!decision.copy) return null;
  // Background copies are always announced: nobody waits for them, so their progress must be visible.
  const durability = isDurabilityCopyReason(decision.reason);
  const ticket = beginProjectMediaCopy(file, options.announce === true || durability, durability ? 'durability' : 'background');
  try {
    const result = await copy();
    if (result) return { value: result, ticket };
    ticket.fail(new Error('the project storage did not accept it'));
    return null;
  } catch (error) {
    ticket.fail(error);
    return null;
  }
}
