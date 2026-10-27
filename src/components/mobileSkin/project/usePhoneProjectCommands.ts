// Project commands of the phone skin: list, create (with the chosen canvas format), open, rename
// and .msproj import. Everything runs through the editor's existing project lifecycle; every
// failure resolves to { ok: false, message } with a sentence the phone can show as is.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PHONE_PROJECT_FORMATS,
  type PhoneActionResult,
  type PhoneProjectFormatId,
} from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { validateProjectName } from '../../common/projectNameValidation';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { RECENT_PROJECTS_CHANGED_EVENT, projectFileService } from '../../../services/projectFileService';
import {
  createBlankProject,
  openProjectArchive,
  openStoredProject,
  saveCurrentProject,
} from '../../../services/projectSync';
import { isProjectArchiveFileName } from '../../../services/project/browserProjectArchive';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { isBrowserStorageFallbackActive } from '../../../services/project/core/browserStorageRoot';
import { getProjectWriteSupportError, resolveProjectRootMode } from '../../../services/project/core/projectRootAccess';
import { isExpectedArchiveImportRejection } from '../../../services/project/projectBackendAvailability';
import { recentProjectLocation } from '../../../services/project/recentProjectLocation';

const log = Logger.create('PhoneProjectCommands');

/** Frame rate of every new phone project. */
export const PHONE_PROJECT_FRAME_RATE = 30;

export interface PhoneStoredProject {
  name: string;
  lastOpened?: number;
  location?: string;
}

export interface PhoneProjectCommands {
  projects: PhoneStoredProject[];
  refresh(): Promise<void>;
  createProject(name: string, format: PhoneProjectFormatId): Promise<PhoneActionResult>;
  openProject(name: string): Promise<PhoneActionResult>;
  renameProject(name: string): Promise<PhoneActionResult>;
  importArchive(file: File): Promise<PhoneActionResult>;
}

function fail(message: string): PhoneActionResult {
  return { ok: false, message };
}

/** A thrown error becomes a sentence; storage problems (private mode, full disk) are explained. */
export function describePhoneProjectError(action: string, error: unknown, fallback: string): string {
  const storage = describeBrowserStorageFailure(error);
  if (storage) {
    log.warn(`Project ${action} blocked: browser storage is unavailable`, error);
    return `${fallback} ${storage}`;
  }
  log.error(`Project ${action} failed`, error);
  const reason = error instanceof Error ? error.message.trim() : '';
  return reason && reason !== fallback ? `${fallback} ${reason}` : fallback;
}

/** Browser-stored projects, merged with the recents' last-opened time and storage location. */
export async function listPhoneProjects(): Promise<PhoneStoredProject[]> {
  const names = await projectFileService.listStoredProjects();
  const fallbackActive = isBrowserStorageFallbackActive();
  const recents = projectFileService.getRecentProjects().filter((entry) => entry.backend === 'opfs');
  const projects = names.map((name): PhoneStoredProject => {
    const recent = recents.find((entry) => (entry.path ?? entry.name) === name)
      ?? recents.find((entry) => entry.name === name);
    return recent
      ? { name, lastOpened: recent.lastOpenedAt, location: recentProjectLocation(recent, fallbackActive) }
      : { name };
  });
  return projects.toSorted((a, b) => (b.lastOpened ?? -1) - (a.lastOpened ?? -1) || a.name.localeCompare(b.name));
}

/**
 * Creates and opens a blank project whose first composition already has the chosen canvas at 30 fps.
 * The size is part of the project's first revision, so Undo cannot fall back to 1920x1080.
 */
export async function createPhoneProject(name: string, format: PhoneProjectFormatId): Promise<PhoneActionResult> {
  const trimmed = name.trim();
  const invalid = validateProjectName(trimmed);
  if (invalid) return fail(invalid);
  const size = PHONE_PROJECT_FORMATS[format];
  if (!size) return fail(`Unknown canvas format "${format}".`);

  let result: Awaited<ReturnType<typeof createBlankProject>>;
  try {
    result = await createBlankProject(trimmed, {
      composition: { width: size.width, height: size.height, frameRate: PHONE_PROJECT_FRAME_RATE },
    });
  } catch (error) {
    return fail(describePhoneProjectError('creation', error, 'The project could not be created.'));
  }
  if (result === 'not-created') {
    return fail(resolveProjectRootMode() === 'fsa'
      ? 'No project folder was selected.'
      : getProjectWriteSupportError() ?? 'The project could not be created in this browser’s storage.');
  }
  if (result === 'save-failed') {
    return fail('The project was created, but it could not be saved. Check the browser storage and try again.');
  }

  // Resolve the id now: the previous project's composition id is gone.
  const media = useMediaStore.getState();
  const activeId = media.activeCompositionId;
  const active = media.compositions.find((composition) => composition.id === activeId);
  if (!activeId || !active) return fail('The project was created, but it has no composition to set up.');
  if (active.width === size.width && active.height === size.height && active.frameRate === PHONE_PROJECT_FRAME_RATE) {
    log.info('New phone project created', { name: trimmed, format, ...size, frameRate: PHONE_PROJECT_FRAME_RATE });
    return { ok: true };
  }

  // A storage path that ignored the initial size: set it as an ordinary edit and say so in the log.
  log.warn('New project did not take its initial canvas; applying it as an edit', { format, got: { width: active.width, height: active.height } });
  media.updateComposition(activeId, { width: size.width, height: size.height, frameRate: PHONE_PROJECT_FRAME_RATE });
  try {
    if (!await saveCurrentProject({ source: 'manual' })) {
      return { ok: true, message: `"${trimmed}" is open, but its ${format} canvas is not saved yet. Watch the save status.` };
    }
  } catch (error) {
    log.warn('Saving the new phone project format failed', error);
    return { ok: true, message: `"${trimmed}" is open, but its ${format} canvas is not saved yet. Watch the save status.` };
  }
  return { ok: true };
}

export async function openPhoneProject(name: string): Promise<PhoneActionResult> {
  try {
    if (await openStoredProject(name)) return { ok: true };
    return fail(`"${name}" could not be opened.`);
  } catch (error) {
    return fail(describePhoneProjectError('open', error, `"${name}" could not be opened.`));
  }
}

export async function renamePhoneProject(name: string): Promise<PhoneActionResult> {
  const trimmed = name.trim();
  const invalid = validateProjectName(trimmed);
  if (invalid) return fail(invalid);
  const data = projectFileService.getProjectData();
  if (!data) return fail('No project is open.');
  if (data.name === trimmed) return { ok: true };
  try {
    if (await projectFileService.renameProject(trimmed)) {
      // The top bar, export file name and share title read the media store's project name.
      useMediaStore.getState().setProjectName(trimmed);
      return { ok: true, message: `Renamed to "${trimmed}".` };
    }
    return fail(`Could not rename to "${trimmed}". A project with that name may already exist.`);
  } catch (error) {
    return fail(describePhoneProjectError('rename', error, `Could not rename to "${trimmed}".`));
  }
}

export async function importPhoneProjectArchive(file: File): Promise<PhoneActionResult> {
  if (!isProjectArchiveFileName(file.name)) return fail(`"${file.name}" is not a .msproj project archive.`);
  try {
    if (await openProjectArchive(file)) return { ok: true };
    return fail('The project archive could not be opened.');
  } catch (error) {
    if (isExpectedArchiveImportRejection(error)) {
      log.warn('Project archive import rejected', error);
      return fail(`The project archive could not be imported. ${(error as Error).message}`);
    }
    return fail(describePhoneProjectError('archive import', error, 'The project archive could not be imported.'));
  }
}

function reportListFailure(error: unknown): void {
  const message = describePhoneProjectError('list', error, 'The stored projects could not be listed.');
  usePhoneUiStore.getState().showToast(message, 'error');
}

export function usePhoneProjectCommands(): PhoneProjectCommands {
  const [projects, setProjects] = useState<PhoneStoredProject[]>([]);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await listPhoneProjects();
      if (aliveRef.current) setProjects(next);
    } catch (error) {
      reportListFailure(error);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const load = () => {
      listPhoneProjects().then((next) => {
        if (aliveRef.current) setProjects(next);
      }, reportListFailure);
    };
    load();
    window.addEventListener(RECENT_PROJECTS_CHANGED_EVENT, load);
    return () => {
      aliveRef.current = false;
      window.removeEventListener(RECENT_PROJECTS_CHANGED_EVENT, load);
    };
  }, []);

  const afterChange = useCallback(async (result: PhoneActionResult) => {
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  const createProject = useCallback(
    async (name: string, format: PhoneProjectFormatId) => afterChange(await createPhoneProject(name, format)),
    [afterChange],
  );
  const openProject = useCallback(async (name: string) => afterChange(await openPhoneProject(name)), [afterChange]);
  const renameProject = useCallback(async (name: string) => afterChange(await renamePhoneProject(name)), [afterChange]);
  const importArchive = useCallback(async (file: File) => afterChange(await importPhoneProjectArchive(file)), [afterChange]);

  return { projects, refresh, createProject, openProject, renameProject, importArchive };
}
