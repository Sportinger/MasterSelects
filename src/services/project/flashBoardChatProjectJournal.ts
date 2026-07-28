import type { FlashBoardChatMessage } from '../../stores/flashboardStore/types';
import { Logger } from '../logger';
import { fileStorageService } from './core/FileStorageService';
import { nativeFileStorageService } from './core/NativeFileStorageService';
import { projectFileService } from './ProjectFileService';
import {
  normalizeFlashBoardChatMessages,
  serializeFlashBoardChatMessage,
} from './flashBoardChatProjectCodec';
import type { ProjectFlashBoardChatMessage } from './types/flashboard.types';

const log = Logger.create('FlashBoardChatJournal');

export const FLASHBOARD_CHAT_JOURNAL_FILE_NAME = 'history.json';
export const FLASHBOARD_CHAT_JOURNAL_AUTOSAVE_FILE_NAME = 'history.autosave.json';

const JOURNAL_VERSION = 1;
const WRITE_ATTEMPTS = 3;

interface FlashBoardChatJournalFile {
  version: 1;
  projectCreatedAt: string;
  updatedAt: string;
  messages: ProjectFlashBoardChatMessage[];
}

type CapturedProjectTarget =
  | {
    backend: 'fsa';
    handle: FileSystemDirectoryHandle;
    projectCreatedAt: string;
  }
  | {
    backend: 'native';
    path: string;
    projectCreatedAt: string;
  };

const fsaWriteQueues = new WeakMap<FileSystemDirectoryHandle, Promise<boolean>>();
const nativeWriteQueues = new Map<string, Promise<boolean>>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureProjectTarget(): CapturedProjectTarget | null {
  const projectData = projectFileService.getProjectData();
  if (!projectData) return null;

  if (projectFileService.activeBackend === 'native') {
    const path = projectFileService.getProjectPath();
    return path
      ? { backend: 'native', path, projectCreatedAt: projectData.createdAt }
      : null;
  }

  const handle = projectFileService.getProjectHandle();
  return handle
    ? { backend: 'fsa', handle, projectCreatedAt: projectData.createdAt }
    : null;
}

async function writeTargetFile(
  target: CapturedProjectTarget,
  fileName: string,
  content: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const written = target.backend === 'native'
      ? await nativeFileStorageService.writeFile(target.path, 'AI_CHAT', fileName, content)
      : await fileStorageService.writeFile(target.handle, 'AI_CHAT', fileName, content);

    if (written) return true;
    if (attempt < WRITE_ATTEMPTS - 1) await wait(100 * (attempt + 1));
  }

  return false;
}

async function persistJournalFile(
  target: CapturedProjectTarget,
  journal: FlashBoardChatJournalFile,
): Promise<boolean> {
  const content = JSON.stringify(journal, null, 2);
  if (await writeTargetFile(target, FLASHBOARD_CHAT_JOURNAL_FILE_NAME, content)) {
    return true;
  }

  const fallbackWritten = await writeTargetFile(
    target,
    FLASHBOARD_CHAT_JOURNAL_AUTOSAVE_FILE_NAME,
    content,
  );
  if (fallbackWritten) {
    log.warn('Primary chat journal write failed; latest chat persisted to autosave journal');
  } else {
    log.error('Failed to persist chat journal in the project folder');
  }
  return fallbackWritten;
}

function enqueueTargetWrite(
  target: CapturedProjectTarget,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  if (target.backend === 'fsa') {
    const previous = fsaWriteQueues.get(target.handle) ?? Promise.resolve(true);
    const next = previous.then(operation, operation);
    fsaWriteQueues.set(target.handle, next);
    return next;
  }

  const previous = nativeWriteQueues.get(target.path) ?? Promise.resolve(true);
  const next = previous.then(operation, operation);
  nativeWriteQueues.set(target.path, next);
  return next;
}

export function persistFlashBoardChatJournal(
  messages: readonly FlashBoardChatMessage[],
): Promise<boolean> {
  const target = captureProjectTarget();
  if (!target) return Promise.resolve(false);

  const journal: FlashBoardChatJournalFile = {
    version: JOURNAL_VERSION,
    projectCreatedAt: target.projectCreatedAt,
    updatedAt: new Date().toISOString(),
    messages: messages.map(serializeFlashBoardChatMessage),
  };

  return enqueueTargetWrite(target, () => persistJournalFile(target, journal));
}

async function readTargetFile(
  target: CapturedProjectTarget,
  fileName: string,
): Promise<string | null> {
  if (target.backend === 'native') {
    return nativeFileStorageService.readFileText(target.path, 'AI_CHAT', fileName);
  }

  const file = await fileStorageService.readFile(target.handle, 'AI_CHAT', fileName);
  return file ? file.text() : null;
}

function parseJournal(
  content: string | null,
  projectCreatedAt: string,
): FlashBoardChatJournalFile | null {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as Partial<FlashBoardChatJournalFile>;
    if (
      parsed.version !== JOURNAL_VERSION
      || parsed.projectCreatedAt !== projectCreatedAt
      || typeof parsed.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.updatedAt))
      || !Array.isArray(parsed.messages)
    ) {
      return null;
    }
    return parsed as FlashBoardChatJournalFile;
  } catch {
    return null;
  }
}

function latestJournal(
  journals: Array<FlashBoardChatJournalFile | null>,
): FlashBoardChatJournalFile | null {
  return journals
    .filter((journal): journal is FlashBoardChatJournalFile => journal !== null)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
    ?? null;
}

export async function readFlashBoardChatJournal(
  projectCreatedAt: string,
): Promise<FlashBoardChatMessage[] | null> {
  const target = captureProjectTarget();
  if (!target || target.projectCreatedAt !== projectCreatedAt) return null;

  const pendingWrite = target.backend === 'fsa'
    ? fsaWriteQueues.get(target.handle)
    : nativeWriteQueues.get(target.path);
  if (pendingWrite) await pendingWrite;

  const [primaryContent, autosaveContent] = await Promise.all([
    readTargetFile(target, FLASHBOARD_CHAT_JOURNAL_FILE_NAME),
    readTargetFile(target, FLASHBOARD_CHAT_JOURNAL_AUTOSAVE_FILE_NAME),
  ]);
  const journal = latestJournal([
    parseJournal(primaryContent, projectCreatedAt),
    parseJournal(autosaveContent, projectCreatedAt),
  ]);

  return journal ? normalizeFlashBoardChatMessages(journal.messages) : null;
}
