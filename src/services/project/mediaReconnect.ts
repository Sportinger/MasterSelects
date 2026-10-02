import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { Logger } from '../logger';
import { applyRelinkMatch, mediaNeedsRelink } from './relinkMedia';
import { createRelinkCandidateMapFromHandles, findRelinkMatch, setRelinkHandleSource, type RelinkMatch } from './relink/relinkMatching';
import { getProjectMediaSourceRootStates, requestProjectMediaSourceRootAccess, registerProjectMediaSourceRoot, type ProjectMediaSourceRootState } from './mediaSourceRoots';
import { connectOfflineLinkedMedia } from './repository/transaction/editorLinkedMediaConnection';
import { runEditorBatch } from './repository/transaction/editorMutationRuntime';

const log = Logger.create('MediaReconnect');
type IterableDirectoryHandle = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> };

export interface MediaReconnectProgress { phase: 'access' | 'connect' | 'search' | 'relink'; done: number; total: number; }
export interface MediaReconnectResult { connected: number; relinked: number; missing: number; deniedFolders: string[]; }

export function offlineMediaFiles(): MediaFile[] { return useMediaStore.getState().files.filter(mediaNeedsRelink); }
/** Known media folders whose browser access lapsed (e.g. after a reload); one click restores them. */
export async function mediaFoldersNeedingAccess(): Promise<ProjectMediaSourceRootState[]> {
  return (await getProjectMediaSourceRootStates()).filter(root => root.handle && root.permission !== 'granted');
}

async function collectFolder(root: FileSystemDirectoryHandle, rootId: string, into: Map<string, FileSystemFileHandle>): Promise<void> {
  const visit = async (directory: FileSystemDirectoryHandle, parent: string): Promise<void> => {
    try {
      for await (const entry of (directory as IterableDirectoryHandle).values()) {
        const path = parent ? `${parent}/${entry.name}` : entry.name;
        if (entry.kind === 'file') { setRelinkHandleSource(entry, rootId, path); into.set(`${rootId}:${path.toLowerCase()}`, entry); }
        else await visit(entry, path);
      }
    } catch (error) { log.warn('Skipped unreadable media folder', { path: parent || root.name, error }); }
  };
  await visit(root, '');
}

/**
 * One user click: re-allow known folders, reconnect media whose location is already stored (runtime only,
 * nothing is saved), then search allowed folders for the rest and relink unique matches as one revision.
 * Must start inside the click handler: browser permission prompts need its user activation.
 */
export async function reconnectMedia(onProgress: (progress: MediaReconnectProgress) => void, chosenFolder?: FileSystemDirectoryHandle): Promise<MediaReconnectResult> {
  const deniedFolders: string[] = [];
  const pending = await mediaFoldersNeedingAccess();
  for (const [index, root] of pending.entries()) {
    onProgress({ phase: 'access', done: index, total: pending.length });
    if (!await requestProjectMediaSourceRootAccess(root)) deniedFolders.push(root.name);
  }
  if (chosenFolder) await registerProjectMediaSourceRoot(chosenFolder);

  const connected = await connectOfflineLinkedMedia((done, total) => onProgress({ phase: 'connect', done, total }));
  let missing = offlineMediaFiles();
  if (!missing.length) return { connected, relinked: 0, missing: 0, deniedFolders };

  const roots = (await getProjectMediaSourceRootStates()).filter(root => root.handle && root.permission === 'granted');
  const handles = new Map<string, FileSystemFileHandle>();
  for (const [index, root] of roots.entries()) { onProgress({ phase: 'search', done: index, total: roots.length }); await collectFolder(root.handle!, root.id, handles); }
  const candidates = await createRelinkCandidateMapFromHandles(handles.values());
  const matches = missing.flatMap(file => { const match = findRelinkMatch(file, candidates); return match ? [{ file, match }] : [] as Array<{ file: MediaFile; match: RelinkMatch }>; });
  let relinked = 0;
  if (matches.length) {
    // Hundreds of per-file relinks become one undoable revision and one save.
    await runEditorBatch(`Relink ${matches.length} media`, async () => {
      for (const [index, { file, match }] of matches.entries()) {
        onProgress({ phase: 'relink', done: index, total: matches.length });
        try { if (await applyRelinkMatch(file.id, match, { generateThumbnails: false })) relinked++; }
        catch (error) { log.warn('Could not relink media', { id: file.id, name: file.name, error }); }
      }
    });
  }
  missing = offlineMediaFiles();
  return { connected, relinked, missing: missing.length, deniedFolders };
}
