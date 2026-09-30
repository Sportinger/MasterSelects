// App-wide folder grants for local automation (dev bridge, Claude Code).
// A web page cannot open a disk path by itself: the user picks a folder once
// (File System Access, enforced by the browser). The handle is kept in
// IndexedDB, so afterwards every absolute path below that folder resolves to a
// directory or file handle without another prompt. Chrome's "Allow on every
// visit" keeps the grant across browser restarts.

import { Logger } from './logger';
import { projectDB } from './projectDB';

const log = Logger.create('WorkspaceRoots');
const KEY_PREFIX = 'workspace_root:';

export type WorkspaceAccessMode = 'read' | 'readwrite';

type PermissionDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: WorkspaceAccessMode }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: WorkspaceAccessMode }) => Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: WorkspaceAccessMode }) => Promise<FileSystemDirectoryHandle>;
};

export interface WorkspaceRootState {
  path: string;
  name: string;
  permission: PermissionState;
}

export type WorkspaceAccessErrorCode = 'invalid-path' | 'no-root' | 'permission' | 'not-found';

export class WorkspaceAccessError extends Error {
  readonly code: WorkspaceAccessErrorCode;

  constructor(message: string, code: WorkspaceAccessErrorCode) {
    super(message);
    this.name = 'WorkspaceAccessError';
    this.code = code;
  }
}

/**
 * `d:\Foo\bar\` -> `D:/Foo/bar`, drive roots become `D:`, POSIX paths keep their
 * leading slash. Returns null for relative paths and `.`/`..` segments.
 */
export function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/');
  const drive = /^([a-zA-Z]):(\/.*)?$/.exec(trimmed);
  let prefix: string;
  let rest: string;
  if (drive) {
    prefix = `${drive[1].toUpperCase()}:`;
    rest = drive[2] ?? '';
  } else if (trimmed.startsWith('/')) {
    prefix = '';
    rest = trimmed;
  } else {
    return null;
  }
  const segments = rest.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  if (!prefix && segments.length === 0) return '/';
  return [prefix, ...segments].join('/');
}

function samePathText(left: string, right: string): boolean {
  // Windows paths are case-insensitive; POSIX paths are not.
  return /^[a-z]:/i.test(left) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Longest root containing `path` (both normalized) and the relative segments below it. */
export function matchWorkspaceRoot(
  path: string,
  roots: readonly string[],
): { root: string; segments: string[] } | null {
  let best: string | null = null;
  for (const root of roots) {
    const rootPrefix = root === '/' ? '/' : `${root}/`;
    const inside = samePathText(path, root)
      || samePathText(path.slice(0, rootPrefix.length), rootPrefix);
    if (inside && (!best || root.length > best.length)) best = root;
  }
  if (!best) return null;
  const rest = samePathText(path, best) ? '' : path.slice(best === '/' ? 1 : best.length + 1);
  return { root: best, segments: rest.split('/').filter(Boolean) };
}

export function displayWorkspacePath(path: string): string {
  return /^[A-Z]:$/.test(path) ? `${path}/` : path;
}

async function storedRoots(): Promise<Array<{ path: string; handle: PermissionDirectoryHandle }>> {
  const entries = await projectDB.getAllHandles();
  return entries
    .filter((entry) => entry.key.startsWith(KEY_PREFIX) && entry.handle.kind === 'directory')
    .map((entry) => ({
      path: entry.key.slice(KEY_PREFIX.length),
      handle: entry.handle as PermissionDirectoryHandle,
    }));
}

async function permissionOf(
  handle: PermissionDirectoryHandle,
  mode: WorkspaceAccessMode,
): Promise<PermissionState> {
  try {
    return typeof handle.queryPermission === 'function' ? await handle.queryPermission({ mode }) : 'granted';
  } catch {
    return 'denied';
  }
}

export async function listWorkspaceRoots(mode: WorkspaceAccessMode = 'readwrite'): Promise<WorkspaceRootState[]> {
  const roots = await storedRoots();
  return Promise.all(roots.map(async ({ path, handle }) => ({
    path: displayWorkspacePath(path),
    name: handle.name,
    permission: await permissionOf(handle, mode),
  })));
}

/** Non-throwing lookup: true when `absolutePath` lies below a stored root (any permission state). */
export async function isWorkspacePath(absolutePath: string): Promise<boolean> {
  const normalized = normalizeWorkspacePath(absolutePath);
  if (!normalized) return false;
  try {
    const roots = await storedRoots();
    return matchWorkspaceRoot(normalized, roots.map((root) => root.path)) !== null;
  } catch (error) {
    log.debug('Workspace roots unavailable', error);
    return false;
  }
}

async function resolveSegments(
  absolutePath: string,
  mode: WorkspaceAccessMode,
): Promise<{ root: PermissionDirectoryHandle; segments: string[]; normalized: string }> {
  const normalized = normalizeWorkspacePath(absolutePath);
  if (!normalized) {
    throw new WorkspaceAccessError(`Not an absolute path without "..": ${absolutePath}`, 'invalid-path');
  }
  const roots = await storedRoots();
  const match = matchWorkspaceRoot(normalized, roots.map((root) => root.path));
  if (!match) {
    throw new WorkspaceAccessError(
      `No workspace folder grant covers ${normalized}. Call grantWorkspaceRoot first.`,
      'no-root',
    );
  }
  const root = roots.find((entry) => entry.path === match.root)!.handle;
  const permission = await permissionOf(root, mode);
  if (permission !== 'granted') {
    throw new WorkspaceAccessError(
      `Workspace folder ${displayWorkspacePath(match.root)} needs ${mode} permission again (${permission}). Call grantWorkspaceRoot.`,
      'permission',
    );
  }
  return { root, segments: match.segments, normalized };
}

export async function resolveWorkspaceDirectory(
  absolutePath: string,
  options: { create?: boolean; mode?: WorkspaceAccessMode } = {},
): Promise<FileSystemDirectoryHandle> {
  const { root, segments, normalized } = await resolveSegments(absolutePath, options.mode ?? 'read');
  let directory: FileSystemDirectoryHandle = root;
  try {
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: options.create ?? false });
    }
  } catch (error) {
    throw new WorkspaceAccessError(
      `Folder not found: ${normalized} (${error instanceof Error ? error.message : String(error)})`,
      'not-found',
    );
  }
  return directory;
}

export async function resolveWorkspaceFile(
  absolutePath: string,
  mode: WorkspaceAccessMode = 'read',
): Promise<FileSystemFileHandle> {
  const { root, segments, normalized } = await resolveSegments(absolutePath, mode);
  if (segments.length === 0) throw new WorkspaceAccessError(`${normalized} is a folder, not a file`, 'invalid-path');
  try {
    let directory: FileSystemDirectoryHandle = root;
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    return await directory.getFileHandle(segments.at(-1)!);
  } catch (error) {
    throw new WorkspaceAccessError(
      `File not found: ${normalized} (${error instanceof Error ? error.message : String(error)})`,
      'not-found',
    );
  }
}

// ============================================
// ONE-TIME GRANT (needs a real user click)
// ============================================

let pendingGrant: { path: string; promise: Promise<WorkspaceRootState> } | null = null;

/** Re-reads the module state after an await (a concurrent call may have started a grant). */
function currentPendingGrant(): typeof pendingGrant {
  return pendingGrant;
}

function isDriveRoot(path: string): boolean {
  return /^[A-Z]:$/.test(path);
}

function handleNameMatches(handle: FileSystemDirectoryHandle, path: string): boolean {
  const expected = path.split('/').at(-1) ?? '';
  if (isDriveRoot(path)) {
    // Chromium reports drive roots as "\" (no letter); some builds use "D:\" or "".
    const bare = handle.name.replace(/[\\/]+$/, '');
    return bare === '' || bare.toUpperCase() === path;
  }
  return handle.name.toLowerCase() === expected.toLowerCase();
}

async function persistRoot(normalized: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const key = `${KEY_PREFIX}${normalized}`;
  await projectDB.storeHandle(key, handle);
  // storeHandle swallows DataCloneError; a grant that did not persist is useless.
  if (!await projectDB.getStoredHandle(key)) {
    throw new Error('The browser did not persist the folder handle (IndexedDB)');
  }
  log.info('Workspace root granted', { path: normalized });
}

/**
 * A folder the user already picked elsewhere (project parent, recent project)
 * can serve as root without another click, if its name and contents prove it.
 */
async function findAlreadyGrantedHandle(
  normalized: string,
  mode: WorkspaceAccessMode,
  verifyEntries: readonly string[],
): Promise<FileSystemDirectoryHandle | null> {
  if (verifyEntries.length === 0) return null;
  for (const { key, handle } of await projectDB.getAllHandles()) {
    if (key.startsWith(KEY_PREFIX) || handle.kind !== 'directory') continue;
    const directory = handle as PermissionDirectoryHandle;
    if (!handleNameMatches(directory, normalized)) continue;
    if (await permissionOf(directory, mode) !== 'granted') continue;
    if (await containsEntries(directory, verifyEntries)) return directory;
  }
  return null;
}

async function isReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const entries = (handle as FileSystemDirectoryHandle & { values: () => AsyncIterableIterator<FileSystemHandle> }).values();
    await entries.next();
    return true;
  } catch {
    return false;
  }
}

async function containsEntries(handle: FileSystemDirectoryHandle, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    const found = await handle.getDirectoryHandle(name).then(() => true, () => false)
      || await handle.getFileHandle(name).then(() => true, () => false);
    if (!found) return false;
  }
  return true;
}

function createGrantOverlay(label: string): {
  root: HTMLDivElement;
  grantButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  setMessage: (text: string) => void;
} {
  // Drop overlays orphaned by a hot reload of this module.
  document.querySelectorAll('[data-workspace-root-grant]').forEach((stale) => stale.remove());
  const root = document.createElement('div');
  root.setAttribute('data-workspace-root-grant', '');
  root.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
    'display:flex', 'flex-direction:column', 'gap:8px', 'padding:14px 16px', 'max-width:min(560px,calc(100vw - 32px))',
    'background:#1d2230', 'color:#f2f4f8', 'border:1px solid #4c8dff', 'border-radius:10px',
    'box-shadow:0 10px 40px rgba(0,0,0,.5)', 'font:13px/1.4 system-ui,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;font-size:14px';
  title.textContent = 'Claude braucht einmalig Ordnerzugriff';

  const message = document.createElement('div');
  message.textContent = `Klicke auf den Button und wähle ${label}. Danach kann die Bridge dort Projekte anlegen und Medien importieren.`;

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  const grantButton = document.createElement('button');
  grantButton.type = 'button';
  grantButton.textContent = `Ordner freigeben: ${label}`;
  grantButton.style.cssText = 'padding:6px 12px;border-radius:6px;border:0;background:#4c8dff;color:#fff;font-weight:600;cursor:pointer';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Abbrechen';
  cancelButton.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #59627a;background:transparent;color:inherit;cursor:pointer';
  buttons.append(cancelButton, grantButton);

  root.append(title, message, buttons);
  document.body.append(root);
  return { root, grantButton, cancelButton, setMessage: (text) => { message.textContent = text; } };
}

/**
 * Show an in-app button that lets the user grant `path` (picker on first use,
 * permission re-request for a stored handle). Resolves once access is granted.
 */
export async function requestWorkspaceRootGrant(
  path: string,
  options: { mode?: WorkspaceAccessMode; timeoutMs?: number; verifyEntries?: string[] } = {},
): Promise<WorkspaceRootState> {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) throw new WorkspaceAccessError(`Not an absolute path: ${path}`, 'invalid-path');
  const verifyEntries = (options.verifyEntries ?? []).filter((name) => name && !/[\\/]/.test(name));
  if (pendingGrant) {
    if (samePathText(pendingGrant.path, normalized)) return pendingGrant.promise;
    throw new Error(`Another folder grant is pending: ${displayWorkspacePath(pendingGrant.path)}`);
  }

  const mode = options.mode ?? 'readwrite';
  const label = displayWorkspacePath(normalized);
  // Loaded before the click: the picker must run while the click's user activation is fresh.
  // A handle can report "granted" yet fail every read (e.g. after the drive was reconnected),
  // so it only counts once a real read succeeds; otherwise the user picks the folder again.
  let existing = (await storedRoots()).find((root) => samePathText(root.path, normalized));
  if (existing && !await isReadable(existing.handle)) existing = undefined;
  if (existing && await permissionOf(existing.handle, mode) === 'granted') {
    return { path: label, name: existing.handle.name, permission: 'granted' };
  }
  const adoptable = await findAlreadyGrantedHandle(normalized, mode, verifyEntries);
  if (adoptable) {
    await persistRoot(normalized, adoptable);
    return { path: label, name: adoptable.name, permission: 'granted' };
  }
  if (!existing && isDriveRoot(normalized) && verifyEntries.length === 0) {
    // The picked handle cannot tell D:\ from C:\, so its contents must prove it.
    throw new WorkspaceAccessError(
      `Granting drive root ${label} needs verifyEntries: names that exist directly in ${label}.`,
      'invalid-path',
    );
  }
  const concurrentGrant = currentPendingGrant();
  if (concurrentGrant) return concurrentGrant.promise;

  const promise = new Promise<WorkspaceRootState>((resolve, reject) => {
    const overlay = createGrantOverlay(label);
    const timer = window.setTimeout(() => finish(new Error('Timed out waiting for the folder grant')), options.timeoutMs ?? 300000);

    function finish(result: WorkspaceRootState | Error): void {
      window.clearTimeout(timer);
      overlay.root.remove();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    overlay.cancelButton.addEventListener('click', () => finish(new Error('The user cancelled the folder grant')));
    overlay.grantButton.addEventListener('click', async () => {
      try {
        let handle: PermissionDirectoryHandle;
        if (existing && typeof existing.handle.requestPermission === 'function') {
          if (await existing.handle.requestPermission({ mode }) !== 'granted') {
            overlay.setMessage('Zugriff wurde nicht erlaubt. Bitte erneut klicken und "Erlauben" wählen.');
            return;
          }
          handle = existing.handle;
        } else {
          const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
          if (!picker) throw new Error('This browser has no folder picker (File System Access API)');
          handle = await picker({ id: 'ms-workspace-root', mode }) as PermissionDirectoryHandle;
          if (!handleNameMatches(handle, normalized)
            || (verifyEntries.length > 0 && !await containsEntries(handle, verifyEntries))) {
            overlay.setMessage(`Der gewählte Ordner ("${handle.name}") ist nicht ${label}. Bitte genau diesen Ordner wählen.`);
            return;
          }
          if (await permissionOf(handle, mode) !== 'granted' && handle.requestPermission) {
            await handle.requestPermission({ mode });
          }
        }
        await persistRoot(normalized, handle);
        finish({ path: label, name: handle.name, permission: await permissionOf(handle, mode) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          overlay.setMessage('Auswahl abgebrochen. Bitte erneut klicken und den Ordner wählen.');
          return;
        }
        if (error instanceof Error && /already active/i.test(error.message)) {
          overlay.setMessage('Es ist noch ein anderer Datei-/Ordner-Dialog offen. Bitte diesen schließen und dann erneut klicken.');
          return;
        }
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }).finally(() => {
    pendingGrant = null;
  });

  pendingGrant = { path: normalized, promise };
  return promise;
}

export async function removeWorkspaceRoot(path: string): Promise<boolean> {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return false;
  const existing = (await storedRoots()).find((root) => samePathText(root.path, normalized));
  if (!existing) return false;
  await projectDB.deleteHandle(`${KEY_PREFIX}${existing.path}`);
  return true;
}
