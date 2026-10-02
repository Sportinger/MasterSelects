import type { Command, DirEntry } from './protocol';
import type {
  JsonObject,
  NativeFolderPickResult,
  NativeHelperCommandHost,
} from './nativeHelperClientTypes';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

const NATIVE_FILE_REFERENCE_PREFIX = 'native-helper-file://';

export async function getProjectRoot(
  host: NativeHelperCommandHost,
  timeoutMs = 1500,
): Promise<string | null> {
  try {
    const response = await host.fetchWithTimeout(`${host.getHttpBaseUrl()}/project-root`, undefined, timeoutMs);
    if (response.ok) {
      const data = await response.json();
      return data.path || null;
    }
  } catch {
    try {
      const info = await host.getInfo(timeoutMs);
      return info.project_root || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function hasFsCommands(
  host: NativeHelperCommandHost,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const response = await host.fetchWithTimeout(`${host.getHttpBaseUrl()}/project-root`, undefined, timeoutMs);
    if (response.ok) {
      return true;
    }
  } catch {
    // Fall back to the older info-based check below.
  }

  try {
    const info = await host.getInfo(timeoutMs);
    return info.fs_commands === true;
  } catch {
    return false;
  }
}

export async function writeFile(
  host: NativeHelperCommandHost,
  path: string,
  content: string,
  log: Pick<Console, 'error'>,
): Promise<boolean> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'write_file', id, path, data: content, encoding: 'utf8' });
    return response.ok === true;
  } catch (e) {
    log.error('writeFile failed', e);
    return false;
  }
}

export async function writeFileBinary(
  host: NativeHelperCommandHost,
  path: string,
  data: Blob | ArrayBuffer | Uint8Array,
  log: Pick<Console, 'debug' | 'error'>,
): Promise<boolean> {
  try {
    const url = `${host.getHttpBaseUrl()}/upload?path=${encodeURIComponent(path)}`;
    const body = data instanceof Blob ? data : data instanceof ArrayBuffer ? new Blob([data]) : new Blob([data.buffer as ArrayBuffer]);
    const response = await host.fetchWithAuth(url, { method: 'POST', body });
    if (response.ok) {
      return true;
    }
  } catch {
    log.debug('HTTP upload failed, falling back to WebSocket');
  }

  try {
    let bytes: Uint8Array;
    if (data instanceof Blob) {
      bytes = new Uint8Array(await data.arrayBuffer());
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = data;
    }

    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const id = host.nextId();
    const response = await host.send({ cmd: 'write_file', id, path, data: base64, encoding: 'base64' });
    return response.ok === true;
  } catch (e) {
    log.error('writeFileBinary failed', e);
    return false;
  }
}

export async function readFileText(
  host: NativeHelperCommandHost,
  path: string,
  log: Pick<Console, 'debug' | 'error' | 'warn'>,
): Promise<string | null> {
  const buffer = await getDownloadedFile(host, path, log);
  if (!buffer) return null;
  return new TextDecoder().decode(buffer);
}

export async function createDir(
  host: NativeHelperCommandHost,
  path: string,
  recursive = true,
  log: Pick<Console, 'error' | 'warn'>,
): Promise<boolean> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'create_dir', id, path, recursive });
    if (response.ok !== true) {
      log.warn('createDir rejected', {
        path,
        error: getErrorMessage(response, 'Create directory failed'),
      });
    }
    return response.ok === true;
  } catch (e) {
    log.error('createDir failed', e);
    return false;
  }
}

export async function listDir(
  host: NativeHelperCommandHost,
  path: string,
  log: Pick<Console, 'error'>,
): Promise<DirEntry[]> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'list_dir', id, path });
    if (response.ok) {
      return okField<DirEntry[]>(response, 'entries') ?? [];
    }
  } catch (e) {
    log.error('listDir failed', e);
  }
  return [];
}

export async function deleteFile(
  host: NativeHelperCommandHost,
  path: string,
  recursive = false,
  log: Pick<Console, 'error'>,
): Promise<boolean> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'delete', id, path, recursive });
    return response.ok === true;
  } catch (e) {
    log.error('deleteFile failed', e);
    return false;
  }
}

export async function exists(
  host: NativeHelperCommandHost,
  path: string,
  log: Pick<Console, 'error'>,
): Promise<{ exists: boolean; kind: 'file' | 'directory' | 'none' }> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'exists', id, path });
    if (response.ok) {
      return {
        exists: okField<boolean>(response, 'exists') ?? false,
        kind: okField<'file' | 'directory' | 'none'>(response, 'kind') ?? 'none',
      };
    }
  } catch (e) {
    log.error('exists failed', e);
  }
  return { exists: false, kind: 'none' };
}

export async function rename(
  host: NativeHelperCommandHost,
  oldPath: string,
  newPath: string,
  log: Pick<Console, 'error'>,
): Promise<boolean> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'rename', id, old_path: oldPath, new_path: newPath });
    return response.ok === true;
  } catch (e) {
    log.error('rename failed', e);
    return false;
  }
}

export async function pickFolderDetailed(
  host: NativeHelperCommandHost,
  title: string | undefined,
  defaultPath: string | undefined,
  log: Pick<Console, 'error'>,
): Promise<NativeFolderPickResult> {
  const id = host.nextId();
  try {
    const cmd = { cmd: 'pick_folder', id, title, default_path: defaultPath } satisfies JsonObject;
    if (title) cmd.title = title;
    if (defaultPath) cmd.default_path = defaultPath;
    const response = await host.send(cmd as unknown as Command, 5 * 60 * 1000);
    const path = okField<string>(response, 'path');
    if (response.ok && path) {
      return { path, cancelled: false };
    }
    if (response.ok) {
      return { path: null, cancelled: okField<boolean>(response, 'cancelled') !== false };
    }
    return {
      path: null,
      cancelled: false,
      error: getErrorMessage(response, 'Folder picker failed'),
    };
  } catch (e) {
    log.error('pickFolder failed', e);
    return {
      path: null,
      cancelled: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function grantPath(
  host: NativeHelperCommandHost,
  path: string,
  log: Pick<Console, 'error'>,
): Promise<boolean> {
  const id = host.nextId();
  try {
    const response = await host.send({ cmd: 'grant_path', id, path });
    return response.ok === true;
  } catch (e) {
    log.error('grantPath failed', e);
    return false;
  }
}

export function getFileUrl(host: NativeHelperCommandHost, absolutePath: string): string {
  return `${host.getHttpBaseUrl()}/file?path=${encodeURIComponent(absolutePath)}`;
}

export function getFileReferenceUrl(absolutePath: string): string {
  return `${NATIVE_FILE_REFERENCE_PREFIX}${encodeURIComponent(absolutePath)}`;
}

export function parseFileReferenceUrl(url: string | undefined): string | null {
  if (!url?.startsWith(NATIVE_FILE_REFERENCE_PREFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(url.slice(NATIVE_FILE_REFERENCE_PREFIX.length));
  } catch {
    return null;
  }
}

export async function getReferencedFile(
  host: NativeHelperCommandHost,
  url: string,
  fileName: string,
  log: Pick<Console, 'debug' | 'error' | 'warn'>,
): Promise<File | null> {
  const path = parseFileReferenceUrl(url);
  if (!path) {
    return null;
  }

  const fileBuffer = await getDownloadedFile(host, path, log);
  if (!fileBuffer) {
    return null;
  }

  return new File([fileBuffer], fileName || path.split(/[\\/]/).pop() || 'file');
}

export async function getDownloadedFile(
  host: NativeHelperCommandHost,
  path: string,
  log: Pick<Console, 'debug' | 'error' | 'warn'>,
): Promise<ArrayBuffer | null> {
  try {
    log.debug('Fetching file via HTTP:', path);
    const response = await host.fetchWithAuth(`${host.getHttpBaseUrl()}/file?path=${encodeURIComponent(path)}`);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      log.debug('File received via HTTP:', buffer.byteLength + ' bytes');
      return buffer;
    }
  } catch (e) {
    log.warn('HTTP fetch failed, falling back to WebSocket', e);
  }

  const id = host.nextId();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      resolve(null);
    }, 120000);

    host.registerPendingRequest(id, async (response) => {
      clearTimeout(timeout);
      const data = okField<string>(response, 'data');
      if (response.ok && data) {
        try {
          const dataUrl = `data:application/octet-stream;base64,${data}`;
          const fetchResponse = await fetch(dataUrl);
          const buffer = await fetchResponse.arrayBuffer();
          resolve(buffer);
        } catch (e) {
          log.error('Failed to decode base64 data', e);
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    const cmd = {
      cmd: 'get_file',
      id,
      path,
    };

    host.sendRaw(JSON.stringify(cmd)).catch(() => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      resolve(null);
    });
  });
}

/** Bounded repository RPC: never routes through the whole-file legacy fallback. */
export async function repositoryCommand(host: NativeHelperCommandHost, command: Omit<import('./protocol').RepositoryCommand, 'id'>): Promise<import('./protocol').OkResponse> {
  const response = await host.send({ ...command, id: host.nextId() });
  if (response.ok !== true) throw new Error(getErrorMessage(response, 'Native repository command failed'));
  return response;
}
