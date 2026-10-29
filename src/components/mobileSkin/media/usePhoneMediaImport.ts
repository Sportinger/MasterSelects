// Sequential phone import through the media store's own importFile, always asking for a copy into
// the project so the project reopens after a reload. The copy runs in the background (the clips are
// placed first, the "Copying into project" toast shows it, the media switch to the copy when it is
// durable). Every file whose copy failed or that stays only linked is reported, never just logged.

import { useCallback, useEffect, useState } from 'react';
import type { FileImportResult } from '../../../stores/mediaStore/types';
import { useMediaStore } from '../../../stores/mediaStore';
import { Logger } from '../../../services/logger';
import {
  getProjectMediaCopyNotice,
  subscribeProjectMediaCopyNotice,
  type ProjectMediaCopyNotice,
} from '../../../services/project/mediaCopy/projectMediaCopyNotices';

const log = Logger.create('PhoneMediaImport');

export interface PhoneImportedMedia {
  name: string;
  result: FileImportResult;
  /** True when the media were copied into (or already live in) durable project storage. */
  durable: boolean;
}

export interface PhoneImportProblem {
  name: string;
  message: string;
}

export interface PhoneMediaImportOutcome {
  /** Successfully imported media, in pick order. */
  imported: PhoneImportedMedia[];
  /** Files that could not be imported at all. */
  failures: PhoneImportProblem[];
  /** Imported, but only usable until the page reloads (copy failed or only linked). */
  notDurable: PhoneImportProblem[];
}

export interface PhoneMediaImportProgress {
  /** 0-based index of the file being imported. */
  index: number;
  total: number;
  name: string;
}

type ImportFile = (file: File) => Promise<FileImportResult>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function isDurable(result: FileImportResult): boolean {
  if (result.type === 'signal') return true;
  // A copy still running in the background reports its own outcome (status toast; a failure is shown there).
  if ('projectCopy' in result && result.projectCopy === 'copying') return true;
  return Boolean(result.projectPath || result.absolutePath);
}

/** Imports one file after the other (pick order) and classifies every result. */
export async function importPhoneFilesInOrder(
  files: readonly File[],
  onProgress?: (progress: PhoneMediaImportProgress) => void,
  // The copy into the project runs in the background: clips land as soon as metadata and thumbnail are ready.
  importFile: ImportFile = (file) => useMediaStore.getState().importFile(file, undefined, { forceCopyToProject: true, copyInBackground: true }),
): Promise<PhoneMediaImportOutcome> {
  const outcome: PhoneMediaImportOutcome = { imported: [], failures: [], notDurable: [] };
  for (const [index, file] of files.entries()) {
    onProgress?.({ index, total: files.length, name: file.name });
    const failuresBefore = getProjectMediaCopyNotice()?.failures.length ?? 0;
    let result: FileImportResult;
    try {
      result = await importFile(file);
    } catch (error) {
      log.warn('Phone import failed', { name: file.name, error });
      outcome.failures.push({ name: file.name, message: `${file.name} could not be imported: ${errorMessage(error)}.` });
      continue;
    }
    const copyFailure = (getProjectMediaCopyNotice()?.failures ?? [])
      .slice(failuresBefore)
      .find((failure) => failure.name === file.name);
    const durable = !copyFailure && isDurable(result);
    outcome.imported.push({ name: file.name, result, durable });
    if (copyFailure) {
      outcome.notDurable.push({
        name: file.name,
        message: `${file.name} could not be copied into the project (${copyFailure.message}). It works until the page reloads.`,
      });
    } else if (!durable) {
      outcome.notDurable.push({
        name: file.name,
        message: `${file.name} is only linked for this session. Pick it again after reloading.`,
      });
    }
  }
  return outcome;
}

export interface PhoneMediaImport {
  /** Progress of the running import, null when idle. */
  progress: PhoneMediaImportProgress | null;
  /** Live project copy feed (pending/copied bytes, failures) shared with the desktop notice. */
  copyNotice: ProjectMediaCopyNotice | null;
  importFiles(files: readonly File[]): Promise<PhoneMediaImportOutcome>;
}

export function usePhoneMediaImport(): PhoneMediaImport {
  const [progress, setProgress] = useState<PhoneMediaImportProgress | null>(null);
  const [copyNotice, setCopyNotice] = useState<ProjectMediaCopyNotice | null>(getProjectMediaCopyNotice);

  useEffect(() => subscribeProjectMediaCopyNotice(() => setCopyNotice(getProjectMediaCopyNotice())), []);

  const importFiles = useCallback(async (files: readonly File[]) => {
    try {
      return await importPhoneFilesInOrder(files, setProgress);
    } finally {
      setProgress(null);
    }
  }, []);

  return { progress, copyNotice, importFiles };
}
