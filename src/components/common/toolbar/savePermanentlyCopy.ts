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

export const MESSAGES = {
  folderSaved: (name: string): Notice => ({ text: `Saved. "${name}" is safe in the chosen folder.`, tone: 'success' }),
  folderCancelled: { text: 'No folder chosen. Nothing changed.', tone: 'info' } as Notice,
  browserKeptInSafariTab: { text: 'Kept in this browser. Safari can still delete it: add the Home Screen app.', tone: 'warning' } as Notice,
  browserSaved: (persisted: boolean): Notice => persisted
    ? { text: 'Saved. Your project is safe in this browser.', tone: 'success' }
    : { text: 'Saved in this browser. Download a backup to be extra safe.', tone: 'success' },
  archiveDownloaded: (file: string, appleMobile: boolean): Notice => ({
    text: `Downloaded "${file}"${appleMobile ? ' to Files → Downloads' : ''}. Open it via Open Project → Import.`, tone: 'success',
  }),
  takeAlongDownloaded: (file: string, appleMobile: boolean): Notice => ({
    text: `Downloaded "${file}"${appleMobile ? ' to Files → Downloads' : ''}. Now do step 2.`, tone: 'success',
  }),
  othersMoved: (count: number): Notice => ({ text: `Moved ${count} project${count === 1 ? '' : 's'}. Open them via Open Project.`, tone: 'success' }),
  persistGranted: { text: 'Done. The browser will keep MasterSelects data.', tone: 'success' } as Notice,
  persistDeclined: (safariTab: boolean): Notice => ({
    text: `The browser said no. ${safariTab ? 'Use the Home Screen app' : 'Save to a folder'} or download a backup.`, tone: 'warning',
  }),
};
