// Local file backend plumbing for media tool handlers:
// dev-bridge / Native Helper selection, blob fetching (incl. byte-range
// fallback), MIME guessing, and directory listing.

import type { CallerContext } from '../../policy';
import { Logger } from '../../../logger';
import { fetchWithDevBridgeAuth, hasDevBridgeToken } from '../../../security/devBridgeAuth';
import { NativeHelperClient } from '../../../nativeHelper';

const log = Logger.create('AITool:Media');

type LocalFileBackend = 'devBridge' | 'nativeHelper';

const LOCAL_FILE_RANGE_CHUNK_BYTES = 4 * 1024 * 1024;

const DEFAULT_LOCAL_FILE_EXTENSIONS = [
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.mp3', '.wav', '.aac', '.ogg', '.m4a',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.obj', '.gltf', '.glb',
  '.ply', '.splat', '.ksplat', '.spz', '.sog', '.lcc', '.zip',
  '.csv', '.json', '.txt', '.pdf', '.dxf', '.step', '.stp',
] as const;

const LOCAL_FILE_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.obj': 'model/obj',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream',
  '.splat': 'application/octet-stream',
  '.ksplat': 'application/octet-stream',
  '.spz': 'application/octet-stream',
  '.sog': 'application/octet-stream',
  '.lcc': 'application/octet-stream',
  '.zip': 'application/zip',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.dxf': 'application/dxf',
  '.step': 'application/step',
  '.stp': 'application/step',
};

export function normalizeLocalPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function parseExtensionFilter(extensions?: string): string[] {
  if (!extensions) {
    return [...DEFAULT_LOCAL_FILE_EXTENSIONS];
  }

  return extensions
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean)
    .map(ext => ext.startsWith('.') ? ext : `.${ext}`);
}

function guessMimeTypeFromPath(filePath: string): string {
  const normalizedPath = normalizeLocalPath(filePath).toLowerCase();
  const dotIndex = normalizedPath.lastIndexOf('.');
  if (dotIndex === -1) {
    return 'application/octet-stream';
  }

  return LOCAL_FILE_MIME_TYPES[normalizedPath.slice(dotIndex)] || 'application/octet-stream';
}

function isFetchNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return true;
  }

  return typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    /failed to fetch/i.test((error as { message: string }).message);
}

function parseContentRangeTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

async function readLocalFileResponseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({ error: response.statusText }));
  return new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
}

function createLocalFileRequestUrl(normalizedPath: string): string {
  return `/api/local-file?path=${encodeURIComponent(normalizedPath)}`;
}

async function fetchLocalFileDevBridgeResponse(
  normalizedPath: string,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithDevBridgeAuth(createLocalFileRequestUrl(normalizedPath), init);
}

async function fetchLocalFileBlobInRanges(
  normalizedPath: string,
  originalError: unknown,
): Promise<Blob> {
  const mimeType = guessMimeTypeFromPath(normalizedPath);
  const firstResponse = await fetchLocalFileDevBridgeResponse(normalizedPath, {
    headers: { Range: 'bytes=0-0' },
  });

  if (!firstResponse.ok) {
    throw await readLocalFileResponseError(firstResponse);
  }

  if (firstResponse.status !== 206) {
    return firstResponse.blob();
  }

  const totalBytes = parseContentRangeTotal(firstResponse.headers.get('Content-Range'));
  if (totalBytes === null) {
    throw originalError instanceof Error ? originalError : new Error('Failed to fetch local file');
  }

  const parts: ArrayBuffer[] = [await firstResponse.arrayBuffer()];
  let offset = parts[0]?.byteLength ?? 0;

  while (offset < totalBytes) {
    const end = Math.min(totalBytes - 1, offset + LOCAL_FILE_RANGE_CHUNK_BYTES - 1);
    const response = await fetchLocalFileDevBridgeResponse(normalizedPath, {
      headers: { Range: `bytes=${offset}-${end}` },
    });

    if (!response.ok) {
      throw await readLocalFileResponseError(response);
    }

    const chunk = await response.arrayBuffer();
    if (chunk.byteLength <= 0) {
      throw new Error(`Empty local-file range response at byte ${offset}`);
    }

    parts.push(chunk);
    offset += chunk.byteLength;
  }

  return new Blob(parts, {
    type: firstResponse.headers.get('Content-Type') || mimeType,
  });
}

function getLocalFileBackend(callerContext: CallerContext): LocalFileBackend | null {
  const devBridgeAvailable = hasDevBridgeToken();
  const nativeHelperAvailable = NativeHelperClient.isConnected();

  if (callerContext === 'devBridge' && devBridgeAvailable) {
    return 'devBridge';
  }

  if (devBridgeAvailable) {
    return 'devBridge';
  }

  if (nativeHelperAvailable) {
    return 'nativeHelper';
  }

  return null;
}

export async function fetchLocalFileBlob(filePath: string, callerContext: CallerContext): Promise<Blob> {
  const normalizedPath = normalizeLocalPath(filePath);
  const backend = getLocalFileBackend(callerContext);

  if (backend === 'devBridge') {
    try {
      const response = await fetchLocalFileDevBridgeResponse(normalizedPath);
      if (!response.ok) {
        throw await readLocalFileResponseError(response);
      }
      return await response.blob();
    } catch (error) {
      if (!isFetchNetworkError(error)) {
        throw error;
      }

      log.warn('Full local-file fetch failed, retrying with byte ranges', {
        path: normalizedPath,
        error,
      });
      return fetchLocalFileBlobInRanges(normalizedPath, error);
    }
  }

  if (backend === 'nativeHelper') {
    const buffer = await NativeHelperClient.getDownloadedFile(normalizedPath);
    if (!buffer) {
      throw new Error('Native Helper could not read the requested file');
    }

    return new Blob([buffer], { type: guessMimeTypeFromPath(normalizedPath) });
  }

  throw new Error('No local file backend available. Start the dev bridge or connect the Native Helper.');
}

export async function listLocalDirectory(directory: string, extensions: string | undefined, callerContext: CallerContext): Promise<Array<{
  name: string;
  path: string;
  size: number;
  modified: string;
}>> {
  const normalizedDir = normalizeLocalPath(directory);
  const extFilter = parseExtensionFilter(extensions);
  const backend = getLocalFileBackend(callerContext);

  if (backend === 'devBridge') {
    let url = `/api/local-files?dir=${encodeURIComponent(normalizedDir)}`;
    if (extFilter.length > 0) {
      url += `&ext=${encodeURIComponent(extFilter.join(','))}`;
    }

    const response = await fetchWithDevBridgeAuth(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }

    const data = await response.json() as { files?: Array<{ name: string; path: string; size: number; modified: string }> };
    return data.files || [];
  }

  if (backend === 'nativeHelper') {
    const entries = await NativeHelperClient.listDir(normalizedDir);
    return entries
      .filter(entry => entry.kind === 'file')
      .filter(entry => {
        const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()!.toLowerCase()}` : '';
        return extFilter.length === 0 || extFilter.includes(ext);
      })
      .map(entry => ({
        name: entry.name,
        path: `${normalizedDir}/${entry.name}`,
        size: entry.size,
        modified: new Date(entry.modified * 1000).toISOString(),
      }));
  }

  throw new Error('No local file backend available. Start the dev bridge or connect the Native Helper.');
}
