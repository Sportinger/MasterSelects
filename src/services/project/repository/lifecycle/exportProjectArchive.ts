import { Logger } from '../../../logger';
import type { RepositorySession } from '../RepositorySession';
import type { HistorySelection } from '../archive/archiveManifest';
import { exportRepositoryArchive } from '../archive/archiveTransport';
import { captureRuntimeArchiveSources } from '../archive/runtimeSources';
import { RepositoryError } from '../contracts';
import { backendForLocation } from './repositoryLocations';
import { getActiveRepositorySession, flushEditorRepository } from './editorRepositoryLifecycle';
import { recoverRepository } from '../persistence/recovery';

const log = Logger.create('ProjectArchiveExport');

export interface ProjectArchiveSelection {
  history: HistorySelection; journals: 'none' | 'all'; workspace: boolean; media: 'linked' | 'self-contained';
}
export interface ArchiveOutput { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(error: unknown): Promise<void>; }
function verifiedArchiveOutput(handle: FileSystemFileHandle, writable: FileSystemWritableFileStream, afterClose?: (file: File) => Promise<void>): ArchiveOutput {
  let bytesWritten = 0;
  return {
    async write(chunk) { await writable.write(chunk.slice()); bytesWritten += chunk.byteLength; },
    async close() {
      if (!bytesWritten) throw new RepositoryError('io', 'Archive export produced no data');
      await writable.close();
      const file = await handle.getFile();
      if (file.size !== bytesWritten) throw new RepositoryError('io', 'Archive file was not completely written');
      log.info('Archive destination confirmed', { bytes: file.size });
      await afterClose?.(file);
    },
    abort: error => writable.abort(error),
  };
}
/** Opens the output from the click gesture, then streams the confirmed selected repository. */
export async function pickArchiveOutput(name: string): Promise<ArchiveOutput | null> {
  const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try { handle = await picker({ suggestedName: name + '.msproj', types: [{ description: 'MasterSelects repository archive', accept: { 'application/zip': ['.msproj'] } }] }); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return null; throw error; }
    const writable = await handle.createWritable();
    log.info('Archive destination opened');
    return verifiedArchiveOutput(handle, writable);
  }
  const root = await navigator.storage.getDirectory(); const folder = await root.getDirectoryHandle('archive-downloads', { create: true });
  const entryName = crypto.randomUUID() + '.msproj'; const handle = await folder.getFileHandle(entryName, { create: true });
  const writable = await handle.createWritable();
  log.info('Archive download destination opened');
  return verifiedArchiveOutput(handle, writable, async file => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url; link.download = name + '.msproj'; link.click();
    setTimeout(() => { URL.revokeObjectURL(url); void folder.removeEntry(entryName); }, 60000);
  });
}
export async function exportCurrentProjectArchive(selection: ProjectArchiveSelection, output: ArchiveOutput, signal?: AbortSignal, expectedSession?: RepositorySession): Promise<void> {
  const session = expectedSession ?? getActiveRepositorySession();
  try {
    log.info('Preparing selected project archive');
    if (!session || getActiveRepositorySession() !== session) throw new RepositoryError('ownership', 'Project changed while choosing the archive destination');
    if (session.opening.writable) await flushEditorRepository(); if (getActiveRepositorySession() !== session) throw new RepositoryError('ownership', 'Project changed during archive preparation');
    const source = await backendForLocation(session.location);
    const pin = (await recoverRepository(source, session.descriptor, signal)).head;
    if (!pin) throw new RepositoryError('corrupt', 'No confirmed project revision to export');
    const targetId = crypto.randomUUID(); const staging = await backendForLocation({ kind: 'opfs', path: 'archive-staging/' + targetId });
    const owner = await staging.acquireOwner(targetId, signal);
    if (!owner) throw new RepositoryError('ownership', 'Archive staging target is unavailable');
    try {
      const workspace: Array<{ workspaceId: string; viewKey: string }> = []; const seen = new Set<string>(); let cursor: string | undefined;
      if (selection.workspace) do {
        const page = await source.list('.masterselects/views/', cursor, 128, signal);
        for (const path of page.paths) {
          const match = /^\.masterselects\/views\/([^/]+)\/([^/]+)\/[ab]\.json$/.exec(path);
          if (match && !seen.has(match[1] + '/' + match[2])) { seen.add(match[1] + '/' + match[2]); workspace.push({ workspaceId: decodeURIComponent(match[1]), viewKey: decodeURIComponent(match[2]) }); }
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await exportRepositoryArchive(source, session.descriptor, pin, staging, owner, { history: selection.history,
        journals: selection.journals, workspace, media: selection.media, targetRepositoryId: targetId, signal,
        resolveSources: captureRuntimeArchiveSources(session) }, chunk => output.write(chunk));
      await output.close();
      log.info('Project archive export completed');
    } finally { await owner.release(); }
  } catch (error) { log.error('Project archive export failed', error); await output.abort(error).catch(() => {}); throw error; }
}
