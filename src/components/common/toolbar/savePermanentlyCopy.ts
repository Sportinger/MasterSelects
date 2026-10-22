// Every visible text of the Save permanently / Keep safe dialog: a plain
// headline, one "why" line, one obvious action, the rest one short line each.

import type { PermanentSaveDestination } from '../../../services/project/permanentSave/permanentSaveOptions';

/** What the dialog is about right now; `safe` once nothing is at risk any more. */
export type SavePermanentlyVariant = 'temporary' | 'not-safe' | 'move' | 'safe';
export type ListedDestination = Exclude<PermanentSaveDestination, 'home-screen'>;
export type NoticeTone = 'success' | 'info' | 'warning';
export interface Notice { text: string; tone: NoticeTone }

export const HEADLINE: Record<SavePermanentlyVariant, string> = {
  temporary: 'This project is only temporary',
  'not-safe': 'This project can get lost',
  move: 'Some projects are still temporary',
  safe: 'Your project is safe',
};

export function whyLine(variant: SavePermanentlyVariant, safariTab: boolean): string | null {
  if (variant === 'temporary') return safariTab ? 'Safari can delete it when this tab closes.' : 'The browser can delete it when this window closes.';
  if (variant === 'not-safe') return 'Safari deletes website data after 7 days without a visit.';
  if (variant === 'move') return 'They are left from an earlier session and can be deleted.';
  return null;
}

/** The one recommended action when it is a single button (not the Home Screen steps). */
export const PRIMARY: Record<ListedDestination, { title: string; line: string }> = {
  folder: { title: 'Save to a folder', line: 'Pick a folder. The project opens from there.' },
  browser: { title: 'Keep in this browser', line: 'Moves it to permanent browser storage.' },
  archive: { title: 'Download project file', line: 'Open it later via Open Project → Import.' },
};

/** The same destinations as secondary entries under "More options". */
export function secondaryOption(destination: ListedDestination, context: { safariTab: boolean; appleMobile: boolean }): { title: string; line: string } {
  if (destination === 'folder') return { title: 'Save to a folder', line: 'The project opens from that folder.' };
  if (destination === 'browser') return {
    title: 'Keep in this browser',
    line: context.safariTab ? 'Safari can still delete it after 7 days.' : 'Moves it to permanent browser storage.',
  };
  return { title: 'Download a backup', line: context.appleMobile ? 'One .msproj file in Files → Downloads.' : 'One .msproj file with the whole project.' };
}

const DECLINED_ADVICE: Partial<Record<PermanentSaveDestination, string>> = {
  'home-screen': 'use the Home Screen app',
  folder: 'save to a folder',
  archive: 'download a backup',
};

export const MESSAGES = {
  folderSaved: (name: string, unsavedChanges?: string): Notice => unsavedChanges
    ? { text: `Saved to the folder. The latest changes are still being saved there (${unsavedChanges}); press Save if it does not finish.`, tone: 'warning' }
    : { text: `Saved. "${name}" is safe in the chosen folder.`, tone: 'success' },
  // Also when the folder was picked but saving there failed: the old project stays as it was.
  folderCancelled: { text: 'Not saved to a folder. Nothing was removed.', tone: 'info' } as Notice,
  browserKeptInSafariTab: { text: 'Kept in this browser. Safari can still delete it: add the Home Screen app.', tone: 'warning' } as Notice,
  browserSaved: (persisted: boolean): Notice => persisted
    ? { text: 'Saved. Your project is safe in this browser.', tone: 'success' }
    // No backup advice: the dialog is in its safe state now and shows no backup button.
    : { text: 'Saved in this browser.', tone: 'success' },
  archiveDownloaded: (file: string, appleMobile: boolean): Notice => ({
    text: `Downloaded "${file}"${appleMobile ? ' to Files → Downloads' : ''}. Open it via Open Project → Import.`, tone: 'success',
  }),
  takeAlongDownloaded: (file: string, appleMobile: boolean): Notice => ({
    text: `Downloaded "${file}"${appleMobile ? ' to Files → Downloads' : ''}. Now do step 2.`, tone: 'success',
  }),
  othersMoved: (count: number): Notice => ({ text: `Moved ${count} project${count === 1 ? '' : 's'}. Open them via Open Project.`, tone: 'success' }),
  persistGranted: { text: 'Done. The browser will keep MasterSelects data.', tone: 'success' } as Notice,
  /** Advises only the destinations this dialog actually offers right now. */
  persistDeclined: (destinations: readonly PermanentSaveDestination[]): Notice => {
    const advice = destinations.flatMap(destination => DECLINED_ADVICE[destination] ?? []);
    const sentence = advice.join(' or ');
    return { text: sentence ? `The browser said no. ${sentence[0].toUpperCase()}${sentence.slice(1)}.` : 'The browser said no.', tone: 'warning' };
  },
};
