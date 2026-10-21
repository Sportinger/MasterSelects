// Imports an exported .msproj archive into browser storage (OPFS).
//
// Firefox and Safari have no folder picker, so an archive exported from
// another browser or computer cannot be opened as a folder. The archive is
// copied into a new browser-storage project folder instead; opening that
// folder then restores a repository archive or converts an older .msproj
// package in place, exactly like a folder holding the same file. The folder
// is named after the project recorded in the archive manifest. Once a
// repository archive is restored, its copy is removed: the folder is then an
// ordinary repository project that reopens without importing again.

import { Logger } from '../logger';
import { RepositoryError } from './repository/contracts';
import { acquireProjectRoot } from './core/projectRootAccess';
import { getActiveRepositorySession } from './repository/lifecycle/editorRepositoryLifecycle';
import { archiveManifestProjectName, probeRepositoryArchiveManifest } from './repository/archive/archiveManifestProbe';
import { readBlobAsArrayBuffer } from '../../importers/fileIdentity';

const log = Logger.create('ProjectArchiveImport');

const ARCHIVE_EXTENSION = '.msproj';
// eslint-disable-next-line no-control-regex -- Storage folder names must not contain control characters.
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_NAME_SUFFIX = 999;
type IterableDirectoryHandle = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

export function isProjectArchiveFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(ARCHIVE_EXTENSION) && fileName.length > ARCHIVE_EXTENSION.length;
}

/** Project folder name for an archive name (project or file name) without extension, safe as a storage path. */
export function archiveProjectName(fileName: string): string {
  const name = fileName.replace(/\.msproj$/i, '')
    .replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\.+$/, '').slice(0, 120).trim();
  return name || 'Imported Project';
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RepositoryError('cancelled', 'Project archive import cancelled');
}

async function entryExists(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await root.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TypeMismatchError') return true; // a file holds the name
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

/** Never imports into an existing project: "Name", then "Name (2)", "Name (3)", … */
export async function uniqueStoredProjectName(root: FileSystemDirectoryHandle, base: string): Promise<string> {
  for (let index = 1; index <= MAX_NAME_SUFFIX; index += 1) {
    const candidate = index === 1 ? base : `${base} (${index})`;
    if (!await entryExists(root, candidate)) return candidate;
  }
  throw new RepositoryError('conflict', 'Too many stored projects share this name. Rename the archive file and try again.');
}

/** The project name recorded in the archive, else the file name (archives written before it was recorded). */
export async function archiveFolderBaseName(file: File): Promise<string> {
  const probe = await probeRepositoryArchiveManifest(file);
  const projectName = archiveManifestProjectName(probe);
  if (projectName) return archiveProjectName(projectName);
  log.info('Naming the imported project after the archive file', {
    file: file.name, reason: probe.kind === 'none' ? probe.reason : 'manifest records no project name',
  });
  return archiveProjectName(file.name);
}

async function removeFolder(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await root.removeEntry(name, { recursive: true });
  } catch (error) {
    log.warn('Could not remove an unfinished archive import from browser storage', { name, error });
  }
}

/**
 * Streams the archive straight from disk into a native OPFS writable, so the
 * browser never materializes the whole file or writes it in small slices.
 * The IndexedDB fallback writable is not a WritableStream; it takes the file
 * as one Blob and stores it in its own large chunks.
 */
async function copyFileInto(file: File, writable: FileSystemWritableFileStream, signal?: AbortSignal): Promise<void> {
  if (typeof WritableStream !== 'undefined' && writable instanceof WritableStream && typeof file.stream === 'function') {
    // pipeTo closes the destination on success and aborts it on failure or cancellation.
    await file.stream().pipeTo(writable, signal ? { signal } : undefined);
    return;
  }
  try {
    throwIfCancelled(signal);
    await writable.write(file);
    throwIfCancelled(signal);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/**
 * Copies the archive into a new browser-storage project folder and returns
 * the folder name to open. A partial copy is removed and reported, never kept.
 */
export async function storeProjectArchiveInBrowser(file: File, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  if (!isProjectArchiveFileName(file.name)) {
    throw new RepositoryError('unsupported', 'Choose a MasterSelects project archive (.msproj file).');
  }
  if (file.size === 0) throw new RepositoryError('corrupt', 'The selected project archive is empty.');
  const started = performance.now(); let copyStarted = started; let copyMs = 0;
  const root = await acquireProjectRoot('opfs', { throwOnFailure: true });
  if (!root) throw new RepositoryError('unsupported', 'This browser does not provide project file storage.');
  const name = await uniqueStoredProjectName(root, await archiveFolderBaseName(file));
  throwIfCancelled(signal);
  const folder = await root.getDirectoryHandle(name, { create: true });
  try {
    const handle = await folder.getFileHandle(name + ARCHIVE_EXTENSION, { create: true });
    if (typeof handle.createWritable !== 'function') {
      throw new RepositoryError('unsupported', 'This browser cannot write project files. Update your browser before importing a project.');
    }
    const writable = await handle.createWritable({ keepExistingData: false });
    copyStarted = performance.now();
    await copyFileInto(file, writable, signal);
    copyMs = performance.now() - copyStarted;
    const copied = await handle.getFile();
    if (copied.size !== file.size) {
      throw new RepositoryError('io', 'The project archive was not completely copied into browser storage. Check the free space and try again.');
    }
  } catch (error) {
    await removeFolder(root, name);
    // pipeTo rejects with the signal's AbortError; callers see one cancellation error type.
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Project archive import cancelled');
    throw error;
  }
  // Timings separate storage setup from the byte copy when an import feels slow.
  log.info('Project archive copied into browser storage', {
    bytes: file.size, setupMs: Math.round(copyStarted - started), copyMs: Math.round(copyMs), totalMs: Math.round(performance.now() - started),
  });
  return name;
}

/** Removes the folder of an import that did not open. An open project is never removed. */
export async function discardStoredProjectArchive(name: string): Promise<void> {
  const session = getActiveRepositorySession();
  if (session?.location.kind === 'opfs' && session.location.path === name) return;
  const root = await acquireProjectRoot('opfs');
  if (root) await removeFolder(root, name);
}

async function readCompletion(imports: FileSystemDirectoryHandle, id: string): Promise<Record<string, unknown> | null> {
  try {
    const marker = await (await (await imports.getDirectoryHandle(id)).getFileHandle('complete.json')).getFile();
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBlobAsArrayBuffer(marker)));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** True when this folder's archive copy was restored completely into the repository beside it. */
async function archiveRestoreCompleted(folder: FileSystemDirectoryHandle, packageName: string): Promise<boolean> {
  let imports: FileSystemDirectoryHandle;
  try {
    imports = await (await folder.getDirectoryHandle('.masterselects')).getDirectoryHandle('imports');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
  for await (const entry of (imports as IterableDirectoryHandle).values()) {
    if (entry.kind !== 'directory') continue;
    const completion = await readCompletion(imports, entry.name);
    if (completion?.kind === 'repository-archive' && completion.package === packageName && completion.commit) return true;
  }
  return false;
}

/**
 * After a repository archive opened, its copy in browser storage only doubles the used space and would make
 * the folder look like an unconverted package. It is removed once the restore is recorded as complete; an
 * old-format package stays, because its converted project still reads files from it.
 */
export async function releaseRestoredProjectArchive(name: string): Promise<boolean> {
  const root = await acquireProjectRoot('opfs');
  if (!root) return false;
  const packageName = name + ARCHIVE_EXTENSION;
  try {
    const folder = await root.getDirectoryHandle(name);
    if (!await archiveRestoreCompleted(folder, packageName)) {
      log.info('Archive copy kept: the project still reads it or its restore was not recorded as complete', { name });
      return false;
    }
    await folder.removeEntry(packageName);
    log.info('Removed the restored archive copy from browser storage', { name });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    log.warn('The restored archive copy could not be removed; the project opens normally but uses extra storage', { name, error });
    return false;
  }
}
