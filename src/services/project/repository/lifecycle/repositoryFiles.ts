import { PROJECT_FOLDERS } from '../../core/constants';
import { RepositoryError } from '../contracts';
import { decodeAggregate } from '../domains/jsonBoundary';
import { captureRepositoryDomainPublication } from '../artifacts/RepositoryDomainPublication';
import { getActiveRepositorySession } from './editorRepositoryLifecycle';
import { StreamHash } from '../segments/streamHash';
type Folder = keyof typeof PROJECT_FOLDERS;

export function repositoryFileNames(folder: Folder): string[] {
  const session = getActiveRepositorySession(); if (!session) return [];
  const entities = session.coordinator.getProjection().entities;
  const names = new Set<string>(); const shadow = new Set<string>(); const prefix = `artifact-file:${folder}:`;
  for (const [key, entity] of entities) {
    if (key.startsWith(prefix)) {
      const name = decodeURIComponent(key.slice(prefix.length)); shadow.add(name);
      if (entity.type === 'repository-artifact-file') names.add(name);
    }
  }
  for (const [key, entity] of entities) if (entity.type === 'legacyFile-aggregate') {
    const value = decodeAggregate(key, entities) as { sourcePath?: string };
    const path = value.sourcePath; const prefix = PROJECT_FOLDERS[folder] + '/';
    if (path?.startsWith(prefix)) { const name = path.slice(prefix.length); if (!shadow.has(name)) names.add(name); }
  }
  return [...names].toSorted();
}

/** Virtual file handles remain runtime-only and bind every read/write to one session host. */
export async function repositoryFileHandle(folder: Folder, name: string, create = false): Promise<FileSystemFileHandle | null> {
  const host = captureRepositoryDomainPublication(); const session = getActiveRepositorySession();
  if (!host || !session) return null;
  if (!create && !await host.readFile(folder, name)) return null;
  const assertCurrent = () => { if (getActiveRepositorySession() !== session) throw new RepositoryError('ownership', 'File operation belongs to a previous project'); };
  return {
    kind: 'file', name: name.split('/').at(-1) ?? name,
    async getFile() { assertCurrent(); const file = await host.readFile(folder, name); if (!file) throw new DOMException('File is missing', 'NotFoundError'); return file; },
    async isSameEntry(other: FileSystemHandle) { return other === this; },
    async queryPermission(options?: { mode?: 'read' | 'readwrite' }) { return options?.mode === 'readwrite' && !session.opening.writable ? 'denied' : 'granted'; },
    async requestPermission(options?: { mode?: 'read' | 'readwrite' }) { return options?.mode === 'readwrite' && !session.opening.writable ? 'denied' : 'granted'; },
    async createWritable(options?: FileSystemCreateWritableOptions) {
      assertCurrent(); if (!session.opening.writable) throw new RepositoryError('ownership', 'Project is read-only');
      const root = await navigator.storage.getDirectory(); const folderHandle = await root.getDirectoryHandle('repository-file-staging', { create: true });
      const temporaryName = crypto.randomUUID(); const temporary = await folderHandle.getFileHandle(temporaryName, { create: true });
      const writer = await temporary.createWritable();
      if (options?.keepExistingData) { const existing = await host.readFile(folder, name); if (existing) await writer.write(existing); }
      const close = writer.close.bind(writer), abort = writer.abort.bind(writer);
      writer.close = async () => {
        try { await close(); assertCurrent(); if (!await host.writeFile(folder, name, await temporary.getFile())) throw new RepositoryError('ownership', 'File publication was rejected'); }
        finally { await folderHandle.removeEntry(temporaryName).catch(() => {}); }
      };
      writer.abort = async reason => { try { await abort(reason); } finally { await folderHandle.removeEntry(temporaryName).catch(() => {}); } };
      return writer;
    },
  } as FileSystemFileHandle;
}
export async function scanRepositoryFiles(folder?: Folder): Promise<Map<string, FileSystemFileHandle>> {
  const files = new Map<string, FileSystemFileHandle>();
  for (const key of folder ? [folder] : Object.keys(PROJECT_FOLDERS) as Folder[]) for (const name of repositoryFileNames(key)) {
    const handle = await repositoryFileHandle(key, name); if (handle) files.set(folder ? name : PROJECT_FOLDERS[key] + '/' + name, handle);
  }
  return files;
}
async function fileHash(file: Blob): Promise<string> {
  const hash = new StreamHash();
  for (let offset = 0; offset < file.size; offset += 256 * 1024) hash.update(new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer()));
  return hash.digest();
}
export async function copyRepositoryRaw(file: File, requestedName = file.name) {
  const host = captureRepositoryDomainPublication(); if (!host) return null;
  let name = requestedName; let existing = await host.readFile('RAW', name); let alreadyExisted = false;
  if (existing) {
    const hash = await fileHash(file);
    if (existing.size === file.size && await fileHash(existing) === hash) alreadyExisted = true;
    else { const dot = requestedName.lastIndexOf('.'); const stem = dot > 0 ? requestedName.slice(0, dot) : requestedName;
      const extension = dot > 0 ? requestedName.slice(dot) : ''; name = `${stem}-${hash.slice(7, 23)}${extension}`;
      existing = await host.readFile('RAW', name);
      if (existing && (existing.size !== file.size || await fileHash(existing) !== hash)) throw new RepositoryError('conflict', 'Raw media name has different immutable bytes');
      alreadyExisted = Boolean(existing);
    }
  }
  if (!alreadyExisted && !await host.writeFile('RAW', name, file)) return null;
  return { handle: await repositoryFileHandle('RAW', name) ?? undefined, relativePath: PROJECT_FOLDERS.RAW + '/' + name, alreadyExisted };
}

export function repositoryDownloadFolder(platform: string): string {
  const folders: Record<string, string> = { youtube: 'YT', tiktok: 'TikTok', instagram: 'Instagram', twitter: 'Twitter', facebook: 'Facebook', reddit: 'Reddit', vimeo: 'Vimeo', twitch: 'Twitch' };
  return folders[platform] ?? 'Other';
}
